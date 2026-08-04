import { type FileSystem, Path } from '@effect/platform';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import { Data, Effect } from 'effect';
import {
  appRecordMissingMessage,
  IOS_PLATFORM,
  pickCurrentVersion,
  readReleaseStatus,
  releaseApp,
  type AscReleaseApi,
  type ReleaseInput,
} from '../release/appStoreRelease.js';
import { resolveReleaseType, resolveWhatsNew } from '../release/releaseInputs.js';
import { submitToStores } from '../build/pipelineProviders.js';
import {
  type CodeSigner,
  type CodeSigningRequirements,
  ensureCodeSigner,
} from '../credentials/codeSign.js';
import { loadActiveAscKey } from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import { publishOtaPlatform, readExportMetadata } from '../distribution/otaPublish.js';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveStorageProvider,
} from '../distribution/storage.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientDependencies,
} from '../services/appleStoreClient.js';
import { executeCommand } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import {
  GoogleStoreClientService,
  type EffectGooglePlayClient,
  type GoogleStoreClientService as GoogleStoreClientDependencies,
} from '../services/googleStoreClient.js';
import type { Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { getCredentialsProvider } from '../services/registry.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { AndroidReleaseOptions, AppDescriptor, BuildProfile } from '../types/app.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import type { Car } from '../types/releaseTrain.js';
import { androidCarState, iosCarState } from './engine.js';
import type { TrainEngine } from './orchestrator.js';

/** A release-train engine operation failed. */
export type TrainRuntimeFailure = Readonly<{
  readonly _tag: 'TrainRuntimeFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeTrainRuntimeFailure = Data.tagged<TrainRuntimeFailure>('TrainRuntimeFailure');

/** Platform services required by the live train engine. */
export type TrainRuntimeRequirements =
  | AppleStoreClientDependencies
  | FileSystem.FileSystem
  | GoogleStoreClientDependencies
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Path.Path
  | PlatformCommandExecutor.CommandExecutor;

/** Live train engine assembled for one app and profile. */
export type TrainRuntime = Readonly<{
  engine: TrainEngine<TrainRuntimeRequirements>;
}>;

/** Convert an unknown runtime cause to the train engine's tagged channel. */
const runtimeFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): TrainRuntimeFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeTrainRuntimeFailure({ operation, message, cause });
};

/** Map a store transport operation into the train engine's tagged channel. */
const attemptTransport = <Success>(
  operation: string,
  transportOperation: () => Effect.Effect<Success, unknown>,
): Effect.Effect<Success, TrainRuntimeFailure> =>
  transportOperation().pipe(Effect.mapError((cause) => runtimeFailure(operation, cause)));

