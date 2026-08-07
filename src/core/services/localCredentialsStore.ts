import { Context, Effect, Layer } from 'effect';
import {
  formatAccountSummary,
  getActiveKeyId,
  listAccounts,
  loadActiveAscKey,
  loadAscKeyById,
} from '../credentials/accounts.js';
import {
  describeStoredAndroidCredentials,
  loadCachedKeystore,
  loadServiceAccount,
} from '../credentials/androidKeystore.js';
import { describeStoredCredentials, loadCachedSigningAssets } from '../credentials/appleSigning.js';
import type { AscKey, KeystoreAssets, SigningAssets } from '../types/credentials.js';

export type AppleCredentialAccountStatus = Readonly<{
  readonly keyId: string;
  readonly label: string;
  readonly summary: string;
  readonly active: boolean;
  readonly unresolved: boolean;
  readonly certificateSerial: string | null;
  readonly profileCount: number;
}>;

export type AndroidCredentialStatus = Readonly<{
  readonly keystoreAlias: string | null;
  readonly hasServiceAccount: boolean;
}>;

/** Local credential reads needed by a credentials provider. */
export type LocalCredentialsStoreService = Readonly<{
  readonly loadAppleKey: (keyId?: string) => Effect.Effect<AscKey | null, unknown>;
  readonly loadAppleSigningAssets: (
    keyId: string,
    bundleId: string,
    extensions?: readonly string[],
  ) => Effect.Effect<SigningAssets | null, unknown>;
  readonly loadPlayServiceAccount: () => Effect.Effect<string | null, unknown>;
  readonly loadAndroidKeystore: () => Effect.Effect<KeystoreAssets | null, unknown>;
  readonly listAppleAccountStatuses: () => Effect.Effect<
    readonly AppleCredentialAccountStatus[],
    unknown
  >;
  readonly readAndroidCredentialStatus: () => Effect.Effect<AndroidCredentialStatus, unknown>;
}>;

export const LocalCredentialsStore = Context.GenericTag<LocalCredentialsStoreService>(
  'launch-store/LocalCredentialsStore',
);

type LocalCredentialsStoreRequirements =
  | Effect.Effect.Context<ReturnType<typeof describeStoredAndroidCredentials>>
  | Effect.Effect.Context<ReturnType<typeof describeStoredCredentials>>
  | Effect.Effect.Context<ReturnType<typeof getActiveKeyId>>
  | Effect.Effect.Context<ReturnType<typeof listAccounts>>
  | Effect.Effect.Context<ReturnType<typeof loadActiveAscKey>>
  | Effect.Effect.Context<ReturnType<typeof loadAscKeyById>>
  | Effect.Effect.Context<ReturnType<typeof loadCachedKeystore>>
  | Effect.Effect.Context<ReturnType<typeof loadCachedSigningAssets>>
  | Effect.Effect.Context<ReturnType<typeof loadServiceAccount>>;

const accountIsUnresolved = (teamId: string | undefined, appCount: number): boolean => {
  if (teamId !== undefined && teamId.length > 0) return false;
  return appCount === 0;
};

/** Connect the local credential facade to the account registry, signing cache, and secret store. */
export const LocalCredentialsStoreLive: Layer.Layer<
  LocalCredentialsStoreService,
  never,
  LocalCredentialsStoreRequirements
> = Layer.effect(
  LocalCredentialsStore,
  Effect.gen(function* () {
    const credentialStoreContext = yield* Effect.context<LocalCredentialsStoreRequirements>();
    return {
      loadAppleKey: (keyId) => {
        if (keyId !== undefined) {
          return loadAscKeyById(keyId).pipe(Effect.provide(credentialStoreContext));
        }
        return loadActiveAscKey().pipe(Effect.provide(credentialStoreContext));
      },
      loadAppleSigningAssets: (keyId, bundleId, extensions) =>
        loadCachedSigningAssets(keyId, bundleId, extensions).pipe(
          Effect.provide(credentialStoreContext),
        ),
      loadPlayServiceAccount: () =>
        loadServiceAccount().pipe(Effect.provide(credentialStoreContext)),
      loadAndroidKeystore: () => loadCachedKeystore().pipe(Effect.provide(credentialStoreContext)),
      listAppleAccountStatuses: () =>
        Effect.gen(function* () {
          const appleAccounts = yield* listAccounts();
          const activeKeyId = yield* getActiveKeyId();
          return yield* Effect.forEach(
            appleAccounts,
            (appleAccount) =>
              Effect.gen(function* () {
                const storedCredentials = yield* describeStoredCredentials(appleAccount.keyId);
                let appCount = 0;
                if (appleAccount.apps !== undefined) appCount = appleAccount.apps.length;
                return {
                  keyId: appleAccount.keyId,
                  label: appleAccount.label,
                  summary: formatAccountSummary(appleAccount, { includeLabel: false }),
                  active: appleAccount.keyId === activeKeyId,
                  unresolved: accountIsUnresolved(appleAccount.teamId, appCount),
                  certificateSerial: storedCredentials.certSerial,
                  profileCount: storedCredentials.bundleIds.length,
                };
              }),
            { concurrency: 1 },
          );
        }).pipe(Effect.provide(credentialStoreContext)),
      readAndroidCredentialStatus: () =>
        describeStoredAndroidCredentials().pipe(Effect.provide(credentialStoreContext)),
    } satisfies LocalCredentialsStoreService;
  }),
);
