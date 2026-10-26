import { Context, Effect, Layer } from 'effect';
import { requireOptional } from './optionalDep.js';

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

/** Load the optional native secret-store binding without spawning a credential-bearing command. */
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

const nativeKeyringSecretStore: LaunchSecretStoreService = {
  readSecret: (account) =>
    Effect.gen(function* () {
      const { Entry } = yield* loadNativeKeyring();
      return yield* Effect.try(() => new Entry(KEYCHAIN_SERVICE_NAME, account).getPassword()).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      );
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
};

export const LaunchSecretStoreLive = Layer.succeed(LaunchSecretStore, nativeKeyringSecretStore);

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