/** Build the live Effect engine for one release-train run. */
export const buildTrainRuntime = (
  launchConfiguration: LaunchConfig,
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  environmentValues: Record<string, string>,
  holdReleases: boolean,
  logger: Logger,
): TrainRuntime => {
  let cachedAppleClient: AscReleaseApi | undefined;
  let cachedGoogleClient: EffectGooglePlayClient | undefined;
  let cachedCodeSigner: CodeSigner | undefined;

  /** Resolve and memoize the active App Store Connect client. */
  const resolveAppleClient = (): Effect.Effect<
    AscReleaseApi,
    TrainRuntimeFailure,
    | AppleStoreClientDependencies
    | FileSystem.FileSystem
    | LaunchPathsService
    | LaunchSecretStoreService
    | Path.Path
  > =>
    Effect.gen(function* () {
      if (cachedAppleClient !== undefined) return cachedAppleClient;
      const ascKey = yield* loadActiveAscKey().pipe(
        Effect.mapError((cause) => runtimeFailure('load active Apple account', cause)),
      );
      if (ascKey === null) {
        return yield* Effect.fail(
          runtimeFailure(
            'load active Apple account',
            appDescriptor.name,
            'No active Apple account. Run `launch creds set-key` first.',
          ),
        );
      }
      const appleStoreClient = yield* AppleStoreClientService;
      cachedAppleClient = yield* appleStoreClient
        .createClient(ascKey)
        .pipe(Effect.mapError((cause) => runtimeFailure('create App Store client', cause)));
      return cachedAppleClient;
    });

  /** Resolve and memoize the configured Google Play client. */
  const resolveGoogleClient = (): Effect.Effect<
    EffectGooglePlayClient,
    TrainRuntimeFailure,
    GoogleStoreClientDependencies | LaunchSecretStoreService
  > =>
    Effect.gen(function* () {
      if (cachedGoogleClient !== undefined) return cachedGoogleClient;
      const serviceAccountJson = yield* loadServiceAccount().pipe(
        Effect.mapError((cause) => runtimeFailure('load Google Play service account', cause)),
      );
      if (serviceAccountJson === null) {
        return yield* Effect.fail(
          runtimeFailure(
            'load Google Play service account',
            appDescriptor.name,
            'No Google Play service account configured. Run `launch creds set-key --platform android`.',
          ),
        );
      }
      const googleStoreClient = yield* GoogleStoreClientService;
      cachedGoogleClient = yield* googleStoreClient
        .createEffectClient(serviceAccountJson)
        .pipe(Effect.mapError((cause) => runtimeFailure('create Google Play client', cause)));
      return cachedGoogleClient;
    });

  /** Resolve and memoize the OTA code signer. */
  const resolveCodeSigner = (): Effect.Effect<
    CodeSigner,
    TrainRuntimeFailure,
    CodeSigningRequirements
  > =>
    Effect.gen(function* () {
      if (cachedCodeSigner !== undefined) return cachedCodeSigner;
      cachedCodeSigner = yield* ensureCodeSigner(false, logger).pipe(
        Effect.mapError((cause) => runtimeFailure('resolve OTA code signer', cause)),
      );
      return cachedCodeSigner;
    });

  /** Submit the latest valid iOS build to App Store review. */
  const submitIos = (): Effect.Effect<
    Readonly<{ buildId?: string }>,
    TrainRuntimeFailure,
    | AppleStoreClientDependencies
    | FileSystem.FileSystem
    | LaunchPathsService
    | LaunchSecretStoreService
    | Path.Path
  > =>
    Effect.gen(function* () {
      const bundleId = appDescriptor.bundleId;
      if (bundleId === undefined) {
        return yield* Effect.fail(
          runtimeFailure(
            'resolve iOS bundle identifier',
            appDescriptor,
            `${appDescriptor.name} has no iOS bundle id (ios.bundleIdentifier in app.json).`,
          ),
        );
      }
      const ascClient = yield* resolveAppleClient();
      const appId = yield* attemptTransport('find App Store app', () =>
        ascClient.getAppId(bundleId),
      );
      if (appId === null) {
        return yield* Effect.fail(
          runtimeFailure(
            'find App Store app',
            bundleId,
            appRecordMissingMessage(bundleId, 'launch release-train start'),
          ),
        );
      }
      const storeBuilds = yield* attemptTransport('list App Store builds', () =>
        ascClient.listBuilds(appId),
      );
      const storeBuild = storeBuilds.find(
        (candidateBuild) => candidateBuild.processingState === 'VALID' && !candidateBuild.expired,
      );
      if (storeBuild === undefined) {
        return yield* Effect.fail(
          runtimeFailure(
            'find processed iOS build',
            appDescriptor.name,
            `No processed iOS build on App Store Connect for ${appDescriptor.name}. Run \`launch build ios\` and upload it (\`launch testflight\` or \`launch release ios --no-wait\`) before starting the train.`,
          ),
        );
      }
      let versionString = appDescriptor.version;
      if (versionString === undefined) {
        const storeVersion = yield* attemptTransport('read App Store version', () =>
          ascClient.getLatestMarketingVersion(bundleId),
        );
        if (storeVersion !== null) versionString = storeVersion;
      }
      if (versionString === undefined) {
        return yield* Effect.fail(
          runtimeFailure(
            'resolve iOS marketing version',
            appDescriptor,
            `Could not determine a marketing version for ${appDescriptor.name}. Set "version" in app.json.`,
          ),
        );
      }
      if (versionString === '') {
        return yield* Effect.fail(
          runtimeFailure(
            'resolve iOS marketing version',
            appDescriptor,
            `Could not determine a marketing version for ${appDescriptor.name}. Set "version" in app.json.`,
          ),
        );
      }
      const releaseTypeSettings = resolveReleaseType(launchConfiguration.release, {
        manual: holdReleases,
      });
      const releaseNotes = yield* resolveWhatsNew(
        launchConfiguration.release,
        appDescriptor.dir,
      ).pipe(Effect.mapError((cause) => runtimeFailure('read iOS release notes', cause)));
      const releaseInput: ReleaseInput = {
        bundleId,
        platform: IOS_PLATFORM,
        versionString,
        releaseType: releaseTypeSettings.releaseType,
        phasedRelease: launchConfiguration.release?.phasedRelease === true,
        usesNonExemptEncryption: launchConfiguration.release?.usesNonExemptEncryption === true,
        whatsNew: releaseNotes,
        build: storeBuild,
        dryRun: false,
      };
      if (releaseTypeSettings.earliestReleaseDate !== undefined) {
        releaseInput.earliestReleaseDate = releaseTypeSettings.earliestReleaseDate;
      }
      yield* attemptTransport('submit iOS release', () => releaseApp(ascClient, releaseInput));
      return { buildId: storeBuild.id };
    });

  /** Submit the latest stored Android build to the Play production track. */
  const submitAndroid = (): Effect.Effect<
    Readonly<{ buildId?: string }>,
    TrainRuntimeFailure,
    FileSystem.FileSystem | LaunchPathsService | Path.Path
  > =>
    Effect.gen(function* () {
      if (appDescriptor.packageName === undefined) {
        return yield* Effect.fail(
          runtimeFailure(
            'resolve Android package name',
            appDescriptor,
            `${appDescriptor.name} has no Android package (android.package in app.json).`,
          ),
        );
      }
      const storageProvider = yield* resolveStorageProvider(launchConfiguration).pipe(
        Effect.mapError((cause) => runtimeFailure('resolve build storage', cause)),
      );
      const storedBuilds = yield* storageProvider
        .list()
        .pipe(Effect.mapError((cause) => runtimeFailure('read stored Android builds', cause)));
      const latestBuild = storedBuilds.find(
        (storedBuild) =>
          storedBuild.appName === appDescriptor.name && storedBuild.platform === 'android',
      );
      if (latestBuild === undefined) {
        return yield* Effect.fail(
          runtimeFailure(
            'find stored Android build',
            appDescriptor.name,
            `No stored Android build for ${appDescriptor.name}. Run \`launch build android\` first.`,
          ),
        );
      }
      yield* ensureArtifactPresent(latestBuild, appDescriptor.name, 'android').pipe(
        Effect.mapError((cause) => runtimeFailure('verify stored Android build', cause)),
      );
      let rollout = buildProfile.rollout;
      if (rollout === undefined) rollout = 1;
      const androidRelease: AndroidReleaseOptions = { track: 'production', rollout };
      const buildContext: ResolvedBuildContext = {
        platform: 'android',
        app: appDescriptor,
        profile: buildProfile,
        env: environmentValues,
        explain: false,
        dryRun: false,
        forceClean: false,
        android: androidRelease,
      };
      const credentialsProvider = yield* getCredentialsProvider(
        launchConfiguration.credentials,
      ).pipe(Effect.mapError((cause) => runtimeFailure('resolve credentials provider', cause)));
      const buildCredentials = yield* credentialsProvider
        .resolveBuildCredentials(buildContext)
        .pipe(Effect.mapError((cause) => runtimeFailure('resolve Android credentials', cause)));
      yield* submitToStores(
        launchConfiguration,
        'android',
        latestBuild.path,
        'production',
        buildCredentials,
        buildContext,
      ).pipe(Effect.mapError((cause) => runtimeFailure('submit Android release', cause)));
      return { buildId: String(latestBuild.buildNumber) };
    });

  /** Export and publish one OTA follower after its native platform is live. */
  const publishOta = (
    trainCar: Extract<Car, { kind: 'ota' }>,
  ): Effect.Effect<
    Readonly<{ manifestId?: string }>,
    TrainRuntimeFailure,
    | FileSystem.FileSystem
    | LaunchEnvironmentService
    | LaunchPathsService
    | LaunchSecretStoreService
    | Path.Path
    | PlatformCommandExecutor.CommandExecutor
  > =>
    Effect.gen(function* () {
      if (!isCloudStorage(launchConfiguration)) {
        return yield* Effect.fail(
          runtimeFailure(
            'resolve OTA storage',
            launchConfiguration.storage,
            'OTA needs a cloud storage provider (s3 / supabase).',
          ),
        );
      }
      const storageProvider = yield* resolveStorageProvider(launchConfiguration).pipe(
        Effect.mapError((cause) => runtimeFailure('resolve OTA storage', cause)),
      );
      const pathService = yield* Path.Path;
      const distributionDirectory = pathService.join(appDescriptor.dir, 'dist');
      yield* logger
        .run(`Exporting JS bundle - ${appDescriptor.name}`)
        .pipe(Effect.mapError((cause) => runtimeFailure('render OTA export step', cause)));
      yield* executeCommand('npx', ['expo', 'export', '--output-dir', distributionDirectory], {
        workingDirectory: appDescriptor.dir,
        environmentOverrides: environmentValues,
      }).pipe(Effect.mapError((cause) => runtimeFailure('export OTA bundle', cause)));
      const exportMetadata = yield* readExportMetadata(distributionDirectory).pipe(
        Effect.mapError((cause) => runtimeFailure('read OTA export metadata', cause)),
      );
      const codeSigner = yield* resolveCodeSigner();
      const publishedUpdate = yield* publishOtaPlatform(
        {
          storage: storageProvider,
          distDir: distributionDirectory,
          metadata: exportMetadata,
          platform: trainCar.platform,
          channel: trainCar.channel,
          runtimeVersion: trainCar.runtimeVersion,
          signer: codeSigner,
        },
        logger,
      ).pipe(Effect.mapError((cause) => runtimeFailure('publish OTA update', cause)));
      if (publishedUpdate.manifestId === undefined) return {};
      return { manifestId: publishedUpdate.manifestId };
    });

  const engine: TrainEngine<TrainRuntimeRequirements> = {
    submitNative: (trainCar) => {
      if (trainCar.kind === 'ios') return submitIos();
      return submitAndroid();
    },
    readNative: (trainCar) =>
      Effect.gen(function* () {
        if (trainCar.kind === 'ios') {
          const bundleId = appDescriptor.bundleId;
          if (bundleId === undefined) return trainCar.state;
          const ascClient = yield* resolveAppleClient();
          const releaseStatus = yield* attemptTransport('read App Store release status', () =>
            readReleaseStatus(ascClient, bundleId, IOS_PLATFORM),
          );
          const nextState = iosCarState(releaseStatus.verdict);
          if (nextState === null) return trainCar.state;
          return nextState;
        }
        const packageName = appDescriptor.packageName;
        if (packageName === undefined) return trainCar.state;
        const playClient = yield* resolveGoogleClient();
        const trackReleases = yield* playClient
          .getTrackReleases(packageName, 'production')
          .pipe(Effect.mapError((cause) => runtimeFailure('read Play production track', cause)));
        const nextState = androidCarState(trackReleases);
        if (nextState === null) return trainCar.state;
        return nextState;
      }),
    releaseNative: (trainCar) =>
      Effect.gen(function* () {
        if (trainCar.kind !== 'ios') return;
        const bundleId = appDescriptor.bundleId;
        if (bundleId === undefined) return;
        const ascClient = yield* resolveAppleClient();
        const appId = yield* attemptTransport('find App Store app', () =>
          ascClient.getAppId(bundleId),
        );
        if (appId === null) {
          return yield* Effect.fail(
            runtimeFailure(
              'find App Store app',
              bundleId,
              appRecordMissingMessage(bundleId, 'launch release-train release'),
            ),
          );
        }
        const storeVersions = yield* attemptTransport('list App Store versions', () =>
          ascClient.listAppStoreVersions(appId, IOS_PLATFORM),
        );
        const currentVersion = pickCurrentVersion(storeVersions);
        if (currentVersion === null) return;
        yield* attemptTransport('release approved App Store version', () =>
          ascClient.createAppStoreVersionReleaseRequest(currentVersion.id),
        );
      }),
    publishOta,
  };
  return { engine };
};
