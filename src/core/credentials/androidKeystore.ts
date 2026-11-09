import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { captureCommandOutput } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import type { Logger } from '../services/logger.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import {
  resolveAndroidCredentialsIndexPath,
  resolveLegacyAndroidCredentialsIndexPath,
  resolveCredentialsDirectory,
  resolveAndroidCredentialsDirectory,
  type LaunchPathsService,
} from '../services/paths.js';
import type { KeystoreAssets } from '../types/credentials.js';
import { getSecret, setSecret } from './keychain.js';
import { randomHexSecret } from './randomSecret.js';

const SERVICE_ACCOUNT_SECRET = 'play-service-account';
const KEYSTORE_STORE_PASSWORD = 'android-keystore-store-password';
const KEYSTORE_KEY_PASSWORD = 'android-keystore-key-password';
const DEFAULT_ALIAS = 'upload';
const androidSecretAccount = (account: string, packageName: string): string =>
  `${account}:${packageName}`;
type AndroidCredentialPlatform =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | Path.Path;

type KeystoreRecord = {
  path: string;
  alias: string;
};

type AndroidCredentialsIndex = {
  keystore?: KeystoreRecord;
};

const AndroidCredentialsIndexSchema: Schema.Schema<AndroidCredentialsIndex> = Schema.mutable(
  Schema.Struct({
    keystore: Schema.optionalWith(
      Schema.mutable(
        Schema.Struct({
          path: Schema.String,
          alias: Schema.String,
        }),
      ),
      { exact: true },
    ),
  }),
);

export type AndroidCredentialFailure = Readonly<{
  readonly _tag: 'AndroidCredentialFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

const makeAndroidCredentialFailure = Data.tagged<AndroidCredentialFailure>(
  'AndroidCredentialFailure',
);

export type KeystoreImport = {
  path: string;
  alias: string;
  storePassword: string;
  keyPassword: string;
};

export type EnsureKeystoreOptions = {
  appName: string;
  packageName: string;
  log: Logger;
  dryRun: boolean;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
  confirmReplace?: (message: string) => Effect.Effect<boolean, unknown>;
  import?: KeystoreImport;
};

const ServiceAccountKeySchema = Schema.Struct({
  client_email: Schema.String.pipe(Schema.minLength(1)),
  private_key: Schema.String.pipe(Schema.minLength(1)),
});

const encodeJson = (serviceAccountJson: string): string =>
  Buffer.from(serviceAccountJson, 'utf8').toString('base64');

const decodeJson = (storedServiceAccount: string): string => {
  const decodedServiceAccount = Buffer.from(storedServiceAccount, 'base64').toString('utf8');
  if (decodedServiceAccount.trimStart().startsWith('{')) return decodedServiceAccount;
  return storedServiceAccount;
};

const resolveKeystoreBackupPath = (
  packageName: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(
      yield* resolveAndroidCredentialsDirectory(packageName),
      'upload.keystore',
    );
  });

const resolveLegacyKeystoreBackupPath = () =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveCredentialsDirectory(), 'upload.keystore');
  });

const readIndexAt = (credentialsIndexPath: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const indexExists = yield* fileSystem
      .exists(credentialsIndexPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!indexExists) return {} as AndroidCredentialsIndex;
    return yield* fileSystem.readFileString(credentialsIndexPath).pipe(
      Effect.flatMap((indexText) => Effect.try(() => JSON.parse(indexText))),
      Effect.flatMap(Schema.decodeUnknown(AndroidCredentialsIndexSchema)),
      Effect.orElseSucceed(() => ({}) as AndroidCredentialsIndex),
    );
  });
const readAndroidIndex = (packageName: string) =>
  Effect.flatMap(resolveAndroidCredentialsIndexPath(packageName), readIndexAt);
const readLegacyAndroidIndex = () =>
  Effect.flatMap(resolveLegacyAndroidCredentialsIndexPath(), readIndexAt);

