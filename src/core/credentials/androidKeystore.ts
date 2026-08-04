import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { captureCommandOutput } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import type { Logger } from '../services/logger.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import {
  resolveAndroidCredentialsIndexPath,
  resolveCredentialsDirectory,
  type LaunchPathsService,
} from '../services/paths.js';
import type { KeystoreAssets } from '../types/credentials.js';
import { getSecret, setSecret } from './keychain.js';
import { randomHexSecret } from './randomSecret.js';

const SERVICE_ACCOUNT_SECRET = 'play-service-account';
const KEYSTORE_STORE_PASSWORD = 'android-keystore-store-password';
const KEYSTORE_KEY_PASSWORD = 'android-keystore-key-password';
const DEFAULT_ALIAS = 'upload';
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

export const makeAndroidCredentialFailure = Data.tagged<AndroidCredentialFailure>(
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
  log: Logger;
  dryRun: boolean;
  confirmCreate: (message: string) => Effect.Effect<boolean, unknown>;
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

const resolveKeystoreBackupPath = (): Effect.Effect<
  string,
  never,
  LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return pathService.join(yield* resolveCredentialsDirectory(), 'upload.keystore');
  });

const readAndroidIndex = (): Effect.Effect<
  AndroidCredentialsIndex,
  never,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsIndexPath = yield* resolveAndroidCredentialsIndexPath();
    const indexExists = yield* fileSystem
      .exists(credentialsIndexPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!indexExists) return {};
    return yield* fileSystem.readFileString(credentialsIndexPath).pipe(
      Effect.flatMap((indexText) => Effect.try(() => JSON.parse(indexText))),
      Effect.flatMap(Schema.decodeUnknown(AndroidCredentialsIndexSchema)),
      Effect.orElseSucceed(() => ({})),
    );
  });

const writeAndroidIndex = (
  credentialsIndex: AndroidCredentialsIndex,
): Effect.Effect<void, unknown, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveCredentialsDirectory();
    const credentialsIndexPath = yield* resolveAndroidCredentialsIndexPath();
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
): Effect.Effect<void, AndroidCredentialFailure | unknown, LaunchSecretStoreService> =>
  Effect.gen(function* () {
    yield* validateServiceAccountJson(serviceAccountJson);
    yield* setSecret(SERVICE_ACCOUNT_SECRET, encodeJson(serviceAccountJson));
  });

export const loadServiceAccount = (): Effect.Effect<
  string | null,
  unknown,
  LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const storedServiceAccount = yield* getSecret(SERVICE_ACCOUNT_SECRET);
    if (storedServiceAccount === null) return null;
    return decodeJson(storedServiceAccount);
  });

export const loadCachedKeystore = (): Effect.Effect<
  KeystoreAssets | null,
  unknown,
  FileSystem.FileSystem | LaunchPathsService | Path.Path | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keystoreRecord = (yield* readAndroidIndex()).keystore;
    if (keystoreRecord === undefined) return null;
    if (!(yield* fileSystem.exists(keystoreRecord.path))) return null;
    const [storePassword, keyPassword] = yield* Effect.all(
      [getSecret(KEYSTORE_STORE_PASSWORD), getSecret(KEYSTORE_KEY_PASSWORD)],
      { concurrency: 'unbounded' },
    );
    if (storePassword === null) return null;
    if (keyPassword === null) return null;
    return { path: keystoreRecord.path, alias: keystoreRecord.alias, storePassword, keyPassword };
  });

export const describeStoredAndroidCredentials = (): Effect.Effect<
  {
    keystoreAlias: string | null;
    hasServiceAccount: boolean;
  },
  unknown,
  FileSystem.FileSystem | LaunchPathsService | Path.Path | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const keystoreRecord = (yield* readAndroidIndex()).keystore;
    let keystoreAlias: string | null = null;
    if (keystoreRecord !== undefined) {
      if (yield* fileSystem.exists(keystoreRecord.path)) keystoreAlias = keystoreRecord.alias;
    }
    const serviceAccountJson = yield* getSecret(SERVICE_ACCOUNT_SECRET);
    return { keystoreAlias, hasServiceAccount: serviceAccountJson !== null };
  });

const dryRunKeystore = (): Effect.Effect<KeystoreAssets, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    return {
      path: pathService.join(yield* resolveCredentialsDirectory(), 'dry-run-upload.keystore'),
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
      return yield* dryRunKeystore();
    }
    const cachedKeystore = yield* loadCachedKeystore();
    if (cachedKeystore) {
      yield* options.log.step(
        'keystore',
        `reusing upload keystore (alias ${cachedKeystore.alias})`,
        'upload-key',
      );
      return cachedKeystore;
    }
    if (options.import) return yield* importKeystore(options.import, options.log);
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
    return yield* generateKeystore(options.appName, options.log);
  });

const generateKeystore = (
  appName: string,
  log: Logger,
): Effect.Effect<KeystoreAssets, unknown, AndroidCredentialPlatform | LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveCredentialsDirectory();
    const keystoreBackupPath = yield* resolveKeystoreBackupPath();
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    const password = yield* randomHexSecret(24);
    yield* captureCommandOutput('keytool', [
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
      '-storepass',
      password,
      '-keypass',
      password,
      '-dname',
      `CN=Launch Upload (${appName}), O=Launch, C=US`,
    ]);
    yield* fileSystem.chmod(keystoreBackupPath, 0o600);
    yield* setSecret(KEYSTORE_STORE_PASSWORD, password);
    yield* setSecret(KEYSTORE_KEY_PASSWORD, password);
    yield* writeAndroidIndex({ keystore: { path: keystoreBackupPath, alias: DEFAULT_ALIAS } });
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
): Effect.Effect<
  KeystoreAssets,
  AndroidCredentialFailure | unknown,
  AndroidCredentialPlatform | LaunchSecretStoreService
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveCredentialsDirectory();
    const keystoreBackupPath = yield* resolveKeystoreBackupPath();
    if (!(yield* fileSystem.exists(keystoreImport.path)))
      return yield* Effect.fail(
        makeAndroidCredentialFailure({ message: `No keystore at ${keystoreImport.path}.` }),
      );
    const verificationAttempt = yield* captureCommandOutput('keytool', [
      '-list',
      '-keystore',
      keystoreImport.path,
      '-storepass',
      keystoreImport.storePassword,
      '-alias',
      keystoreImport.alias,
    ]).pipe(Effect.either);
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
    yield* setSecret(KEYSTORE_STORE_PASSWORD, keystoreImport.storePassword);
    yield* setSecret(KEYSTORE_KEY_PASSWORD, keystoreImport.keyPassword);
    yield* writeAndroidIndex({
      keystore: { path: keystoreBackupPath, alias: keystoreImport.alias },
    });
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
