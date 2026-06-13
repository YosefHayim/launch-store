/**
 * Canonical filesystem locations for Relay's local state.
 *
 * Everything non-secret Relay caches (artifacts, the artifact index, provisioning profiles, key
 * metadata) lives under `~/.relay`. Secrets do NOT live here — they're in the macOS Keychain.
 * Centralizing the paths keeps providers from inventing their own layout.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Root of Relay's local state directory. */
export const RELAY_HOME = join(homedir(), ".relay");

/** Where built artifacts are copied by the local storage provider. */
export const ARTIFACTS_DIR = join(RELAY_HOME, "artifacts");

/** JSON index of stored artifacts (newest-first history). */
export const ARTIFACT_INDEX = join(ARTIFACTS_DIR, "index.json");

/**
 * Non-secret signing metadata + the encrypted `.p12` backup live here (chmod 600). The private
 * key is ALSO in the login Keychain for signing; this backup just survives a Keychain reset.
 */
export const CREDENTIALS_DIR = join(RELAY_HOME, "credentials");

/** JSON map of the resolved distribution certificate + per-bundle provisioning profiles. */
export const CREDENTIALS_INDEX = join(CREDENTIALS_DIR, "index.json");

/** Where macOS/Xcode looks for installed provisioning profiles (by `<uuid>.mobileprovision`). */
export const PROVISIONING_PROFILES_DIR = join(homedir(), "Library", "MobileDevice", "Provisioning Profiles");

/** Create a directory (and parents) if it doesn't exist, returning the path for chaining. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
