/**
 * Canonical filesystem locations for Launch's local state.
 *
 * Everything non-secret Launch caches (artifacts, the artifact index, provisioning profiles, key
 * metadata) lives under `~/.launch`. Secrets do NOT live here — they're in the macOS Keychain.
 * Centralizing the paths keeps providers from inventing their own layout.
 */

import { Effect } from 'effect';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// ─── Constants (module-level, after imports) ───────────────────────────────

/** Root of Launch's local state directory. */
export const LAUNCH_HOME = join(homedir(), '.launch');

/** Where built artifacts are copied by the local storage provider. */
export const ARTIFACTS_DIR = join(LAUNCH_HOME, 'artifacts');

/** Full tee'd logs of long external tools (xcodebuild, gradle, prebuild). */
export const LOGS_DIR = join(LAUNCH_HOME, 'logs');

/** JSON index of stored artifacts (newest-first history). */
export const ARTIFACT_INDEX = join(ARTIFACTS_DIR, 'index.json');

/** Cross-run UX state: whether the user has seen the first-run tour. */
export const STATE_FILE = join(LAUNCH_HOME, 'state.json');

/** Registry of onboarded Apple accounts (non-secret: Key IDs, Issuer IDs, labels only). */
export const ACCOUNTS_FILE = join(LAUNCH_HOME, 'accounts.json');

/** Index of keychain-backed build secrets (records WHICH secrets exist, not their values). */
export const SECRETS_FILE = join(LAUNCH_HOME, 'secrets.json');

/** Non-secret signing metadata + the encrypted `.p12` backup (chmod 600). */
export const CREDENTIALS_DIR = join(LAUNCH_HOME, 'credentials');

/** Legacy single-account signing index (kept for first-run migration). */
export const CREDENTIALS_INDEX = join(CREDENTIALS_DIR, 'index.json');

/** Non-secret Android signing metadata. */
export const ANDROID_CREDENTIALS_INDEX = join(CREDENTIALS_DIR, 'android.json');

/** Where macOS/Xcode looks for installed provisioning profiles. */
export const PROVISIONING_PROFILES_DIR = join(
  homedir(),
  'Library',
  'MobileDevice',
  'Provisioning Profiles',
);

/** Vault index of imported APNs auth keys (non-secret metadata only). */
export const PUSH_KEYS_FILE = join(LAUNCH_HOME, 'push-keys.json');

/** Machine-discovered remote-build state (host handle, AMI id — non-secret). */
export const CLOUD_STATE = join(LAUNCH_HOME, 'cloud.json');

/** Per-app build fingerprints that decide clean-vs-incremental. */
export const BUILD_STATE_DIR = join(LAUNCH_HOME, 'build-state');

/** Remembered interactive build picks (last app, bump choices). */
export const LAST_RUN_FILE = join(LAUNCH_HOME, 'last-run.json');

/** Persisted `launch release-train` records (one JSON per coordinated release). */
export const RELEASE_TRAINS_DIR = join(LAUNCH_HOME, 'release-trains');

/** Persisted `launch snapshot` records (one JSON per captured point-in-time). */
export const SNAPSHOTS_DIR = join(LAUNCH_HOME, 'snapshots');

// ─── Effect API ────────────────────────────────────────────────────────────

/**
 * Per-account signing directory: `~/.launch/credentials/<keyId>/`. Keying by Key ID isolates each
 * Apple team's signing material so switching accounts never reuses another team's cert.
 */
export const resolveAccountCredentialsDirectory = (keyId: string) =>
  Effect.sync(() => {
    const sanitizedKeyId = keyId.replace(/[^A-Za-z0-9_-]/g, '');
    return join(CREDENTIALS_DIR, sanitizedKeyId || 'default');
  });

/**
 * Path to one release-train record file. The id is sanitized to filesystem-safe characters.
 */
export const resolveReleaseTrainFilePath = (trainId: string) =>
  Effect.sync(() => {
    const sanitizedId = trainId.replace(/[^A-Za-z0-9_-]/g, '');
    return join(RELEASE_TRAINS_DIR, `${sanitizedId || 'train'}.json`);
  });

/**
 * Path to one snapshot record file. The name is sanitized to filesystem-safe characters.
 */
export const resolveSnapshotFilePath = (snapshotName: string) =>
  Effect.sync(() => {
    const sanitizedName = snapshotName.replace(/[^A-Za-z0-9_-]/g, '');
    return join(SNAPSHOTS_DIR, `${sanitizedName || 'snapshot'}.json`);
  });

/** Create a directory (and parents) if it doesn't exist, returning the path. */
export const ensureDirectoryExists = (directoryPath: string) =>
  Effect.sync(() => {
    mkdirSync(directoryPath, { recursive: true });
    return directoryPath;
  });

// ─── Imperative shims (callers migrate progressively) ──────────────────────

/** Imperative shim — use {@link resolveAccountCredentialsDirectory} in new code. */
export function accountCredentialsDir(keyId: string): string {
  const safe = keyId.replace(/[^A-Za-z0-9_-]/g, '');
  return join(CREDENTIALS_DIR, safe || 'default');
}

/** Imperative shim — use {@link resolveReleaseTrainFilePath} in new code. */
export function releaseTrainFile(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '');
  return join(RELEASE_TRAINS_DIR, `${safe || 'train'}.json`);
}

/** Imperative shim — use {@link resolveSnapshotFilePath} in new code. */
export function snapshotFile(name: string): string {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '');
  return join(SNAPSHOTS_DIR, `${safe || 'snapshot'}.json`);
}

/** Imperative shim — use {@link ensureDirectoryExists} in new code. */
export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}
