import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathExists } from '@/path-exists.js';
import { randomHexSecret } from './randomSecret.js';
import { LaunchSecretStore } from '@/services/credentials/secretStore.js';
import { captureCommandOutput } from '@/services/platform/exec.js';
import type { Logger } from '@/services/platform/logger.js';
import {
  resolveAndroidCredentialsDirectory,
  resolveAndroidCredentialsIndexPath,
  resolveCredentialsDirectory,
  resolveLegacyAndroidCredentialsIndexPath,
} from '@/services/platform/paths.js';
import type { KeystoreAssets } from '@/types/credentials.js';

const SERVICE_ACCOUNT_SECRET = 'play-service-account';
const KEYSTORE_STORE_PASSWORD = 'android-keystore-store-password';
const KEYSTORE_KEY_PASSWORD = 'android-keystore-key-password';
const DEFAULT_ALIAS = 'upload';
const PRIVATE_FILE_MODE = 0o600;

type KeystoreRecord = {
  path: string;
  alias: string;
};

type AndroidCredentialsIndex = {
  keystore?: KeystoreRecord;
};

export type AndroidCredentialFailure = Readonly<{
  readonly _tag: 'AndroidCredentialFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeAndroidCredentialFailure(fields: {
  message: string;
  cause?: unknown;
}): AndroidCredentialFailure {
  if (fields.cause != null) {
    return {
      _tag: 'AndroidCredentialFailure',
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'AndroidCredentialFailure',
    message: fields.message,
  };
}

export type KeystoreImport = {
  path: string;
  alias: string;
  storePassword: string;
  keyPassword: string;
};

type EnsureKeystoreOptions = {
  appName: string;
  packageName: string;
  log: Logger;
  dryRun: boolean;
  confirmCreate: (message: string) => Promise<boolean>;
  confirmReplace?: (message: string) => Promise<boolean>;
  import?: KeystoreImport;
};

function androidSecretAccount(account: string, packageName: string): string {
  return `${account}:${packageName}`;
}

function encodeJson(serviceAccountJson: string): string {
  return Buffer.from(serviceAccountJson, 'utf8').toString('base64');
}

function decodeJson(storedServiceAccount: string): string {
  const decodedServiceAccount = Buffer.from(storedServiceAccount, 'base64').toString('utf8');
  const isDecodedJson = decodedServiceAccount.trimStart().startsWith('{');

  if (isDecodedJson) {
    return decodedServiceAccount;
  }

  return storedServiceAccount;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readNonEmptyText(record: Record<string, unknown>, key: string): string | null {
  const field = record[key];

  if (typeof field != 'string') {
    return null;
  }

  if (field.length == 0) {
    return null;
  }

  return field;
}

function resolveKeystoreBackupPath(packageName: string): string {
  return join(resolveAndroidCredentialsDirectory(packageName), 'upload.keystore');
}

function resolveLegacyKeystoreBackupPath(): string {
  return join(resolveCredentialsDirectory(), 'upload.keystore');
}

function corruptIndex(credentialsIndexPath: string, cause?: unknown): AndroidCredentialFailure {
  return makeAndroidCredentialFailure({
    message: `The Android credentials index at ${credentialsIndexPath} is corrupt.`,
    cause,
  });
}

function readKeystoreRecord(
  keystore: Record<string, unknown>,
  credentialsIndexPath: string,
): KeystoreRecord {
  const keystorePath = keystore['path'];
  const alias = keystore['alias'];

  if (typeof keystorePath != 'string') {
    throw corruptIndex(credentialsIndexPath);
  }

  if (typeof alias != 'string') {
    throw corruptIndex(credentialsIndexPath);
  }

  return { path: keystorePath, alias };
}

function decodeAndroidCredentialsIndex(
  parsed: unknown,
  credentialsIndexPath: string,
): AndroidCredentialsIndex {
  if (isRecord(parsed)) {
    return readCredentialsDocument(parsed, credentialsIndexPath);
  }

  throw corruptIndex(credentialsIndexPath);
}

function readCredentialsDocument(
  document: Record<string, unknown>,
  credentialsIndexPath: string,
): AndroidCredentialsIndex {
  const hasKeystore = Object.hasOwn(document, 'keystore');

  if (hasKeystore == false) {
    return {};
  }

  const keystore = document['keystore'];

  if (isRecord(keystore)) {
    return { keystore: readKeystoreRecord(keystore, credentialsIndexPath) };
  }

  throw corruptIndex(credentialsIndexPath);
}

async function readIndexAt(credentialsIndexPath: string): Promise<AndroidCredentialsIndex> {
  let indexExists = false;

  try {
    indexExists = await pathExists(credentialsIndexPath);
  } catch (cause) {
    throw makeAndroidCredentialFailure({
      message: `Could not check for the Android credentials index at ${credentialsIndexPath}.`,
      cause,
    });
  }

  if (indexExists == false) {
    return {};
  }

  let indexText = '';

  try {
    indexText = await readFile(credentialsIndexPath, 'utf8');
  } catch (cause) {
    throw makeAndroidCredentialFailure({
      message: `Could not read the Android credentials index at ${credentialsIndexPath}.`,
      cause,
    });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(indexText);
  } catch (cause) {
    throw corruptIndex(credentialsIndexPath, cause);
  }

  return decodeAndroidCredentialsIndex(parsed, credentialsIndexPath);
}

function readAndroidIndex(packageName: string): Promise<AndroidCredentialsIndex> {
  return readIndexAt(resolveAndroidCredentialsIndexPath(packageName));
}

function readLegacyAndroidIndex(): Promise<AndroidCredentialsIndex> {
  return readIndexAt(resolveLegacyAndroidCredentialsIndexPath());
}

async function writeAndroidIndex(
  credentialsIndex: AndroidCredentialsIndex,
  packageName: string,
): Promise<void> {
  const credentialsDirectory = resolveAndroidCredentialsDirectory(packageName);
  const credentialsIndexPath = resolveAndroidCredentialsIndexPath(packageName);

  await mkdir(credentialsDirectory, { recursive: true });
  await writeFile(credentialsIndexPath, JSON.stringify(credentialsIndex, null, 2));
}

function validateServiceAccountJson(serviceAccountJson: string): void {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch (cause) {
    throw makeAndroidCredentialFailure({
      message:
        'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key.',
      cause,
    });
  }

  if (isRecord(parsed) == false) {
    throw makeAndroidCredentialFailure({
      message:
        'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key.',
    });
  }

  const clientEmail = readNonEmptyText(parsed, 'client_email');
  const privateKey = readNonEmptyText(parsed, 'private_key');

  if (clientEmail == null) {
    throw makeAndroidCredentialFailure({
      message:
        'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key.',
    });
  }

  if (privateKey == null) {
    throw makeAndroidCredentialFailure({
      message:
        'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key.',
    });
  }
}

export async function storeServiceAccount(
  serviceAccountJson: string,
  packageName: string,
): Promise<void> {
  validateServiceAccountJson(serviceAccountJson);

  const directory = resolveAndroidCredentialsDirectory(packageName);

  await mkdir(directory, { recursive: true });
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(SERVICE_ACCOUNT_SECRET, packageName),
    encodeJson(serviceAccountJson),
  );
  await writeFile(join(directory, 'package.txt'), packageName);
}

/** List non-secret package identifiers saved alongside app-scoped Play credentials. */
export async function listStoredAndroidPackages(): Promise<string[]> {
  const directory = join(resolveCredentialsDirectory(), 'android');
  const directoryExists = await pathExists(directory);

  if (directoryExists == false) {
    return [];
  }

  const entries = await readdir(directory);
  const names: string[] = [];

  for (const entry of entries) {
    // Package folders are the sha256 hex of the package name.
    const isPackageDigest = /^[a-f0-9]{64}$/.test(entry);

    if (isPackageDigest == false) {
      continue;
    }

    const packageFile = join(directory, entry, 'package.txt');
    let candidate = '';

    try {
      candidate = await readFile(packageFile, 'utf8');
    } catch (cause) {
      const isUnreadable = cause != null;

      if (isUnreadable) {
        candidate = '';
      }
    }

    // A Play package name is dotted Java-style identifiers.
    const isPackageName = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(candidate);

    if (isPackageName) {
      names.push(candidate);
    }
  }

  return names;
}

async function readAccountAt(account: string): Promise<string | null> {
  const stored = await LaunchSecretStore.readSecret(account);

  if (stored == null) {
    return null;
  }

  return decodeJson(stored);
}

function readLegacyServiceAccount(): Promise<string | null> {
  return readAccountAt(SERVICE_ACCOUNT_SECRET);
}

export function loadServiceAccount(packageName: string): Promise<string | null> {
  return readAccountAt(androidSecretAccount(SERVICE_ACCOUNT_SECRET, packageName));
}

async function readKeystore(
  record: KeystoreRecord | undefined,
  storeAccount: string,
  keyAccount: string,
): Promise<KeystoreAssets | null> {
  if (record == null) {
    return null;
  }

  const keystoreExists = await pathExists(record.path);

  if (keystoreExists == false) {
    return null;
  }

  const storePassword = await LaunchSecretStore.readSecret(storeAccount);
  const keyPassword = await LaunchSecretStore.readSecret(keyAccount);

  if (storePassword == null) {
    return null;
  }

  if (keyPassword == null) {
    return null;
  }

  return {
    path: record.path,
    alias: record.alias,
    storePassword,
    keyPassword,
  };
}

export async function loadCachedKeystore(packageName: string): Promise<KeystoreAssets | null> {
  const index = await readAndroidIndex(packageName);

  return readKeystore(
    index.keystore,
    androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
    androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
  );
}

async function readLegacyCachedKeystore(): Promise<KeystoreAssets | null> {
  const index = await readLegacyAndroidIndex();

  return readKeystore(index.keystore, KEYSTORE_STORE_PASSWORD, KEYSTORE_KEY_PASSWORD);
}

async function readStoredAlias(keystoreRecord: KeystoreRecord | undefined): Promise<string | null> {
  if (keystoreRecord == null) {
    return null;
  }

  const keystoreExists = await pathExists(keystoreRecord.path);

  if (keystoreExists == false) {
    return null;
  }

  return keystoreRecord.alias;
}

export async function describeStoredAndroidCredentials(packageName: string): Promise<{
  keystoreAlias: string | null;
  hasServiceAccount: boolean;
}> {
  const index = await readAndroidIndex(packageName);
  const keystoreAlias = await readStoredAlias(index.keystore);
  const serviceAccountJson = await LaunchSecretStore.readSecret(
    androidSecretAccount(SERVICE_ACCOUNT_SECRET, packageName),
  );
  const hasServiceAccount = serviceAccountJson != null;

  return { keystoreAlias, hasServiceAccount };
}

function quoteAppName(appName: string): string {
  return `'${appName.replaceAll("'", "'\\''")}'`;
}

function androidAdoptionCommand(appName: string): string {
  return `launch creds adopt --platform android --app ${quoteAppName(appName)}`;
}

function hasLegacyPassword(storePassword: string | null, keyPassword: string | null): boolean {
  if (storePassword != null) {
    return true;
  }

  if (keyPassword != null) {
    return true;
  }

  return false;
}

export async function describeMissingPlayServiceAccount(appName: string): Promise<string> {
  const legacyAccount = await LaunchSecretStore.readSecret(SERVICE_ACCOUNT_SECRET);
  const adopt = androidAdoptionCommand(appName);

  if (legacyAccount != null) {
    return `A legacy Play service account exists. Run \`${adopt}\`.`;
  }

  const legacyStorePassword = await LaunchSecretStore.readSecret(KEYSTORE_STORE_PASSWORD);
  const legacyKeyPassword = await LaunchSecretStore.readSecret(KEYSTORE_KEY_PASSWORD);
  const appArgument = quoteAppName(appName);

  if (hasLegacyPassword(legacyStorePassword, legacyKeyPassword)) {
    return `Legacy upload keystore passwords exist. Run \`${adopt}\`.`;
  }

  return `No Play service account. Import one with \`launch creds set-key --platform android --app ${appArgument} <key.json>\`.`;
}

/** Verify the store and private-key passwords without writing secrets to arguments. */
async function verifyKeystore(keystore: KeystoreImport): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'launch-verify-key-'));

  try {
    const verificationPasswordBytes = 32;
    const verificationPassword = randomHexSecret(verificationPasswordBytes);

    await captureCommandOutput(
      'keytool',
      [
        '-importkeystore',
        '-noprompt',
        '-srckeystore',
        keystore.path,
        '-srcalias',
        keystore.alias,
        '-srcstorepass:env',
        'LAUNCH_VERIFY_STORE_PASSWORD',
        '-srckeypass:env',
        'LAUNCH_VERIFY_KEY_PASSWORD',
        '-destkeystore',
        join(directory, 'verified.p12'),
        '-deststoretype',
        'PKCS12',
        '-deststorepass:env',
        'LAUNCH_VERIFY_DEST_PASSWORD',
        '-destkeypass:env',
        'LAUNCH_VERIFY_DEST_PASSWORD',
      ],
      {
        environmentOverrides: {
          LAUNCH_VERIFY_STORE_PASSWORD: keystore.storePassword,
          LAUNCH_VERIFY_KEY_PASSWORD: keystore.keyPassword,
          LAUNCH_VERIFY_DEST_PASSWORD: verificationPassword,
        },
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function hasKeystoreTrace(
  keystore: KeystoreRecord | undefined,
  backupExists: boolean,
  indexExists: boolean,
): boolean {
  if (keystore != null) {
    return true;
  }

  if (backupExists) {
    return true;
  }

  if (indexExists) {
    return true;
  }

  return false;
}

function destinationHasKeystoreMaterial(
  destinationIndex: AndroidCredentialsIndex,
  destinationFileExists: boolean,
  destinationIndexExists: boolean,
  destinationStorePassword: string | null,
  destinationKeyPassword: string | null,
): boolean {
  if (hasKeystoreTrace(destinationIndex.keystore, destinationFileExists, destinationIndexExists)) {
    return true;
  }

  if (destinationStorePassword != null) {
    return true;
  }

  if (destinationKeyPassword != null) {
    return true;
  }

  return false;
}

function replacesStoredAccount(
  legacyAccount: string | null,
  destinationAccount: string | null,
): boolean {
  if (legacyAccount == null) {
    return false;
  }

  if (destinationAccount == null) {
    return false;
  }

  return true;
}

function replacesStoredKeystore(
  legacyKeystore: KeystoreAssets | null,
  destinationHasMaterial: boolean,
): boolean {
  if (legacyKeystore == null) {
    return false;
  }

  return destinationHasMaterial;
}

function foundNoLegacyCredentials(legacyAccount: string | null, hasLegacyFiles: boolean): boolean {
  if (legacyAccount != null) {
    return false;
  }

  return hasLegacyFiles == false;
}

function foundBrokenLegacyKeystore(
  hasLegacyFiles: boolean,
  legacyKeystore: KeystoreAssets | null,
): boolean {
  if (hasLegacyFiles == false) {
    return false;
  }

  return legacyKeystore == null;
}

function refusesCredentialOverwrite(overwriteCheck: {
  overwrite: boolean;
  legacyAccount: string | null;
  destinationAccount: string | null;
  legacyKeystore: KeystoreAssets | null;
  destinationHasMaterial: boolean;
}): boolean {
  if (overwriteCheck.overwrite) {
    return false;
  }

  if (replacesStoredAccount(overwriteCheck.legacyAccount, overwriteCheck.destinationAccount)) {
    return true;
  }

  return replacesStoredKeystore(
    overwriteCheck.legacyKeystore,
    overwriteCheck.destinationHasMaterial,
  );
}

async function copyLegacyKeystore(
  legacyKeystore: KeystoreAssets,
  destinationBackup: string,
  packageName: string,
): Promise<void> {
  const credentialsDirectory = resolveAndroidCredentialsDirectory(packageName);

  await mkdir(credentialsDirectory, { recursive: true });
  await copyFile(legacyKeystore.path, destinationBackup);
  await chmod(destinationBackup, PRIVATE_FILE_MODE);
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
    legacyKeystore.storePassword,
  );
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
    legacyKeystore.keyPassword,
  );
  await writeAndroidIndex(
    { keystore: { path: destinationBackup, alias: legacyKeystore.alias } },
    packageName,
  );
}

/** Validate both legacy assets before copying them into an explicitly selected app slot. */
export async function adoptLegacyAndroidCredentials(
  packageName: string,
  overwrite: boolean,
  verifyPlayAccess: (serviceAccountJson: string, packageName: string) => Promise<void>,
): Promise<void> {
  const legacyAccount = await readLegacyServiceAccount();
  const legacyIndex = await readLegacyAndroidIndex();
  const legacyKeystore = await readLegacyCachedKeystore();
  const legacyBackupExists = await pathExists(resolveLegacyKeystoreBackupPath());
  const legacyIndexExists = await pathExists(resolveLegacyAndroidCredentialsIndexPath());
  const hasLegacyFiles = hasKeystoreTrace(
    legacyIndex.keystore,
    legacyBackupExists,
    legacyIndexExists,
  );
  const isLegacyStoreEmpty = foundNoLegacyCredentials(legacyAccount, hasLegacyFiles);

  if (isLegacyStoreEmpty) {
    throw makeAndroidCredentialFailure({ message: 'No legacy Android credentials were found.' });
  }

  const isLegacyKeystoreBroken = foundBrokenLegacyKeystore(hasLegacyFiles, legacyKeystore);

  if (isLegacyKeystoreBroken) {
    throw makeAndroidCredentialFailure({
      message:
        'The legacy upload keystore or its passwords could not be read. Restore them before adoption.',
    });
  }

  const destinationIndex = await readAndroidIndex(packageName);
  const destinationAccount = await loadServiceAccount(packageName);
  const destinationBackup = resolveKeystoreBackupPath(packageName);
  const destinationFileExists = await pathExists(destinationBackup);
  const destinationIndexExists = await pathExists(resolveAndroidCredentialsIndexPath(packageName));
  const destinationStorePassword = await LaunchSecretStore.readSecret(
    androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
  );
  const destinationKeyPassword = await LaunchSecretStore.readSecret(
    androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
  );
  const destinationHasMaterial = destinationHasKeystoreMaterial(
    destinationIndex,
    destinationFileExists,
    destinationIndexExists,
    destinationStorePassword,
    destinationKeyPassword,
  );

  if (
    refusesCredentialOverwrite({
      overwrite,
      legacyAccount,
      destinationAccount,
      legacyKeystore,
      destinationHasMaterial,
    })
  ) {
    throw makeAndroidCredentialFailure({
      message: 'App credentials already exist. Pass --yes to replace them.',
    });
  }

  if (legacyAccount != null) {
    await verifyPlayAccess(legacyAccount, packageName);
  }

  if (legacyKeystore != null) {
    try {
      await verifyKeystore(legacyKeystore);
    } catch (cause) {
      throw makeAndroidCredentialFailure({
        message:
          'Could not open the legacy keystore and its private key with the stored passwords.',
        cause,
      });
    }
  }

  if (legacyKeystore != null) {
    await copyLegacyKeystore(legacyKeystore, destinationBackup, packageName);
  }

  if (legacyAccount != null) {
    await storeServiceAccount(legacyAccount, packageName);
  }
}

function dryRunKeystore(packageName: string): KeystoreAssets {
  return {
    path: join(resolveAndroidCredentialsDirectory(packageName), 'dry-run-upload.keystore'),
    alias: DEFAULT_ALIAS,
    storePassword: 'dry-run',
    keyPassword: 'dry-run',
  };
}

async function confirmReplace(options: EnsureKeystoreOptions): Promise<boolean> {
  const confirmReplaceKeystore = options.confirmReplace;

  if (confirmReplaceKeystore == null) {
    return false;
  }

  return confirmReplaceKeystore('Replace the existing upload keystore?');
}

async function replacementWasRefused(
  options: EnsureKeystoreOptions,
  hasExistingKeystore: boolean,
): Promise<boolean> {
  if (hasExistingKeystore == false) {
    return false;
  }

  const isReplaceConfirmed = await confirmReplace(options);

  return isReplaceConfirmed == false;
}

async function importWhenRequested(
  options: EnsureKeystoreOptions,
  hasExistingKeystore: boolean,
): Promise<KeystoreAssets | null> {
  const keystoreImport = options.import;

  if (keystoreImport == null) {
    return null;
  }

  const isReplacementRefused = await replacementWasRefused(options, hasExistingKeystore);

  if (isReplacementRefused) {
    throw makeAndroidCredentialFailure({ message: 'Existing upload keystore was not replaced.' });
  }

  return importKeystore(keystoreImport, options.log, options.packageName);
}

export async function ensureUploadKeystore(
  options: EnsureKeystoreOptions,
): Promise<KeystoreAssets> {
  if (options.dryRun) {
    options.log.note(
      '[dry-run] would generate or import an upload keystore under ~/.launch/credentials',
    );

    return dryRunKeystore(options.packageName);
  }

  const index = await readAndroidIndex(options.packageName);
  const backupExists = await pathExists(resolveKeystoreBackupPath(options.packageName));
  const indexExists = await pathExists(resolveAndroidCredentialsIndexPath(options.packageName));
  const hasExistingKeystore = hasKeystoreTrace(index.keystore, backupExists, indexExists);
  const importedKeystore = await importWhenRequested(options, hasExistingKeystore);

  if (importedKeystore != null) {
    return importedKeystore;
  }

  const cachedKeystore = await loadCachedKeystore(options.packageName);

  if (cachedKeystore != null) {
    options.log.step(
      'keystore',
      `reusing upload keystore (alias ${cachedKeystore.alias})`,
      'upload-key',
    );

    return cachedKeystore;
  }

  if (hasExistingKeystore) {
    throw makeAndroidCredentialFailure({
      message:
        'An upload keystore already exists but could not be loaded. Restore its file and passwords before continuing.',
    });
  }

  const legacyIndex = await readLegacyAndroidIndex();
  const legacyBackupExists = await pathExists(resolveLegacyKeystoreBackupPath());
  const legacyIndexExists = await pathExists(resolveLegacyAndroidCredentialsIndexPath());
  const hasLegacyKeystore = hasKeystoreTrace(
    legacyIndex.keystore,
    legacyBackupExists,
    legacyIndexExists,
  );

  if (hasLegacyKeystore) {
    throw makeAndroidCredentialFailure({
      message: `A legacy upload keystore exists. Run \`${androidAdoptionCommand(options.appName)}\`.`,
    });
  }

  const shouldCreate = await options.confirmCreate(
    'Generate a new upload keystore and back it up locally?',
  );

  if (shouldCreate == false) {
    throw makeAndroidCredentialFailure({
      message: 'No upload keystore. Confirm generation or import an existing keystore.',
    });
  }

  return generateKeystore(options.appName, options.log, options.packageName);
}

async function generateKeystore(
  appName: string,
  log: Logger,
  packageName: string,
): Promise<KeystoreAssets> {
  const credentialsDirectory = resolveAndroidCredentialsDirectory(packageName);
  const keystoreBackupPath = resolveKeystoreBackupPath(packageName);
  const keystorePasswordBytes = 24;
  const password = randomHexSecret(keystorePasswordBytes);

  await mkdir(credentialsDirectory, { recursive: true });
  await captureCommandOutput(
    'keytool',
    [
      '-genkeypair',
      '-noprompt',
      '-keystore',
      keystoreBackupPath,
      '-alias',
      DEFAULT_ALIAS,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass:env',
      'LAUNCH_KEYSTORE_STORE_PASSWORD',
      '-keypass:env',
      'LAUNCH_KEYSTORE_KEY_PASSWORD',
      '-dname',
      `CN=Launch Upload (${appName}), O=Launch, C=US`,
    ],
    {
      environmentOverrides: {
        LAUNCH_KEYSTORE_STORE_PASSWORD: password,
        LAUNCH_KEYSTORE_KEY_PASSWORD: password,
      },
    },
  );
  await chmod(keystoreBackupPath, PRIVATE_FILE_MODE);
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
    password,
  );
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
    password,
  );
  await writeAndroidIndex(
    { keystore: { path: keystoreBackupPath, alias: DEFAULT_ALIAS } },
    packageName,
  );
  log.step('keystore', `generated upload keystore (alias ${DEFAULT_ALIAS})`, 'upload-key');

  return {
    path: keystoreBackupPath,
    alias: DEFAULT_ALIAS,
    storePassword: password,
    keyPassword: password,
  };
}

