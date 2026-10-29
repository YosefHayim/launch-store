import type { FileSystem, Path } from '@effect/platform';
import { Context, Data, Effect, Layer } from 'effect';
import { listAccounts, loadAscKeyById } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import { GoogleAccessToken, type GoogleAccessTokenService } from '../services/googleAccessToken.js';
import { GoogleReportingClientService } from '../services/googleReportingClient.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { StatsCredentialsFailure, StatsCredentialsShape } from '../types/stats.js';

export const StatsCredentials = Context.GenericTag<StatsCredentialsShape>(
  'launch-store/StatsCredentials',
);

const makeStatsCredentialsFailure = Data.tagged<StatsCredentialsFailure>('StatsCredentialsFailure');

const credentialsFailure = (operation: string, cause: unknown): StatsCredentialsFailure =>
  makeStatsCredentialsFailure({
    message: `Could not ${operation}: ${errorMessage(cause)}`,
    cause,
  });

type StatsCredentialsLiveRequirements =
  | AppleStoreClientService
  | FileSystem.FileSystem
  | GoogleAccessTokenService
  | GoogleReportingClientService
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Path.Path;

/** Live credentials: every saved account is read by its own key id, never through the active account. */
export const StatsCredentialsLive = Layer.effect(
  StatsCredentials,
  Effect.gen(function* () {
    const capturedServices = yield* Effect.context<StatsCredentialsLiveRequirements>();
    const appleStoreClients = yield* AppleStoreClientService;
    const environment = yield* LaunchEnvironment;
    const googleAccessToken = yield* GoogleAccessToken;
    const googleReportingClients = yield* GoogleReportingClientService;

    const loadServiceAccountJson = () =>
      loadServiceAccount().pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) => credentialsFailure('load the Play service account', cause)),
      );

    const playServiceAccount: StatsCredentialsShape['playServiceAccount'] = () =>
      Effect.gen(function* () {
        const serviceAccountJson = yield* loadServiceAccountJson();
        if (serviceAccountJson === null) return null;
        return yield* googleAccessToken
          .readServiceAccount(serviceAccountJson)
          .pipe(
            Effect.mapError((cause) => credentialsFailure('read the Play service account', cause)),
          );
      });

    const playReportingClient: StatsCredentialsShape['playReportingClient'] = () =>
      Effect.gen(function* () {
        const serviceAccountJson = yield* loadServiceAccountJson();
        if (serviceAccountJson === null) return null;
        return yield* googleReportingClients
          .createClient(serviceAccountJson)
          .pipe(
            Effect.mapError((cause) =>
              credentialsFailure('create the Play reporting client', cause),
            ),
          );
      });

    const ascClientForAccount: StatsCredentialsShape['ascClientForAccount'] = (accountKeyId) =>
      Effect.gen(function* () {
        const ascKey = yield* loadAscKeyById(accountKeyId);
        if (ascKey === null) return null;
        return yield* appleStoreClients.createEffectClient(ascKey);
      }).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) => credentialsFailure('load the App Store Connect key', cause)),
      );

    const vendorNumberForAccount: StatsCredentialsShape['vendorNumberForAccount'] = (
      accountKeyId,
    ) =>
      Effect.gen(function* () {
        const accounts = yield* listAccounts();
        const account = accounts.find((candidate) => candidate.keyId === accountKeyId);
        if (account !== undefined && account.vendorNumber !== undefined) {
          return account.vendorNumber;
        }
        const environmentVendorNumber = environment.values.appleVendorNumber;
        if (environmentVendorNumber === undefined) return null;
        return environmentVendorNumber;
      }).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) => credentialsFailure('read the vendor number', cause)),
      );

    const accessTokenForScopes: StatsCredentialsShape['googleAccessToken'] = (scopes) =>
      Effect.gen(function* () {
        const serviceAccount = yield* playServiceAccount();
        if (serviceAccount === null) return null;
        return yield* googleAccessToken
          .createAccessToken(serviceAccount, scopes)
          .pipe(Effect.mapError((cause) => credentialsFailure('get a Google access token', cause)));
      });

    return {
      ascClientForAccount,
      vendorNumberForAccount,
      playServiceAccount,
      playReportingClient,
      googleAccessToken: accessTokenForScopes,
    } satisfies StatsCredentialsShape;
  }),
);

/** Test layer: every method answers null unless the test passes its own answer. */
export const makeStatsCredentialsTest = (
  overrides: Partial<StatsCredentialsShape> = {},
): Layer.Layer<StatsCredentialsShape> =>
  Layer.succeed(StatsCredentials, {
    ascClientForAccount: () => Effect.succeed(null),
    vendorNumberForAccount: () => Effect.succeed(null),
    playServiceAccount: () => Effect.succeed(null),
    playReportingClient: () => Effect.succeed(null),
    googleAccessToken: () => Effect.succeed(null),
    ...overrides,
  } satisfies StatsCredentialsShape);