const writeAndroidIndex = (
  credentialsIndex: AndroidCredentialsIndex,
  packageName: string,
): Effect.Effect<void, unknown, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveAndroidCredentialsDirectory(packageName);
    const credentialsIndexPath = yield* resolveAndroidCredentialsIndexPath(packageName);
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    yield* fileSystem.writeFileString(
      credentialsIndexPath,
      JSON.stringify(credentialsIndex, null, 2),
    );
  });

const validateServiceAccountJson = (
  serviceAccountJson: string,
): Effect.Effect<void, AndroidCredentialFailure> =>
  Effect.try({
    try: () => JSON.parse(serviceAccountJson),
    catch: (cause) =>
      makeAndroidCredentialFailure({
        message: 'Service-account key is not valid JSON. Pass the JSON file Google Cloud issued.',
        cause,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknown(ServiceAccountKeySchema)),
    Effect.asVoid,
    Effect.mapError((cause) =>
      makeAndroidCredentialFailure({
        message:
          'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key.',
        cause,
      }),
    ),
  );

export const storeServiceAccount = (
  serviceAccountJson: string,
  packageName: string,
): Effect.Effect<
  void,
  AndroidCredentialFailure | unknown,
  LaunchSecretStoreService | FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    yield* validateServiceAccountJson(serviceAccountJson);
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directory = yield* resolveAndroidCredentialsDirectory(packageName);
    yield* fileSystem.makeDirectory(directory, { recursive: true });
    yield* setSecret(
      androidSecretAccount(SERVICE_ACCOUNT_SECRET, packageName),
      encodeJson(serviceAccountJson),
    );
    yield* fileSystem.writeFileString(pathService.join(directory, 'package.txt'), packageName);
  });

/** List non-secret package identifiers saved alongside app-scoped Play credentials. */
export const listStoredAndroidPackages = () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const directory = pathService.join(yield* resolveCredentialsDirectory(), 'android');
    if (!(yield* fileSystem.exists(directory))) return [];
    const entries = yield* fileSystem.readDirectory(directory);
    const names: string[] = [];
    for (const entry of entries) {
      if (!/^[a-f0-9]{64}$/.test(entry)) continue;
      const candidate = yield* fileSystem
        .readFileString(pathService.join(directory, entry, 'package.txt'))
        .pipe(Effect.orElseSucceed(() => ''));
      if (/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(candidate))
        names.push(candidate);
    }
    return names;
  });

const readAccountAt = (
  account: string,
): Effect.Effect<string | null, unknown, LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const stored = yield* getSecret(account);
    if (stored === null) return null;
    return decodeJson(stored);
  });
const readLegacyServiceAccount = () => readAccountAt(SERVICE_ACCOUNT_SECRET);
export const loadServiceAccount = (packageName: string) =>
  readAccountAt(androidSecretAccount(SERVICE_ACCOUNT_SECRET, packageName));

const readKeystore = (
  record: KeystoreRecord | undefined,
  storeAccount: string,
  keyAccount: string,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (record === undefined) return null;
    if (!(yield* fileSystem.exists(record.path))) return null;
    const [storePassword, keyPassword] = yield* Effect.all(
      [getSecret(storeAccount), getSecret(keyAccount)],
      { concurrency: 'unbounded' },
    );
    if (storePassword === null || keyPassword === null) return null;
    return { path: record.path, alias: record.alias, storePassword, keyPassword };
  });
export const loadCachedKeystore = (packageName: string) =>
  Effect.gen(function* () {
    const index = yield* readAndroidIndex(packageName);
    return yield* readKeystore(
      index.keystore,
      androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
      androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
    );
  });
const readLegacyCachedKeystore = () =>
  Effect.gen(function* () {
    const index = yield* readLegacyAndroidIndex();
    return yield* readKeystore(index.keystore, KEYSTORE_STORE_PASSWORD, KEYSTORE_KEY_PASSWORD);
  });

