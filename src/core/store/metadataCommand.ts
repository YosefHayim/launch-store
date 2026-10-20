import { FileSystem, Path, type Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import {
  AppleStoreClientService,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import {
  type EffectGooglePlayClient,
  GoogleStoreClientService,
} from '../services/googleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import type { LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import { isApplePlatform, parsePlatform, platformLabel } from '../services/platform.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { AscKey } from '../types/credentials.js';
import type { PlayListing } from '../types/googlePlay.js';
import {
  loadStoreConfig,
  serializeStoreConfig,
  type AndroidLocaleInfo,
  type AndroidStoreConfig,
  type StoreConfig,
} from './storeConfig.js';
import { reconcileAppListing } from './ascSync.js';
import { readAppleListing } from './appleListingRead.js';
import { loadStoreAppContext, type StoreAppSelectionRequirements } from './selectStoreApp.js';

export const MetadataCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('pull', 'push'),
  platform: Schema.optionalWith(Schema.String, { exact: true }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  config: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
});

export type MetadataCommandInput = Schema.Schema.Type<typeof MetadataCommandInputSchema>;

/** A metadata command step failed. */
export type MetadataCommandFailure = Readonly<{
  readonly _tag: 'MetadataCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeMetadataCommandFailure =
  Data.tagged<MetadataCommandFailure>('MetadataCommandFailure');

type MetadataCredentialRequirements =
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | Terminal.Terminal;

type AppleMetadataRequirements = MetadataCredentialRequirements | AppleStoreClientService;

type GoogleMetadataRequirements = MetadataCredentialRequirements | GoogleStoreClientService;

type MetadataCommandRequirements = AppleMetadataRequirements | GoogleMetadataRequirements;

type MetadataTarget = Readonly<{
  readonly app: AppDescriptor;
  readonly configPath: string;
}>;

/** Convert a dependency failure into the metadata command channel. */
const metadataFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): MetadataCommandFailure => {
  let message = errorMessage(cause);
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeMetadataCommandFailure({ operation, message, cause });
};

const isMetadataCommandFailure = (cause: unknown): cause is MetadataCommandFailure => {
  if (typeof cause !== 'object') return false;
  if (cause === null) return false;
  if (!('_tag' in cause)) return false;
  if (cause._tag !== 'MetadataCommandFailure') return false;
  if (!('operation' in cause)) return false;
  if (typeof cause.operation !== 'string') return false;
  if (!('message' in cause)) return false;
  if (typeof cause.message !== 'string') return false;
  if (!('cause' in cause)) return false;
  return true;
};

/** Preserve metadata failures while normalizing platform cleanup and terminal failures. */
const normalizeMetadataFailure = (operation: string, cause: unknown): MetadataCommandFailure => {
  if (isMetadataCommandFailure(cause)) return cause;
  return metadataFailure(operation, cause);
};

/** Restrict listing sync to the two platforms with a store listing API. */
export const assertListingPlatform = (
  platform: Platform,
): Effect.Effect<void, MetadataCommandFailure> => {
  if (platform === 'ios') return Effect.void;
  if (platform === 'android') return Effect.void;
  return Effect.fail(
    metadataFailure(
      'validate metadata platform',
      platform,
      `\`launch metadata\` syncs the iOS and Android store listing only - ${platformLabel(platform)} isn't supported yet. Build and ship it with \`launch build ${platform}\` / \`launch release ${platform}\`, and manage its listing in App Store Connect for now.`,
    ),
  );
};

/** Select the app and the store.config.json path it owns. */
const selectMetadataTarget = (
  appSelector: string | undefined,
  configuredPath: string | undefined,
): Effect.Effect<
  MetadataTarget,
  MetadataCommandFailure,
  StoreAppSelectionRequirements | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const storeAppContext = yield* loadStoreAppContext(appSelector).pipe(
      Effect.mapError((cause) => metadataFailure('select metadata app', cause)),
    );
    let configPath = pathService.join(storeAppContext.app.dir, 'store.config.json');
    if (configuredPath !== undefined) configPath = configuredPath;
    return { app: storeAppContext.app, configPath };
  });

