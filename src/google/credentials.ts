/**
 * Android signing-credential automation — the "manage your own upload key, locally" engine.
 *
 * The Android twin of `apple/credentials.ts`, and deliberately simpler: under Play App Signing, Google
 * holds the real *app signing key* and you only ever sign uploads with a separate *upload key*. So
 * there is no cert/CSR/profile dance and no Apple-style cap — Launch just generates (or imports) one
 * upload keystore with `keytool`, reuses it across builds, and lets Play App Signing make it
 * recoverable if it's ever lost (see docs/plan-android.md).
 *
 * Security model mirrors the iOS leg: the keystore is generated locally, backed up under
 * `~/.launch/credentials` (chmod 600), and its store/key passwords live in the OS secret store — never
 * beside the file, never in config. The Play service-account JSON is likewise kept in the secret store
 * (base64 at rest, so the macOS `security -w` backend can't hex-corrupt its multi-line PEM).
 */

import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { KeystoreAssets } from '../core/types.js';
import type { Logger } from '../core/logger.js';
import { capture } from '../core/exec.js';
import { getSecret, setSecret } from '../core/keychain.js';
import { ANDROID_CREDENTIALS_INDEX, CREDENTIALS_DIR, ensureDir } from '../core/paths.js';
import { join } from 'node:path';
import { parseServiceAccount } from './playClient.js';

/** Secret-store account holding the Play service-account JSON (base64-encoded — see {@link encodeJson}). */
const SERVICE_ACCOUNT_SECRET = 'play-service-account';
/** Secret-store accounts for the upload keystore's store/key passwords. */
const KEYSTORE_STORE_PASSWORD = 'android-keystore-store-password';
const KEYSTORE_KEY_PASSWORD = 'android-keystore-key-password';
/** Default key alias for a Launch-generated keystore. */
const DEFAULT_ALIAS = 'upload';
/** Canonical on-disk location of the (generated or imported) upload keystore backup. */
const KEYSTORE_BACKUP = join(CREDENTIALS_DIR, 'upload.keystore');

/** Persisted, non-secret record of the upload keystore (`~/.launch/credentials/android.json`). */
interface KeystoreRecord {
  /** Absolute path to the keystore backup. */
  path: string;
  /** Key alias inside it. */
  alias: string;
}

/** On-disk Android credential metadata. No secrets — path + alias only. */
interface AndroidCredentialsIndex {
  keystore?: KeystoreRecord;
}

/** An existing keystore to adopt instead of generating one (BYO import). */
export interface KeystoreImport {
  /** Path to the user's existing keystore. */
  path: string;
  /** Key alias to sign with inside it. */
  alias: string;
  /** Password unlocking the keystore file. */
  storePassword: string;
  /** Password unlocking the key entry. */
  keyPassword: string;
}

/** Inputs for {@link ensureUploadKeystore}. */
export interface EnsureKeystoreOptions {
  /** App handle, used only to label the generated key's distinguished name. */
  appName: string;
  log: Logger;
  /** Rehearse only: log the action, touch nothing (no keytool, no secret store, no disk). */
  dryRun: boolean;
  /** Confirm before generating a real key. Return false to abort. */
  confirmCreate: (message: string) => Promise<boolean>;
  /** Adopt an existing keystore instead of generating one. */
  import?: KeystoreImport;
}

/** Base64-encode a multi-line secret so the macOS `security -w` backend stores it without hex-corruption. */
function encodeJson(json: string): string {
  return Buffer.from(json, 'utf8').toString('base64');
}

/** Decode a stored service-account JSON; tolerate a legacy verbatim value written before base64 encoding. */
function decodeJson(stored: string): string {
  const decoded = Buffer.from(stored, 'base64').toString('utf8');
  return decoded.trimStart().startsWith('{') ? decoded : stored;
}

/** Read the Android credentials index, tolerating a missing or malformed file. */
function readAndroidIndex(): AndroidCredentialsIndex {
  if (!existsSync(ANDROID_CREDENTIALS_INDEX)) return {};
  try {
    return JSON.parse(readFileSync(ANDROID_CREDENTIALS_INDEX, 'utf8')) as AndroidCredentialsIndex;
  } catch {
    return {};
  }
}

/** Write the Android credentials index back to disk. */
function writeAndroidIndex(index: AndroidCredentialsIndex): void {
  ensureDir(CREDENTIALS_DIR);
  writeFileSync(ANDROID_CREDENTIALS_INDEX, JSON.stringify(index, null, 2));
}

/** Persist the Play service-account JSON into the OS secret store. Validates the shape before storing. */
export async function storeServiceAccount(json: string): Promise<void> {
  parseServiceAccount(json);
  await setSecret(SERVICE_ACCOUNT_SECRET, encodeJson(json));
}

/** Read the stored Play service-account JSON, or null if none has been imported. */
export async function loadServiceAccount(): Promise<string | null> {
  const stored = await getSecret(SERVICE_ACCOUNT_SECRET);
  return stored ? decodeJson(stored) : null;
}

/**
 * Return the cached upload keystore (file + passwords) without provisioning anything — the build's
 * silent-reuse path. Null if the backup is gone or its passwords aren't in the secret store, which
 * tells the caller to run setup. The Android twin of `loadCachedSigningAssets`.
 */