export const describeStoredAndroidCredentials = (
  packageName: string,
): Effect.Effect<
  {
    keystoreAlias: string | null;
    hasServiceAccount: boolean;
  },
  unknown,
  FileSystem.FileSystem | LaunchPathsService | Path.Path | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keystoreRecord = (yield* readAndroidIndex(packageName)).keystore;
    let keystoreAlias: string | null = null;
    if (keystoreRecord !== undefined) {
      if (yield* fileSystem.exists(keystoreRecord.path)) keystoreAlias = keystoreRecord.alias;
    }
    const serviceAccountJson = yield* getSecret(
      androidSecretAccount(SERVICE_ACCOUNT_SECRET, packageName),
    );
    return { keystoreAlias, hasServiceAccount: serviceAccountJson !== null };
  });

const quoteAppName = (appName: string) => `'${appName.replaceAll("'", "'\\''")}'`;
const androidAdoptionCommand = (appName: string) =>
  `launch creds adopt --platform android --app ${quoteAppName(appName)}`;

/** Give callers an explicit migration path when legacy Android credentials are present. */
export const missingPlayServiceAccountMessage = (appName: string) =>
  Effect.gen(function* () {
    const legacyAccount = yield* getSecret(SERVICE_ACCOUNT_SECRET);
    const appArgument = quoteAppName(appName);
    const adopt = androidAdoptionCommand(appName);
    if (legacyAccount !== null) return `A legacy Play service account exists. Run \`${adopt}\`.`;
    const legacyStorePassword = yield* getSecret(KEYSTORE_STORE_PASSWORD);
    const legacyKeyPassword = yield* getSecret(KEYSTORE_KEY_PASSWORD);
    if (legacyStorePassword !== null || legacyKeyPassword !== null)
      return `Legacy upload keystore passwords exist. Run \`${adopt}\`.`;
    return `No Play service account. Import one with \`launch creds set-key --platform android --app ${appArgument} <key.json>\`.`;
  });

/** Verify the store and private-key passwords without writing secrets to arguments. */
const verifyKeystore = (keystore: KeystoreImport) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-verify-key-' });
      const verificationPassword = yield* randomHexSecret(32);
      yield* captureCommandOutput(
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
          pathService.join(directory, 'verified.p12'),
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
    }),
  );

