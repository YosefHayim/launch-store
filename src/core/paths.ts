/**
 * Canonical filesystem locations for Launch's local state.
 *
 * Everything non-secret Launch caches (artifacts, the artifact index, provisioning profiles, key
 * metadata) lives under `~/.launch`. Secrets do NOT live here — they're in the macOS Keychain.
 * Centralizing the paths keeps providers from inventing their own layout.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/** Root of Launch's local state directory. */
export const LAUNCH_HOME = join(homedir(), ".launch");

/** Where built artifacts are copied by the local storage provider. */
export const ARTIFACTS_DIR = join(LAUNCH_HOME, "artifacts");

/** JSON index of stored artifacts (newest-first history). */
export const ARTIFACT_INDEX = join(ARTIFACTS_DIR, "index.json");

/**
 * Non-secret signing metadata + the encrypted `.p12` backup live here (chmod 600). The private
 * key is ALSO in the login Keychain for signing; this backup just survives a Keychain reset.
 */
export const CREDENTIALS_DIR = join(LAUNCH_HOME, "credentials");

/** JSON map of the resolved distribution certificate + per-bundle provisioning profiles. */
export const CREDENTIALS_INDEX = join(CREDENTIALS_DIR, "index.json");

/** Where macOS/Xcode looks for installed provisioning profiles (by `<uuid>.mobileprovision`). */
export const PROVISIONING_PROFILES_DIR = join(homedir(), "Library", "MobileDevice", "Provisioning Profiles");

/**
 * Machine-discovered remote-build state: the live AWS host handle (id + allocation timestamp) and the
 * golden AMI id Launch created for this machine. Non-secret infra ids only — never `.env`, never
 * committed, never secrets (those stay in the OS keychain). See docs/plan-aws-ec2-mac.md.
 */
export const CLOUD_STATE = join(LAUNCH_HOME, "cloud.json");

/** Create a directory (and parents) if it doesn't exist, returning the path for chaining. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