/** Read an existing metadata file for a pull merge, or start an empty document. */
const readExistingStoreConfig = (
  configPath: string,
): Effect.Effect<StoreConfig, MetadataCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(Effect.mapError((cause) => metadataFailure('inspect store metadata config', cause)));
    if (!configExists) return {};
    return yield* loadStoreConfig(configPath).pipe(
      Effect.mapError((cause) => metadataFailure(cause.operation, cause.cause, cause.message)),
    );
  });

/** Load a metadata file required by a push. */
const readRequiredStoreConfig = (
  configPath: string,
): Effect.Effect<StoreConfig, MetadataCommandFailure, FileSystem.FileSystem> =>
  loadStoreConfig(configPath).pipe(
    Effect.mapError((cause) => metadataFailure(cause.operation, cause.cause, cause.message)),
  );

/** A pulled section replaces only the keys it read, so keys a pull does not read, like `apple.categories`, stay. */
const mergeStoreConfig = (currentStoreConfig: StoreConfig, storeConfigPatch: StoreConfig) => {
  const mergedStoreConfig: StoreConfig = { ...currentStoreConfig, ...storeConfigPatch };
  if (storeConfigPatch.apple !== undefined)
    mergedStoreConfig.apple = { ...currentStoreConfig.apple, ...storeConfigPatch.apple };
  if (storeConfigPatch.android !== undefined)
    mergedStoreConfig.android = { ...currentStoreConfig.android, ...storeConfigPatch.android };
  return mergedStoreConfig;
};

/** Merge platform listing fields into store.config.json. */
const writeMergedStoreConfig = (
  configPath: string,
  storeConfigPatch: StoreConfig,
): Effect.Effect<void, MetadataCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const currentStoreConfig = yield* readExistingStoreConfig(configPath);
    const mergedStoreConfig = mergeStoreConfig(currentStoreConfig, storeConfigPatch);
    yield* fileSystem
      .writeFileString(configPath, serializeStoreConfig(mergedStoreConfig))
      .pipe(Effect.mapError((cause) => metadataFailure('write store metadata config', cause)));
  });

/** Require the active ASC API key before talking to App Store Connect. */
const requireActiveAscKey = (): Effect.Effect<
  AscKey,
  MetadataCommandFailure,
  MetadataCredentialRequirements
> =>
  Effect.gen(function* () {
    const ascKey = yield* loadActiveAscKey().pipe(
      Effect.mapError((cause) => metadataFailure('load active Apple account', cause)),
    );
    if (ascKey === null) {
      return yield* Effect.fail(
        metadataFailure(
          'load active Apple account',
          'missing-active-account',
          'No active Apple account. Run `launch creds set-key` first.',
        ),
      );
    }
    return ascKey;
  });

/** Require a Play service account before talking to Google Play. */
const requirePlayServiceAccount = (): Effect.Effect<
  string,
  MetadataCommandFailure,
  MetadataCredentialRequirements
> =>
  Effect.gen(function* () {
    const serviceAccountJson = yield* loadServiceAccount().pipe(
      Effect.mapError((cause) => metadataFailure('load Play service account', cause)),
    );
    if (serviceAccountJson === null) {
      return yield* Effect.fail(
        metadataFailure(
          'load Play service account',
          'missing-service-account',
          'No Play service account. Run `launch creds set-key --platform android` first.',
        ),
      );
    }
    return serviceAccountJson;
  });

/** Build the App Store Connect client for the active Apple account. */
const createAppleClient = (): Effect.Effect<
  EffectAppStoreConnectClient,
  MetadataCommandFailure,
  AppleMetadataRequirements
> =>
  Effect.gen(function* () {
    const ascKey = yield* requireActiveAscKey();
    const appleStoreClients = yield* AppleStoreClientService;
    return yield* appleStoreClients.createEffectClient(ascKey);
  });

/** Build the Google Play client for the stored service account. */
const createPlayClient = (): Effect.Effect<
  EffectGooglePlayClient,
  MetadataCommandFailure,
  GoogleMetadataRequirements
> =>
  Effect.gen(function* () {
    const serviceAccountJson = yield* requirePlayServiceAccount();
    const googleStoreClients = yield* GoogleStoreClientService;
    return yield* googleStoreClients
      .createEffectClient(serviceAccountJson)
      .pipe(Effect.mapError((cause) => metadataFailure('create Google Play client', cause)));
  });

