/**
 * Canonical filesystem locations for Launch's local state.
 *
 * Everything non-secret Launch caches (artifacts, the artifact index, provisioning profiles, key
 * metadata) lives under `~/.launch`. Secrets do NOT live here — they're in the macOS Keychain.
 * Centralizing the paths keeps providers from inventing their own layout.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

/** Root of Launch's local state directory. */
export const LAUNCH_HOME = join(homedir(), '.launch');

/** Where built artifacts are copied by the local storage provider. */
export const ARTIFACTS_DIR = join(LAUNCH_HOME, 'artifacts');

/** Full tee'd logs of long external tools (xcodebuild, gradle, prebuild) — written while a spinner hides the noise. */
export const LOGS_DIR = join(LAUNCH_HOME, 'logs');

/** JSON index of stored artifacts (newest-first history). */
export const ARTIFACT_INDEX = join(ARTIFACTS_DIR, 'index.json');

/**
 * Cross-run UX state: whether the user has seen the first-run tour, and when. Non-secret, host-local,
 * and intentionally tiny — it exists only so `launch` (no args) plays the walkthrough once and never
 * nags afterward. See `firstRun.ts`.
 */
export const STATE_FILE = join(LAUNCH_HOME, 'state.json');

/**
 * Registry of onboarded Apple accounts (`{ active, accounts: [...] }`). Non-secret: Key IDs, Issuer
 * IDs, labels, and cached team/app metadata only — each account's `.p8` stays in the OS secret store.
 */
export const ACCOUNTS_FILE = join(LAUNCH_HOME, 'accounts.json');

/**
 * Index of keychain-backed build secrets (`{ secrets: [{ app, profile, name }] }`). Non-secret: it
 * records only WHICH secrets exist and their app/profile scope, so `launch secret list` can enumerate
 * them and a build knows which to inject. Each secret's VALUE stays in the OS secret store (the OS
 * keychain isn't reliably enumerable cross-platform, which is why this thin index exists). See
 * `core/buildSecrets.ts`.
 */
export const SECRETS_FILE = join(LAUNCH_HOME, 'secrets.json');

/**
 * Non-secret signing metadata + the encrypted `.p12` backup live here (chmod 600). The private
 * key is ALSO in the login Keychain for signing; this backup just survives a Keychain reset.
 * Per-account signing assets live in a {@link accountCredentialsDir} subfolder keyed by Key ID.
 */
export const CREDENTIALS_DIR = join(LAUNCH_HOME, 'credentials');

/** Legacy single-account signing index, kept only so first-run migration can move it per-account. */
export const CREDENTIALS_INDEX = join(CREDENTIALS_DIR, 'index.json');

/**
 * The per-account signing directory: `~/.launch/credentials/<keyId>/` holding that account's
 * `index.json`, `.p12` backup, and `.mobileprovision` backups. Keying by Key ID isolates each Apple
 * team's signing material so switching accounts never reuses or overwrites another team's cert. The
 * Key ID is sanitized to filesystem-safe characters so a malformed value can't escape the directory.
 */
export function accountCredentialsDir(keyId: string): string {
  const safe = keyId.replace(/[^A-Za-z0-9_-]/g, '');
  return join(CREDENTIALS_DIR, safe || 'default');
}

/**
 * Non-secret Android signing metadata: the upload-keystore record (path + alias). The keystore file
 * itself is backed up beside it in {@link CREDENTIALS_DIR} (chmod 600); the store/key passwords live
 * in the OS secret store, never here. Kept separate from the iOS {@link CREDENTIALS_INDEX}.
 */
export const ANDROID_CREDENTIALS_INDEX = join(CREDENTIALS_DIR, 'android.json');

/** Where macOS/Xcode looks for installed provisioning profiles (by `<uuid>.mobileprovision`). */
export const PROVISIONING_PROFILES_DIR = join(
  homedir(),
  'Library',
  'MobileDevice',
  'Provisioning Profiles',
);

/**
 * Vault index of imported APNs auth keys (`{ keys: [{ keyId, teamId?, label?, importedAt }] }`).
 * Non-secret metadata only — each key's `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`.
 * APNs keys are portal-only (Apple has no create API), so Launch safeguards an imported one, never mints it.
 */
export const PUSH_KEYS_FILE = join(LAUNCH_HOME, 'push-keys.json');

/**
 * Machine-discovered remote-build state: the live AWS host handle (id + allocation timestamp) and the
 * golden AMI id Launch created for this machine. Non-secret infra ids only — never `.env`, never
 * committed, never secrets (those stay in the OS keychain).
 */
export const CLOUD_STATE = join(LAUNCH_HOME, 'cloud.json');

/**
 * Per-app build fingerprints (`<app>-<platform>.json`) that decide clean-vs-incremental. Host-local
 * and kept NEXT to the caches they validate — a cache's validity is host-specific, so this never rides
 * on the (possibly remote/shared) artifact index. Non-secret: a hash + timestamp only.
 */
export const BUILD_STATE_DIR = join(LAUNCH_HOME, 'build-state');

/**
 * Remembered interactive build picks (`{ lastApp?, apps: { <app>: { bump } } }`) so a re-run defaults to
 * last time's choices. Host-local UX convenience, never secret and never committed — the declarative home
 * for a default a user wants to *share* is their `launch.config.ts`, not this file. See `core/lastRun.ts`.
 */
export const LAST_RUN_FILE = join(LAUNCH_HOME, 'last-run.json');

/**
 * Persisted `launch release-train` records (`<id>.json`, one per coordinated release). A train outlives a
 * single process — review takes days — so its state lives on disk and is advanced by reconcile, mirroring
 * {@link BUILD_STATE_DIR}. Non-secret: app handle, car states, build ids, and timestamps only. See
 * `core/releaseTrain/record.ts`.
 */
export const RELEASE_TRAINS_DIR = join(LAUNCH_HOME, 'release-trains');

/**
 * Path to one train's record file. The id is sanitized to filesystem-safe characters so a malformed value
 * can never escape {@link RELEASE_TRAINS_DIR}.
 */
export function releaseTrainFile(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '');
  return join(RELEASE_TRAINS_DIR, `${safe || 'train'}.json`);
}

/**
 * Persisted `launch snapshot` records (`<name>.json`, one per captured point-in-time copy of live store
 * state). A snapshot is a named save slot the user diffs/exports/restores against, so it outlives the
 * process and lives on disk beside the other Launch state. Non-secret: store catalog state (product ids,
 * lifecycle states, pricing, listings) and capture timestamps only — never credentials. See
 * `core/snapshot/store.ts`.
 */
export const SNAPSHOTS_DIR = join(LAUNCH_HOME, 'snapshots');

/**
 * Path to one snapshot's record file. The name is sanitized to filesystem-safe characters so a malformed
 * label can never escape {@link SNAPSHOTS_DIR}.
 */
export function snapshotFile(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '');
  return join(SNAPSHOTS_DIR, `${safe || 'snapshot'}.json`);
}

/** Create a directory (and parents) if it doesn't exist, returning the path for chaining. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
