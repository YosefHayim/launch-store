/**
 * Keychain-backed build secrets — the secure alternative to putting real secrets in plaintext `.env`.
 *
 * Mirrors the account registry's split (see `core/accounts.ts`): the non-secret index of WHICH secrets
 * exist and their app/profile scope lives in `~/.launch/secrets.json`, while each secret's VALUE stays
 * in the OS secret store (`core/keychain.ts`). The index exists because the OS keychain isn't reliably
 * enumerable cross-platform — `launch secret list` and the build-time injection both read it to know
 * what to fetch.
 *
 * Scope: a secret is keyed by app and (optionally) profile. A secret with no profile is app-wide
 * (injected into every profile's build); a profile-scoped one applies to just that profile and
 * overrides an app-wide secret of the same name. At build time stored secrets win over `.env` — they
 * are the source of truth for anything sensitive. See {@link resolveBuildSecrets}.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SECRETS_FILE, LAUNCH_HOME, ensureDir } from "./paths.js";
import { deleteSecret, getSecret, setSecret } from "./keychain.js";

/**
 * One secret's non-secret coordinates: which app and (optional) profile it's scoped to, and its env
 * var name. The value is NOT here — it's in the OS secret store, fetched by {@link getBuildSecret}.
 * `profile` is `null` for an app-wide secret. The triple (`app`, `profile`, `name`) is the natural key.
 */
export interface SecretRef {
  /** App handle the secret belongs to (matches {@link AppDescriptor.name}). */
  app: string;
  /** Profile name the secret is scoped to, or `null` for an app-wide secret applied to every profile. */
  profile: string | null;
  /** The environment variable name injected at build time, e.g. `SENTRY_AUTH_TOKEN`. */
  name: string;
}

/** The on-disk shape of `~/.launch/secrets.json` — the index of secret coordinates only, no values. */
interface SecretsIndex {
  secrets: SecretRef[];
}

/** The keychain account under which a secret's value is stored, namespaced by its scope + name. */
function secretAccount(ref: SecretRef): string {
  return `build-secret:${ref.app}:${ref.profile ?? "*"}:${ref.name}`;
}

/** Whether two refs name the same secret (same app, profile scope, and name). */
function sameRef(a: SecretRef, b: SecretRef): boolean {
  return a.app === b.app && a.profile === b.profile && a.name === b.name;
}

/** Read the index, returning an empty one when the file is absent or malformed. */
function readIndex(): SecretsIndex {
  if (!existsSync(SECRETS_FILE)) return { secrets: [] };
  try {
    const parsed = JSON.parse(readFileSync(SECRETS_FILE, "utf8")) as Partial<SecretsIndex>;
    return { secrets: Array.isArray(parsed.secrets) ? parsed.secrets : [] };
  } catch {
    return { secrets: [] };
  }
}

/** Write the index back to disk (pretty-printed; non-secret coordinates only). */
function writeIndex(index: SecretsIndex): void {
  ensureDir(LAUNCH_HOME);
  writeFileSync(SECRETS_FILE, JSON.stringify(index, null, 2));
}

/** Every recorded secret ref, optionally filtered to one app. Coordinates only — never values. */
export function listSecretRefs(app?: string): SecretRef[] {
  const refs = readIndex().secrets;
  return app ? refs.filter((ref) => ref.app === app) : refs;
}

/**
 * Store (or overwrite) a secret's value in the OS secret store and record its coordinates in the index.
 * Re-setting an existing (app, profile, name) updates the value in place without duplicating the index
 * entry.
 */
export async function setBuildSecret(ref: SecretRef, value: string): Promise<void> {
  await setSecret(secretAccount(ref), value);
  const index = readIndex();
  if (!index.secrets.some((existing) => sameRef(existing, ref))) {
    writeIndex({ secrets: [...index.secrets, ref] });
  }
}

/** Remove a secret's value and its index entry. Returns whether the index had it (the value delete is idempotent). */
export async function removeBuildSecret(ref: SecretRef): Promise<boolean> {
  await deleteSecret(secretAccount(ref));
  const index = readIndex();
  const remaining = index.secrets.filter((existing) => !sameRef(existing, ref));
  const existed = remaining.length !== index.secrets.length;
  if (existed) writeIndex({ secrets: remaining });
  return existed;
}

/**
 * The refs that apply to one build, in injection order: app-wide secrets first, then the profile's own,
 * so a profile-scoped secret overrides an app-wide one of the same name when merged. Pure — split out
 * from {@link resolveBuildSecrets} so the precedence logic is unit-testable without the keychain.
 */
export function effectiveRefs(refs: SecretRef[], app: string, profile: string): SecretRef[] {
  const forApp = refs.filter((ref) => ref.app === app);
  return [...forApp.filter((ref) => ref.profile === null), ...forApp.filter((ref) => ref.profile === profile)];
}

/**
 * Resolve the env vars to inject into a build from the keychain: every secret scoped to this app and
 * profile, with profile-scoped values overriding app-wide ones. The pipeline merges the result over
 * `.env` (stored secrets win). A ref whose value has gone missing from the keychain is skipped.
 */
export async function resolveBuildSecrets(app: string, profile: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const ref of effectiveRefs(listSecretRefs(), app, profile)) {
    const value = await getSecret(secretAccount(ref));
    if (value !== null) env[ref.name] = value;
  }
  return env;
}