/** Resolve the App Store Connect app record of a bundle id, failing when it does not exist yet. */
const requireAppId = (
  ascClient: EffectAppStoreConnectClient,
  bundleId: string,
): Effect.Effect<string, MetadataCommandFailure> =>
  Effect.gen(function* () {
    const appId = yield* ascClient
      .getAppId(bundleId)
      .pipe(Effect.mapError((cause) => metadataFailure('look up App Store app', cause)));
    if (appId === null) {
      return yield* Effect.fail(
        metadataFailure(
          'look up App Store app',
          bundleId,
          `No App Store Connect app for ${bundleId}. Create it first (launch setup).`,
        ),
      );
    }
    return appId;
  });

/** Pull the live App Store listing into store.config.json. */
export const pullAppleListing = (
  bundleId: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, AppleMetadataRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const ascClient = yield* createAppleClient();
    const appId = yield* requireAppId(ascClient, bundleId);
    const appleListing = yield* readAppleListing(ascClient, appId).pipe(
      Effect.mapError((cause) => metadataFailure('read App Store listing', cause)),
    );
    const localeCount = Object.keys(appleListing.info).length;
    if (dryRun) {
      yield* logger.step(
        'metadata',
        `would write ${localeCount} App Store locale(s) for ${bundleId} -> ${configPath}`,
      );
      return;
    }
    yield* writeMergedStoreConfig(configPath, { apple: appleListing });
    yield* logger.step('metadata', `wrote App Store listing -> ${configPath}`);
  }).pipe(Effect.mapError((cause) => normalizeMetadataFailure('pull App Store metadata', cause)));

/** Fold Play listings into the `android` section of store.config.json. */
const androidStoreConfigFromListings = (listings: readonly PlayListing[]): AndroidStoreConfig => {
  const localeInfoByLanguage: Record<string, AndroidLocaleInfo> = {};
  for (const { language, ...localeInfo } of listings) {
    if (Object.keys(localeInfo).length > 0) localeInfoByLanguage[language] = localeInfo;
  }
  return { info: localeInfoByLanguage };
};

/** Pull the live Play listing into store.config.json. */
const pullAndroidListing = (
  packageName: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, GoogleMetadataRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const playClient = yield* createPlayClient();
    const listings = yield* playClient
      .listListings(packageName)
      .pipe(Effect.mapError((cause) => metadataFailure('read Play listings', cause)));
    const androidListing = androidStoreConfigFromListings(listings);
    const localeCount = Object.keys(androidListing.info).length;
    if (dryRun) {
      yield* logger.step(
        'metadata',
        `would write ${localeCount} Play locale(s) for ${packageName} -> ${configPath}`,
      );
      return;
    }
    yield* writeMergedStoreConfig(configPath, { android: androidListing });
    yield* logger.step('metadata', `wrote Play listing -> ${configPath}`);
  }).pipe(Effect.mapError((cause) => normalizeMetadataFailure('pull Play metadata', cause)));

/** Push App Store listing metadata without uploading a binary or screenshots. */
const pushAppleListing = (
  bundleId: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, AppleMetadataRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const storeConfig = yield* readRequiredStoreConfig(configPath);
    if (storeConfig.apple === undefined) {
      return yield* Effect.fail(
        metadataFailure(
          'read App Store metadata',
          configPath,
          `${configPath} has no "apple" section to push.`,
        ),
      );
    }
    const appleStoreConfig = storeConfig.apple;
    const ascClient = yield* createAppleClient();
    const reconciliation = yield* reconcileAppListing(ascClient, {
      bundleId,
      listing: appleStoreConfig,
      dryRun,
    }).pipe(Effect.mapError((cause) => metadataFailure('push App Store listing', cause)));
    for (const action of reconciliation.actions) {
      yield* logger.step('metadata', `${action.status}: ${action.description}`);
    }
    const failedActions = reconciliation.actions.filter((action) => action.status === 'failed');
    if (failedActions.length > 0) {
      const failureText = failedActions
        .map((action) => `${action.description}: ${action.error}`)
        .join('; ');
      return yield* Effect.fail(
        metadataFailure(
          'push App Store listing',
          failureText,
          `App Store push failed: ${failureText}`,
        ),
      );
    }
    if (dryRun) {
      yield* logger.note('dry run: nothing was written to App Store Connect');
      return;
    }
    yield* logger.step('metadata', `pushed App Store listing for ${bundleId}`);
  }).pipe(Effect.mapError((cause) => normalizeMetadataFailure('push App Store metadata', cause)));