async function importKeystore(
  keystoreImport: KeystoreImport,
  log: Logger,
  packageName: string,
): Promise<KeystoreAssets> {
  const credentialsDirectory = resolveAndroidCredentialsDirectory(packageName);
  const keystoreBackupPath = resolveKeystoreBackupPath(packageName);
  const importExists = await pathExists(keystoreImport.path);

  if (importExists == false) {
    throw makeAndroidCredentialFailure({ message: `No keystore at ${keystoreImport.path}.` });
  }

  try {
    await verifyKeystore(keystoreImport);
  } catch (cause) {
    throw makeAndroidCredentialFailure({
      message: `Could not open keystore ${keystoreImport.path} with alias "${keystoreImport.alias}" and the given password.`,
      cause,
    });
  }

  await mkdir(credentialsDirectory, { recursive: true });
  await copyFile(keystoreImport.path, keystoreBackupPath);
  await chmod(keystoreBackupPath, PRIVATE_FILE_MODE);
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
    keystoreImport.storePassword,
  );
  await LaunchSecretStore.storeSecret(
    androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
    keystoreImport.keyPassword,
  );
  await writeAndroidIndex(
    { keystore: { path: keystoreBackupPath, alias: keystoreImport.alias } },
    packageName,
  );
  log.step('keystore', `imported upload keystore (alias ${keystoreImport.alias})`, 'upload-key');

  return {
    path: keystoreBackupPath,
    alias: keystoreImport.alias,
    storePassword: keystoreImport.storePassword,
    keyPassword: keystoreImport.keyPassword,
  };
}