export async function loadCachedKeystore(): Promise<KeystoreAssets | null> {
  const record = readAndroidIndex().keystore;
  if (!record || !existsSync(record.path)) return null;
  const [storePassword, keyPassword] = await Promise.all([
    getSecret(KEYSTORE_STORE_PASSWORD),
    getSecret(KEYSTORE_KEY_PASSWORD),
  ]);
  if (!storePassword || !keyPassword) return null;
  return { path: record.path, alias: record.alias, storePassword, keyPassword };
}

/** Summarize what Android credentials are cached, for `launch creds status`. */
export async function describeStoredAndroidCredentials(): Promise<{
  keystoreAlias: string | null;
  hasServiceAccount: boolean;
}> {
  const record = readAndroidIndex().keystore;
  return {
    keystoreAlias: record && existsSync(record.path) ? record.alias : null,
    hasServiceAccount: (await getSecret(SERVICE_ACCOUNT_SECRET)) !== null,
  };
}

/** A keystore stand-in for `--dry-run`, so the rest of the pipeline runs unchanged. */
function dryRunKeystore(): KeystoreAssets {
  return {
    path: join(CREDENTIALS_DIR, 'dry-run-upload.keystore'),
    alias: DEFAULT_ALIAS,
    storePassword: 'dry-run',
    keyPassword: 'dry-run',
  };
}

/**
 * Resolve the upload keystore, reusing the cached one and creating only what's missing.
 *
 * Order: reuse the backed-up keystore if present → else adopt a BYO `import` → else (gated by
 * {@link EnsureKeystoreOptions.confirmCreate}) generate a fresh one with `keytool`, store its random
 * passwords in the secret store, and back it up chmod-600. Idempotent: a second run with a keystore in
 * place performs no writes. Reuse-first throughout, exactly like the iOS distribution certificate.
 */
export async function ensureUploadKeystore(
  options: EnsureKeystoreOptions,
): Promise<KeystoreAssets> {
  const { log, dryRun, confirmCreate } = options;
  if (dryRun) {
    log.info(
      '[dry-run] would generate (or import) an upload keystore with keytool, backed up under ~/.launch/credentials',
    );
    return dryRunKeystore();
  }

  const cached = await loadCachedKeystore();
  if (cached) {
    log.step('keystore', `reusing upload keystore (alias ${cached.alias})`, 'upload-key');
    return cached;
  }

  if (options.import) return importKeystore(options.import, log);

  if (
    !(await confirmCreate(
      'Generate a new upload keystore (a fresh key on this machine; backed up locally)?',
    ))
  ) {
    throw new Error(
      'No upload keystore. Re-run and confirm to generate one, or import an existing one with --import.',
    );
  }
  return generateKeystore(options.appName, log);
}

/** Generate a fresh upload keystore with keytool, store its passwords, and back it up (chmod 600). */
async function generateKeystore(appName: string, log: Logger): Promise<KeystoreAssets> {
  ensureDir(CREDENTIALS_DIR);
  const password = randomBytes(24).toString('hex');
  await capture('keytool', [
    '-genkeypair',
    '-noprompt',
    '-keystore',
    KEYSTORE_BACKUP,
    '-alias',
    DEFAULT_ALIAS,
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-storepass',
    password,
    '-keypass',
    password,
    '-dname',
    `CN=Launch Upload (${appName}), O=Launch, C=US`,
  ]);
  chmodSync(KEYSTORE_BACKUP, 0o600);
  await setSecret(KEYSTORE_STORE_PASSWORD, password);
  await setSecret(KEYSTORE_KEY_PASSWORD, password);
  writeAndroidIndex({ keystore: { path: KEYSTORE_BACKUP, alias: DEFAULT_ALIAS } });
  log.step('keystore', `generated upload keystore (alias ${DEFAULT_ALIAS})`, 'upload-key');
  return {
    path: KEYSTORE_BACKUP,
    alias: DEFAULT_ALIAS,
    storePassword: password,
    keyPassword: password,
  };
}

/** Adopt an existing keystore: verify its alias + password open it, back it up, and store its passwords. */
async function importKeystore(imp: KeystoreImport, log: Logger): Promise<KeystoreAssets> {
  if (!existsSync(imp.path)) throw new Error(`No keystore at ${imp.path}.`);
  try {
    await capture('keytool', [
      '-list',
      '-keystore',
      imp.path,
      '-storepass',
      imp.storePassword,
      '-alias',
      imp.alias,
    ]);
  } catch (error) {
    throw new Error(
      `Could not open keystore ${imp.path} with alias "${imp.alias}" and the given password: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  ensureDir(CREDENTIALS_DIR);
  copyFileSync(imp.path, KEYSTORE_BACKUP);
  chmodSync(KEYSTORE_BACKUP, 0o600);
  await setSecret(KEYSTORE_STORE_PASSWORD, imp.storePassword);
  await setSecret(KEYSTORE_KEY_PASSWORD, imp.keyPassword);
  writeAndroidIndex({ keystore: { path: KEYSTORE_BACKUP, alias: imp.alias } });
  log.step('keystore', `imported upload keystore (alias ${imp.alias})`, 'upload-key');
  return {
    path: KEYSTORE_BACKUP,
    alias: imp.alias,
    storePassword: imp.storePassword,
    keyPassword: imp.keyPassword,
  };
}
