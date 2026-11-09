import { Context, Effect, Layer } from 'effect';
import { captureCommandOutput, provideNodeCommandServices } from './exec.js';
import { requireOptional } from './optionalDep.js';
import { detectHostOperatingSystem } from './os.js';

const KEYCHAIN_SERVICE_NAME = 'launch';

export type LaunchSecretStoreService = Readonly<{
  readonly readSecret: (account: string) => Effect.Effect<string | null, unknown>;
  readonly storeSecret: (account: string, secretText: string) => Effect.Effect<void, unknown>;
  readonly deleteSecret: (account: string) => Effect.Effect<void, unknown>;
}>;

export const LaunchSecretStore = Context.GenericTag<LaunchSecretStoreService>(
  'launch-store/SecretStore',
);

type KeyringModule = typeof import('@napi-rs/keyring');
let loadedKeyring: KeyringModule | null = null;

/** Load the optional native keyring once for secret storage. */
const loadNativeKeyring = (): Effect.Effect<KeyringModule, unknown> =>
  Effect.gen(function* () {
    if (loadedKeyring === null) {
      loadedKeyring = yield* requireOptional(
        'Secure credential storage',
        'pnpm add @napi-rs/keyring',
        () => Effect.tryPromise(() => import('@napi-rs/keyring')),
      );
    }
    return loadedKeyring;
  });

/** `security` exits 44 (errSecItemNotFound) when no item matches; only that means no secret is saved. */
const macosItemNotFoundExitCode = 44;

// The native binding also returns null when the user denies access, so a metadata-only query (no -w) tells the two apart.
const confirmMacosMissingSecret = (account: string): Effect.Effect<null, unknown> =>
  provideNodeCommandServices(
    captureCommandOutput('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE_NAME,
      '-a',
      account,
    ]),
  ).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.fail(new Error(`Could not read ${account} from the keychain`)),
      onFailure: (cause) => {
        const isItemMissing = cause.exitCode === macosItemNotFoundExitCode;
        if (isItemMissing) return Effect.succeed(null);
        return Effect.fail(new Error(`Could not read ${account} from the keychain`, { cause }));
      },
    }),
  );

const makeNativeKeyringSecretStore = (isMacos: boolean): LaunchSecretStoreService => ({
  readSecret: (account) =>
    Effect.gen(function* () {
      const { Entry } = yield* loadNativeKeyring();
      const storedPassword = yield* Effect.try({
        try: () => new Entry(KEYCHAIN_SERVICE_NAME, account).getPassword(),
        catch: (cause) => new Error(`Could not read ${account} from the keychain`, { cause }),
      });
      if (storedPassword === null && isMacos) return yield* confirmMacosMissingSecret(account);
      return storedPassword;
    }),
  storeSecret: (account, secretText) =>
    Effect.gen(function* () {
      const { Entry } = yield* loadNativeKeyring();
      yield* Effect.try(() => new Entry(KEYCHAIN_SERVICE_NAME, account).setPassword(secretText));
    }),
  deleteSecret: (account) =>
    Effect.gen(function* () {
      const { Entry } = yield* loadNativeKeyring();
      yield* Effect.try(() => new Entry(KEYCHAIN_SERVICE_NAME, account).deletePassword()).pipe(
        Effect.catchAll(() => Effect.void),
      );
    }),
});

export const LaunchSecretStoreLive = Layer.effect(
  LaunchSecretStore,
  detectHostOperatingSystem.pipe(
    Effect.map((system) => makeNativeKeyringSecretStore(system === 'macos')),
  ),
);

/** Build a deterministic secret-store layer over the supplied mutable map. */
export const makeLaunchSecretStoreTest = (
  storedSecrets: Map<string, string> = new Map<string, string>(),
): Layer.Layer<LaunchSecretStoreService> => {
  return Layer.succeed(LaunchSecretStore, {
    readSecret: (account) =>
      Effect.sync(() => {
        const secretText = storedSecrets.get(account);
        if (secretText === undefined) return null;
        return secretText;
      }),
    storeSecret: (account, secretText) =>
      Effect.sync(() => {
        storedSecrets.set(account, secretText);
      }),
    deleteSecret: (account) =>
      Effect.sync(() => {
        storedSecrets.delete(account);
      }),
  });
};

export const LaunchSecretStoreTest = makeLaunchSecretStoreTest();
