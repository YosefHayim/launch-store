/**
 * Cross-platform OS-native secret storage — the widening of the macOS-only Keychain.
 *
 * Implements {@link SecretStore} twice: on macOS via the built-in `security` CLI (zero extra
 * dependency, and byte-compatible with what earlier Launch versions stored under the `launch`
 * service), and on Windows/Linux via the native `@napi-rs/keyring` (Credential Manager / libsecret).
 * The right backend is chosen by {@link getSecretStore} from the host OS, so the rest of Launch keeps
 * calling `getSecret`/`setSecret` (in `core/keychain.ts`) and works the same on every platform.
 *
 * Why not `keytar`? It was archived in 2023; `@napi-rs/keyring` is the maintained successor with the
 * same OS-native backends. It ships prebuilt binaries via `optionalDependencies`, loaded lazily here
 * so a local-only Mac install never pulls it (it uses the `security` CLI instead).
 */

import type { SecretStore } from "./types.js";
import { capture } from "./exec.js";
import { hostOs } from "./os.js";
import { requireOptional } from "./optionalDep.js";

/** Keychain service all Launch secrets are filed under, so they're easy to find/audit/remove. */
const SERVICE = "launch";

/**
 * macOS Keychain via the built-in `security` CLI — the no-dependency store on a Mac.
 *
 * `security … -w <value>` passes the secret as an argument, briefly visible to `ps`; this matches how
 * Xcode/fastlane behave and is an accepted tradeoff for a local developer tool.
 */
const macosSecuritySecretStore: SecretStore = {
  name: "macos-security",
  async get(account) {
    try {
      return await capture("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
    } catch {
      return null;
    }
  },
  async set(account, value) {
    await capture("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", value]);
  },
  async delete(account) {
    try {
      await capture("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
    } catch {
      /* already absent — deletion is idempotent */
    }
  },
};

/** Module type of the optional native keyring; type-only so importing it stays erased + lazy. */
type KeyringModule = typeof import("@napi-rs/keyring");

let cachedKeyring: KeyringModule | null = null;

/** Lazy-load the native keyring once, with an actionable message if the optional package is absent. */
async function loadKeyring(): Promise<KeyringModule> {
  cachedKeyring ??= await requireOptional(
    "Secure credential storage on Windows/Linux",
    "npm install @napi-rs/keyring",
    () => import("@napi-rs/keyring"),
  );
  return cachedKeyring;
}

/**
 * Windows Credential Manager / Linux libsecret via `@napi-rs/keyring`.
 *
 * The native `Entry` API is synchronous; we wrap it to satisfy the async {@link SecretStore} and to
 * normalize "no such entry" (a thrown error on some platforms) into `null`/no-op.
 */
const nativeKeyringSecretStore: SecretStore = {
  name: "native-keyring",
  async get(account) {
    const { Entry } = await loadKeyring();
    try {
      return new Entry(SERVICE, account).getPassword();
    } catch {
      return null;
    }
  },
  async set(account, value) {
    const { Entry } = await loadKeyring();
    new Entry(SERVICE, account).setPassword(value);
  },
  async delete(account) {
    const { Entry } = await loadKeyring();
    try {
      new Entry(SERVICE, account).deletePassword();
    } catch {
      /* already absent — deletion is idempotent */
    }
  },
};

/** Resolve the secret store for the current host: the `security` CLI on macOS, the native keyring elsewhere. */
export function getSecretStore(): SecretStore {
  return hostOs() === "macos" ? macosSecuritySecretStore : nativeKeyringSecretStore;
}