/** Validate both legacy assets before copying them into an explicitly selected app slot. */
export const adoptLegacyAndroidCredentials = (
  packageName: string,
  overwrite: boolean,
  verifyPlayAccess: (
    serviceAccountJson: string,
    packageName: string,
  ) => Effect.Effect<void, unknown>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const legacyAccount = yield* readLegacyServiceAccount();
      const legacyIndex = yield* readLegacyAndroidIndex();
      const legacyKeystore = yield* readLegacyCachedKeystore();
      const legacyBackupExists = yield* fileSystem.exists(yield* resolveLegacyKeystoreBackupPath());
      const legacyIndexExists = yield* fileSystem.exists(
        yield* resolveLegacyAndroidCredentialsIndexPath(),
      );
      if (legacyAccount === null && !legacyBackupExists && !legacyIndexExists) {
        return yield* Effect.fail(
          makeAndroidCredentialFailure({ message: 'No legacy Android credentials were found.' }),
        );
      }
      if (
        (legacyIndex.keystore !== undefined || legacyBackupExists || legacyIndexExists) &&
        legacyKeystore === null
      ) {
        return yield* Effect.fail(
          makeAndroidCredentialFailure({
            message:
              'The legacy upload keystore or its passwords could not be read. Restore them before adoption.',
          }),
        );
      }
      const destinationIndex = yield* readAndroidIndex(packageName);
      const destinationAccount = yield* loadServiceAccount(packageName);
      const destinationBackup = yield* resolveKeystoreBackupPath(packageName);
      const destinationFileExists = yield* fileSystem.exists(destinationBackup);
      const destinationIndexExists = yield* fileSystem.exists(
        yield* resolveAndroidCredentialsIndexPath(packageName),
      );
      const destinationStorePassword = yield* getSecret(
        androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
      );
      const destinationKeyPassword = yield* getSecret(
        androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
      );
      if (
        !overwrite &&
        ((legacyAccount !== null && destinationAccount !== null) ||
          (legacyKeystore !== null &&
            (destinationIndex.keystore !== undefined ||
              destinationFileExists ||
              destinationIndexExists ||
              destinationStorePassword !== null ||
              destinationKeyPassword !== null)))
      ) {
        return yield* Effect.fail(
          makeAndroidCredentialFailure({
            message: 'App credentials already exist. Pass --yes to replace them.',
          }),
        );
      }
      if (legacyAccount !== null) yield* verifyPlayAccess(legacyAccount, packageName);
      if (legacyKeystore !== null) {
        yield* verifyKeystore(legacyKeystore).pipe(
          Effect.mapError((cause) =>
            makeAndroidCredentialFailure({
              message:
                'Could not open the legacy keystore and its private key with the stored passwords.',
              cause,
            }),
          ),
        );
      }
      if (legacyKeystore !== null) {
        const credentialsDirectory = yield* resolveAndroidCredentialsDirectory(packageName);
        yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
        yield* fileSystem.copyFile(legacyKeystore.path, destinationBackup);
        yield* fileSystem.chmod(destinationBackup, 0o600);
        yield* setSecret(
          androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
          legacyKeystore.storePassword,
        );
        yield* setSecret(
          androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
          legacyKeystore.keyPassword,
        );
        yield* writeAndroidIndex(
          { keystore: { path: destinationBackup, alias: legacyKeystore.alias } },
          packageName,
        );
      }
      if (legacyAccount !== null) yield* storeServiceAccount(legacyAccount, packageName);
    }),
  );

const dryRunKeystore = (
  packageName: string,
): Effect.Effect<KeystoreAssets, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return {
      path: pathService.join(
        yield* resolveAndroidCredentialsDirectory(packageName),
        'dry-run-upload.keystore',
      ),
      alias: DEFAULT_ALIAS,
      storePassword: 'dry-run',
      keyPassword: 'dry-run',
    };
  });

export const ensureUploadKeystore = (
  options: EnsureKeystoreOptions,
): Effect.Effect<
  KeystoreAssets,
  AndroidCredentialFailure | unknown,
  AndroidCredentialPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    if (options.dryRun) {
      yield* options.log.note(
        '[dry-run] would generate or import an upload keystore under ~/.launch/credentials',
      );
      return yield* dryRunKeystore(options.packageName);
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const record = (yield* readAndroidIndex(options.packageName)).keystore;
    const backupExists = yield* fileSystem.exists(
      yield* resolveKeystoreBackupPath(options.packageName),
    );
    const indexExists = yield* fileSystem.exists(
      yield* resolveAndroidCredentialsIndexPath(options.packageName),
    );
    if (options.import) {
      if (record !== undefined || backupExists || indexExists) {
        let confirmed = false;
        if (options.confirmReplace !== undefined)
          confirmed = yield* options.confirmReplace('Replace the existing upload keystore?');
        if (!confirmed)
          return yield* Effect.fail(
            makeAndroidCredentialFailure({ message: 'Existing upload keystore was not replaced.' }),
          );
      }
      return yield* importKeystore(options.import, options.log, options.packageName);
    }
    const cachedKeystore = yield* loadCachedKeystore(options.packageName);
    if (cachedKeystore) {
      yield* options.log.step(
        'keystore',
        `reusing upload keystore (alias ${cachedKeystore.alias})`,
        'upload-key',
      );
      return cachedKeystore;
    }
    if (record !== undefined || backupExists || indexExists) {
      return yield* Effect.fail(
        makeAndroidCredentialFailure({
          message:
            'An upload keystore already exists but could not be loaded. Restore its file and passwords before continuing.',
        }),
      );
    }
    const legacyIndex = yield* readLegacyAndroidIndex();
    const legacyBackupExists = yield* fileSystem.exists(yield* resolveLegacyKeystoreBackupPath());
    const legacyIndexExists = yield* fileSystem.exists(
      yield* resolveLegacyAndroidCredentialsIndexPath(),
    );
    if (legacyIndex.keystore !== undefined || legacyBackupExists || legacyIndexExists) {
      return yield* Effect.fail(
        makeAndroidCredentialFailure({
          message: `A legacy upload keystore exists. Run \`${androidAdoptionCommand(options.appName)}\`.`,
        }),
      );
    }
    const shouldCreate = yield* options.confirmCreate(
      'Generate a new upload keystore and back it up locally?',
    );
    if (!shouldCreate) {
      return yield* Effect.fail(
        makeAndroidCredentialFailure({
          message: 'No upload keystore. Confirm generation or import an existing keystore.',
        }),
      );
    }
    return yield* generateKeystore(options.appName, options.log, options.packageName);
  });