/** Turn the `android` config section into Play listings, one per language. */
const listingsFromAndroidStoreConfig = (androidStoreConfig: AndroidStoreConfig): PlayListing[] =>
  Object.entries(androidStoreConfig.info).map(([language, localeInfo]) => ({
    language,
    ...localeInfo,
  }));

/** Push Play listing metadata without uploading a binary or screenshots. */
const pushAndroidListing = (
  packageName: string,
  configPath: string,
  dryRun: boolean,
): Effect.Effect<void, MetadataCommandFailure, GoogleMetadataRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const storeConfig = yield* readRequiredStoreConfig(configPath);
    if (storeConfig.android === undefined) {
      return yield* Effect.fail(
        metadataFailure(
          'read Play metadata',
          configPath,
          `${configPath} has no "android" section to push.`,
        ),
      );
    }
    const listings = listingsFromAndroidStoreConfig(storeConfig.android);
    if (dryRun) {
      for (const listing of listings) {
        const fieldNames = Object.keys(listing).filter((field) => field !== 'language');
        yield* logger.step(
          'metadata',
          `planned: update Play listing ${listing.language} (${fieldNames.join(', ')}) for ${packageName}`,
        );
      }
      yield* logger.note('dry run: nothing was written to Google Play');
      return;
    }
    if (listings.length === 0) {
      yield* logger.note(`${configPath} has no Play locales to push.`);
      return;
    }
    const playClient = yield* createPlayClient();
    yield* playClient
      .updateListings(packageName, listings)
      .pipe(Effect.mapError((cause) => metadataFailure('upload Play listings', cause)));
    yield* logger.step('metadata', `pushed ${listings.length} Play listing(s) for ${packageName}`);
  }).pipe(Effect.mapError((cause) => normalizeMetadataFailure('push Play metadata', cause)));

/** Decode and run one metadata pull or push. */
export const metadataCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, MetadataCommandFailure, MetadataCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(MetadataCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => metadataFailure('decode metadata command input', cause)));
    let platformText = 'ios';
    if (commandInput.platform !== undefined) platformText = commandInput.platform;
    const platform = yield* parsePlatform(platformText).pipe(
      Effect.mapError((cause) => metadataFailure('parse metadata platform', cause)),
    );
    yield* assertListingPlatform(platform);
    const metadataTarget = yield* selectMetadataTarget(commandInput.app, commandInput.config);
    if (isApplePlatform(platform)) {
      if (metadataTarget.app.bundleId === undefined) {
        return yield* Effect.fail(
          metadataFailure(
            'resolve App Store listing',
            metadataTarget.app,
            'No bundle identifier for this app (set ios.bundleIdentifier).',
          ),
        );
      }
      if (commandInput.operation === 'pull') {
        yield* pullAppleListing(
          metadataTarget.app.bundleId,
          metadataTarget.configPath,
          commandInput.dryRun,
        );
        return;
      }
      yield* pushAppleListing(
        metadataTarget.app.bundleId,
        metadataTarget.configPath,
        commandInput.dryRun,
      );
      return;
    }
    if (metadataTarget.app.packageName === undefined) {
      return yield* Effect.fail(
        metadataFailure(
          'resolve Play listing',
          metadataTarget.app,
          'No Android application id for this app (set android.package).',
        ),
      );
    }
    if (commandInput.operation === 'pull') {
      yield* pullAndroidListing(
        metadataTarget.app.packageName,
        metadataTarget.configPath,
        commandInput.dryRun,
      );
      return;
    }
    yield* pushAndroidListing(
      metadataTarget.app.packageName,
      metadataTarget.configPath,
      commandInput.dryRun,
    );
  });
