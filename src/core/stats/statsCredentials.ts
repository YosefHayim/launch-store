import type { FileSystem, Path } from '@effect/platform';
import { Context, Data, Effect, Layer } from 'effect';
import { listAccounts, loadAscKeyById } from '../credentials/accounts.js';
import { loadPortfolioFile } from '../portfolio/portfolioStore.js';
import { loadConfig } from '../config/config.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import { GoogleAccessToken, type GoogleAccessTokenService } from '../services/googleAccessToken.js';
import { GoogleReportingClientService } from '../services/googleReportingClient.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { StatsCredentialsFailure, StatsCredentialsShape } from '../types/stats.js';

export const StatsCredentials = Context.GenericTag<StatsCredentialsShape>(
  'launch-store/StatsCredentials',
);

const makeStatsCredentialsFailure = Data.tagged<StatsCredentialsFailure>('StatsCredentialsFailure');

const createCredentialsFailure = (operation: string, cause: unknown): StatsCredentialsFailure =>
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

export const StatsCredentialsLive = Layer.effect(
  StatsCredentials,
  Effect.gen(function* () {
    const capturedServices = yield* Effect.context<StatsCredentialsLiveRequirements>();
    const appleStoreClients = yield* AppleStoreClientService;
    const environment = yield* LaunchEnvironment;
    const googleAccessToken = yield* GoogleAccessToken;
    const googleReportingClients = yield* GoogleReportingClientService;
    const launchPaths = yield* LaunchPaths;

    const loadSavedServiceAccountKey = (packageName: string) =>
      loadServiceAccount(packageName).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) =>
          createCredentialsFailure('load the Play service account', cause),
        ),
      );

    const googlePackageForApp: StatsCredentialsShape['googlePackageForApp'] = (app) =>
      Effect.gen(function* () {
        if (app.packageName !== null) return app.packageName;
        if (app.bundleId === null) return null;
        const configuration = yield* loadConfig(launchPaths.workingDirectory);
        const matches = configuration.apps.filter(
          (candidate) => candidate.bundleId === app.bundleId && candidate.packageName !== undefined,
        );
        if (matches.length !== 1) return null;
        const matched = matches[0];
        if (matched === undefined || matched.packageName === undefined) return null;
        return matched.packageName;
      }).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) =>
          createCredentialsFailure('resolve the app Google credentials', cause),
        ),
      );

    const playServiceAccount: StatsCredentialsShape['playServiceAccount'] = (packageName) =>
      Effect.gen(function* () {
        if (packageName === null) return null;
        const savedServiceAccountKey = yield* loadSavedServiceAccountKey(packageName);
        const isKeyMissing = savedServiceAccountKey === null;
        if (isKeyMissing) return null;
        return yield* googleAccessToken
          .readServiceAccount(savedServiceAccountKey)
          .pipe(
            Effect.mapError((cause) =>
              createCredentialsFailure('read the Play service account', cause),
            ),
          );
      });

    const playReportingClient: StatsCredentialsShape['playReportingClient'] = (packageName) =>
      Effect.gen(function* () {
        if (packageName === null) return null;
        const savedServiceAccountKey = yield* loadSavedServiceAccountKey(packageName);
        const isKeyMissing = savedServiceAccountKey === null;
        if (isKeyMissing) return null;
        return yield* googleReportingClients
          .createClient(savedServiceAccountKey)
          .pipe(
            Effect.mapError((cause) =>
              createCredentialsFailure('create the Play reporting client', cause),
            ),
          );
      });

    const ascClientForAccount: StatsCredentialsShape['ascClientForAccount'] = (accountKeyId) =>
      Effect.gen(function* () {
        const ascKey = yield* loadAscKeyById(accountKeyId);
        const isKeyMissing = ascKey === null;
        if (isKeyMissing) return null;
        return yield* appleStoreClients.createEffectClient(ascKey);
      }).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) =>
          createCredentialsFailure('load the App Store Connect key', cause),
        ),
      );

    const vendorNumberForAccount: StatsCredentialsShape['vendorNumberForAccount'] = (
      accountKeyId,
    ) =>
      Effect.gen(function* () {
        const accounts = yield* listAccounts();
        const account = accounts.find((candidate) => candidate.keyId === accountKeyId);
        const hasAccountVendorNumber = account !== undefined && account.vendorNumber !== undefined;
        if (hasAccountVendorNumber) return account.vendorNumber;
        const environmentVendorNumber = environment.values.appleVendorNumber;
        const hasEnvironmentVendorNumber = environmentVendorNumber !== undefined;
        if (hasEnvironmentVendorNumber) return environmentVendorNumber;
        return null;
      }).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) => createCredentialsFailure('read the vendor number', cause)),
      );

    const playReportsBucket: StatsCredentialsShape['playReportsBucket'] = () =>
      Effect.gen(function* () {
        const portfolioFile = yield* loadPortfolioFile();
        if (portfolioFile === null) return null;
        return portfolioFile.playReportsBucket;
      }).pipe(
        Effect.provide(capturedServices),
        Effect.mapError((cause) => createCredentialsFailure('read the Play reports bucket', cause)),
      );

    const readGoogleAccessToken: StatsCredentialsShape['googleAccessToken'] = (
      scopes,
      packageName,
    ) =>
      Effect.gen(function* () {
        const serviceAccount = yield* playServiceAccount(packageName);
        const isServiceAccountMissing = serviceAccount === null;
        if (isServiceAccountMissing) return null;
        return yield* googleAccessToken
          .createAccessToken(serviceAccount, scopes)
          .pipe(
            Effect.mapError((cause) =>
              createCredentialsFailure('get a Google access token', cause),
            ),
          );
      });

    return {
      ascClientForAccount,
      vendorNumberForAccount,
      googlePackageForApp,
      playServiceAccount,
      playReportingClient,
      playReportsBucket,
      googleAccessToken: readGoogleAccessToken,
    } satisfies StatsCredentialsShape;
  }),
);

export const makeStatsCredentialsTest = (
  overrides: Partial<StatsCredentialsShape> = {},
): Layer.Layer<StatsCredentialsShape> =>
  Layer.succeed(StatsCredentials, {
    ascClientForAccount: () => Effect.succeed(null),
    vendorNumberForAccount: () => Effect.succeed(null),
    googlePackageForApp: (app) => Effect.succeed(app.packageName),
    playServiceAccount: () => Effect.succeed(null),
    playReportingClient: () => Effect.succeed(null),
    playReportsBucket: () => Effect.succeed(null),
    googleAccessToken: () => Effect.succeed(null),
    ...overrides,
  } satisfies StatsCredentialsShape);