const generateKeystore = (
  appName: string,
  log: Logger,
  packageName: string,
): Effect.Effect<KeystoreAssets, unknown, AndroidCredentialPlatform | LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveAndroidCredentialsDirectory(packageName);
    const keystoreBackupPath = yield* resolveKeystoreBackupPath(packageName);
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    const password = yield* randomHexSecret(24);
    yield* captureCommandOutput(
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
    yield* fileSystem.chmod(keystoreBackupPath, 0o600);
    yield* setSecret(androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName), password);
    yield* setSecret(androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName), password);
    yield* writeAndroidIndex(
      { keystore: { path: keystoreBackupPath, alias: DEFAULT_ALIAS } },
      packageName,
    );
    yield* log.step('keystore', `generated upload keystore (alias ${DEFAULT_ALIAS})`, 'upload-key');
    return {
      path: keystoreBackupPath,
      alias: DEFAULT_ALIAS,
      storePassword: password,
      keyPassword: password,
    };
  });

const importKeystore = (
  keystoreImport: KeystoreImport,
  log: Logger,
  packageName: string,
): Effect.Effect<
  KeystoreAssets,
  AndroidCredentialFailure | unknown,
  AndroidCredentialPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveAndroidCredentialsDirectory(packageName);
    const keystoreBackupPath = yield* resolveKeystoreBackupPath(packageName);
    if (!(yield* fileSystem.exists(keystoreImport.path)))
      return yield* Effect.fail(
        makeAndroidCredentialFailure({ message: `No keystore at ${keystoreImport.path}.` }),
      );
    const verificationAttempt = yield* verifyKeystore(keystoreImport).pipe(Effect.either);
    if (verificationAttempt._tag === 'Left') {
      return yield* Effect.fail(
        makeAndroidCredentialFailure({
          message: `Could not open keystore ${keystoreImport.path} with alias "${keystoreImport.alias}" and the given password.`,
          cause: verificationAttempt.left,
        }),
      );
    }
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    yield* fileSystem.copyFile(keystoreImport.path, keystoreBackupPath);
    yield* fileSystem.chmod(keystoreBackupPath, 0o600);
    yield* setSecret(
      androidSecretAccount(KEYSTORE_STORE_PASSWORD, packageName),
      keystoreImport.storePassword,
    );
    yield* setSecret(
      androidSecretAccount(KEYSTORE_KEY_PASSWORD, packageName),
      keystoreImport.keyPassword,
    );
    yield* writeAndroidIndex(
      {
        keystore: { path: keystoreBackupPath, alias: keystoreImport.alias },
      },
      packageName,
    );
    yield* log.step(
      'keystore',
      `imported upload keystore (alias ${keystoreImport.alias})`,
      'upload-key',
    );
    return {
      path: keystoreBackupPath,
      alias: keystoreImport.alias,
      storePassword: keystoreImport.storePassword,
      keyPassword: keystoreImport.keyPassword,
    };
  });
