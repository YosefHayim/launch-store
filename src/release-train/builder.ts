import { join } from 'node:path';
import { resolveAndroidSubmitReleaseNotes, submitToStores } from '../build/pipeline-providers.ts';
import { loadActiveAscKey } from '../credentials/accounts.ts';
import {
  describeMissingPlayServiceAccount,
  loadServiceAccount,
} from '../credentials/android-keystore-assets.ts';
import { ensureCodeSigner, type CodeSigner } from '../credentials/code-sign.ts';
import { publishOtaPlatform, readExportMetadata } from '../distribution/ota-publish.ts';
import {
  ensureArtifactPresent,
  isCloudStorage,
  resolveStorageProvider,
} from '../distribution/storage.ts';
import {
  IOS_PLATFORM,
  pickCurrentVersion,
  readReleaseStatus,
  releaseApp,
  type AscReleaseApi,
  type ReleaseInput,
} from '../release/app-store-release.ts';
import { resolveReleaseType, resolveWhatsNew } from '../release/release-inputs.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { executeCommand, type CommandExecutionOptions } from '../services/platform/exec.ts';
import type { Logger } from '../services/platform/logger.ts';
import { getCredentialsProvider } from '../services/provider-support/registry.ts';
import {
  AppleStoreClientService,
  appRecordMissingMessage,
} from '../services/stores/apple-store-client.ts';
import {
  GoogleStoreClientService,
  type EffectGooglePlayClient,
} from '../services/stores/google-store-client.ts';
import type { AndroidReleaseOptions, AppDescriptor, BuildProfile } from '../types/app.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.ts';
import type { CredentialsProvider } from '../types/providers.ts';
import type { NativeCar, NativeCarState, OtaCar } from '../types/release-train.ts';
import { androidCarState, iosCarState } from './engine.ts';
import type { TrainEngine } from './orchestrator.ts';

type TrainRuntimeFailure = Readonly<{
  _tag: 'TrainRuntimeFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

type NativeSubmission = Readonly<{ buildId?: string }>;
type OtaPublication = Readonly<{ manifestId?: string }>;

/** Live train engine assembled for one app and profile. */
export type TrainRuntime = Readonly<{
  engine: TrainEngine;
}>;

function trainRuntimeFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): TrainRuntimeFailure {
  let message = fallbackMessage;

  if (message == null) {
    message = errorMessage(cause);
  }

  const isMessageEmpty = message.length == 0;

  if (isMessageEmpty) {
    message = `${operation} failed.`;
  }

  return { _tag: 'TrainRuntimeFailure', operation, message, cause };
}

async function runTrainStep<StepOutcome>(
  operation: string,
  step: Promise<StepOutcome>,
): Promise<StepOutcome> {
  try {
    return await step;
  } catch (cause) {
    throw trainRuntimeFailure(operation, cause);
  }
}

/** Whether an App Store build is processed and still usable for train submit. */
export function isUsableIosStoreBuild(storeBuild: {
  processingState: string;
  expired: boolean;
}): boolean {
  const isProcessed = storeBuild.processingState == 'VALID';

  if (isProcessed == false) {
    return false;
  }

  return storeBuild.expired == false;
}

/** Whether a stored artifact is the latest Android build for the given app. */
export function isStoredAndroidBuild(
  storedBuild: Pick<BuildArtifact, 'appName' | 'platform'>,
  appName: string,
): boolean {
  const isSameApp = storedBuild.appName == appName;

  if (isSameApp == false) {
    return false;
  }

  return storedBuild.platform == 'android';
}

/** Actionable message when marketing version cannot be determined. */
export function marketingVersionMissingMessage(appName: string): string {
  return `Could not determine a marketing version for ${appName}. Set "version" in app.json.`;
}

/** Keep a non-empty marketing version; null when absent or blank. */
export function usableMarketingVersion(versionString: string | undefined): string | null {
  const isMissing = versionString == null;

  if (isMissing) {
    return null;
  }

  const isBlank = versionString == '';

  if (isBlank) {
    return null;
  }

  return versionString;
}

function readRolloutFraction(declaredRollout: number | undefined): number {
  const isRolloutMissing = declaredRollout == null;

  if (isRolloutMissing) {
    return 1;
  }

  return declaredRollout;
}

/** Assemble the live engine for one release-train run. */
export function createTrainRuntime(
  launchConfiguration: LaunchConfig,
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  environmentValues: Record<string, string>,
  holdReleases: boolean,
  logger: Logger,
): TrainRuntime {
  let cachedAppleClient: AscReleaseApi | null = null;
  let cachedGoogleClient: EffectGooglePlayClient | null = null;
  let cachedCodeSigner: CodeSigner | null = null;

  async function loadAppleClient(): Promise<AscReleaseApi> {
    if (cachedAppleClient != null) {
      return cachedAppleClient;
    }

    try {
      var ascKey = await loadActiveAscKey();
    } catch (cause) {
      throw trainRuntimeFailure('load active Apple account', cause);
    }

    const activeAscKey = ascKey;
    const isKeyMissing = activeAscKey == null;

    if (isKeyMissing) {
      throw trainRuntimeFailure(
        'load active Apple account',
        appDescriptor.name,
        'No active Apple account. Run `launch creds set-key` first.',
      );
    }

    try {
      cachedAppleClient = AppleStoreClientService.createClient(activeAscKey);
    } catch (cause) {
      throw trainRuntimeFailure('create App Store client', cause);
    }

    return cachedAppleClient;
  }

  async function loadGoogleClient(): Promise<EffectGooglePlayClient> {
    if (cachedGoogleClient != null) {
      return cachedGoogleClient;
    }

    const packageName = appDescriptor.packageName;
    const isPackageMissing = packageName == null;

    if (isPackageMissing) {
      throw trainRuntimeFailure(
        'load Google Play service account',
        appDescriptor.name,
        'Set android.package before using Google Play.',
      );
    }

    const isPackageBlank = packageName == '';

    if (isPackageBlank) {
      throw trainRuntimeFailure(
        'load Google Play service account',
        appDescriptor.name,
        'Set android.package before using Google Play.',
      );
    }

    try {
      var serviceAccountJson = await loadServiceAccount(packageName);
    } catch (cause) {
      throw trainRuntimeFailure('load Google Play service account', cause);
    }

    const loadedServiceAccount = serviceAccountJson;
    const isAccountMissing = loadedServiceAccount == null;

    if (isAccountMissing) {
      let missingAccountMessage = '';

      try {
        missingAccountMessage = await describeMissingPlayServiceAccount(appDescriptor.name);
      } catch (cause) {
        throw trainRuntimeFailure('load Google Play service account', cause);
      }

      throw trainRuntimeFailure(
        'load Google Play service account',
        appDescriptor.name,
        missingAccountMessage,
      );
    }

    try {
      cachedGoogleClient = GoogleStoreClientService.createClient(loadedServiceAccount);
    } catch (cause) {
      throw trainRuntimeFailure('create Google Play client', cause);
    }

    return cachedGoogleClient;
  }

  async function loadCodeSigner(): Promise<CodeSigner> {
    if (cachedCodeSigner != null) {
      return cachedCodeSigner;
    }

    try {
      cachedCodeSigner = await ensureCodeSigner(false, logger);
    } catch (cause) {
      throw trainRuntimeFailure('load OTA code signer', cause);
    }

    return cachedCodeSigner;
  }

  async function readVersionCandidate(
    ascClient: AscReleaseApi,
    bundleId: string,
  ): Promise<string | undefined> {
    const configuredVersion = appDescriptor.version;
    const hasConfiguredVersion = configuredVersion != null;

    if (hasConfiguredVersion) {
      return configuredVersion;
    }

    const storeVersion = await runTrainStep(
      'read App Store version',
      ascClient.getLatestMarketingVersion(bundleId),
    );
    const isStoreVersionMissing = storeVersion == null;

    if (isStoreVersionMissing) {
      return undefined;
    }

    return storeVersion;
  }

  async function submitIos(): Promise<NativeSubmission> {
    const bundleId = appDescriptor.bundleId;
    const isBundleMissing = bundleId == null;

    if (isBundleMissing) {
      throw trainRuntimeFailure(
        'resolve iOS bundle identifier',
        appDescriptor,
        `${appDescriptor.name} has no iOS bundle id (ios.bundleIdentifier in app.json).`,
      );
    }

    const ascClient = await loadAppleClient();
    const appId = await runTrainStep('find App Store app', ascClient.getAppId(bundleId));
    const isAppMissing = appId == null;

    if (isAppMissing) {
      throw trainRuntimeFailure(
        'find App Store app',
        bundleId,
        appRecordMissingMessage(bundleId, 'launch release-train start'),
      );
    }

    const storeBuilds = await runTrainStep('list App Store builds', ascClient.listBuilds(appId));
    const storeBuild = storeBuilds.find(isUsableIosStoreBuild);
    const isBuildMissing = storeBuild == null;

    if (isBuildMissing) {
      throw trainRuntimeFailure(
        'find processed iOS build',
        appDescriptor.name,
        `No processed iOS build on App Store Connect for ${appDescriptor.name}. Run \`launch build ios\` and upload it (\`launch testflight\` or \`launch release ios --no-wait\`) before starting the train.`,
      );
    }

    const versionCandidate = await readVersionCandidate(ascClient, bundleId);
    const marketingVersion = usableMarketingVersion(versionCandidate);
    const isMarketingVersionMissing = marketingVersion == null;

    if (isMarketingVersionMissing) {
      throw trainRuntimeFailure(
        'resolve iOS marketing version',
        appDescriptor,
        marketingVersionMissingMessage(appDescriptor.name),
      );
    }

    const releaseTypeSettings = resolveReleaseType(launchConfiguration.release, {
      manual: holdReleases,
    });
    const releaseNotes = await runTrainStep(
      'read iOS release notes',
      resolveWhatsNew(launchConfiguration.release, appDescriptor.dir),
    );
    let releaseInput: ReleaseInput = {
      bundleId,
      platform: IOS_PLATFORM,
      versionString: marketingVersion,
      releaseType: releaseTypeSettings.releaseType,
      phasedRelease: launchConfiguration.release?.phasedRelease == true,
      usesNonExemptEncryption: launchConfiguration.release?.usesNonExemptEncryption == true,
      whatsNew: releaseNotes,
      build: storeBuild,
      dryRun: false,
      attachOnly: false,
    };
    const earliestReleaseDate = releaseTypeSettings.earliestReleaseDate;
    const hasEarliestReleaseDate = earliestReleaseDate != null;

    if (hasEarliestReleaseDate) {
      releaseInput = { ...releaseInput, earliestReleaseDate };
    }

    const copyright = launchConfiguration.release?.copyright;
    const hasCopyright = copyright != null;

    if (hasCopyright) {
      releaseInput = { ...releaseInput, copyright };
    }

    await runTrainStep('submit iOS release', releaseApp(ascClient, releaseInput));

    return { buildId: storeBuild.id };
  }

  async function submitAndroid(): Promise<NativeSubmission> {
    const packageName = appDescriptor.packageName;
    const isPackageMissing = packageName == null;

    if (isPackageMissing) {
      throw trainRuntimeFailure(
        'resolve Android package name',
        appDescriptor,
        `${appDescriptor.name} has no Android package (android.package in app.json).`,
      );
    }

    const isPackageBlank = packageName == '';

    if (isPackageBlank) {
      throw trainRuntimeFailure(
        'resolve Android package name',
        appDescriptor,
        `${appDescriptor.name} has no Android package (android.package in app.json).`,
      );
    }

    const storageProvider = await runTrainStep(
      'resolve build storage',
      resolveStorageProvider(launchConfiguration),
    );
    const storedBuilds = await runTrainStep('read stored Android builds', storageProvider.list());

    function isThisAppBuild(storedBuild: BuildArtifact): boolean {
      return isStoredAndroidBuild(storedBuild, appDescriptor.name);
    }

    const latestBuild = storedBuilds.find(isThisAppBuild);
    const isBuildMissing = latestBuild == null;

    if (isBuildMissing) {
      throw trainRuntimeFailure(
        'find stored Android build',
        appDescriptor.name,
        `No stored Android build for ${appDescriptor.name}. Run \`launch build android\` first.`,
      );
    }

    await runTrainStep(
      'verify stored Android build',
      ensureArtifactPresent(latestBuild, appDescriptor.name, 'android'),
    );

    const rollout = readRolloutFraction(buildProfile.rollout);
    let androidRelease: AndroidReleaseOptions = { track: 'production', rollout };
    const releaseNotes = await runTrainStep(
      'read Android release notes',
      resolveAndroidSubmitReleaseNotes(launchConfiguration, appDescriptor.dir, undefined),
    );
    const hasReleaseNotes = releaseNotes.length > 0;

    if (hasReleaseNotes) {
      androidRelease = { ...androidRelease, releaseNotes };
    }

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
    let credentialsProvider: CredentialsProvider;

    try {
      credentialsProvider = getCredentialsProvider(launchConfiguration.credentials);
    } catch (cause) {
      throw trainRuntimeFailure('resolve credentials provider', cause);
    }

    const buildCredentials = await runTrainStep(
      'resolve Android credentials',
      credentialsProvider.resolveBuildCredentials(buildContext),
    );
    await runTrainStep(
      'submit Android release',
      submitToStores(launchConfiguration, 'android', latestBuild, buildCredentials, buildContext),
    );

    return { buildId: String(latestBuild.buildNumber) };
  }

  async function readIosCar(trainCar: NativeCar): Promise<NativeCarState> {
    const bundleId = appDescriptor.bundleId;
    const isBundleMissing = bundleId == null;

    if (isBundleMissing) {
      return trainCar.state;
    }

    const ascClient = await loadAppleClient();
    const releaseStatus = await runTrainStep(
      'read App Store release status',
      readReleaseStatus(ascClient, bundleId, IOS_PLATFORM),
    );
    const nextCarPhase = iosCarState(releaseStatus.verdict);
    const isPhaseUnknown = nextCarPhase == null;

    if (isPhaseUnknown) {
      return trainCar.state;
    }

    return nextCarPhase;
  }

  async function readAndroidCar(trainCar: NativeCar): Promise<NativeCarState> {
    const packageName = appDescriptor.packageName;
    const isPackageMissing = packageName == null;

    if (isPackageMissing) {
      return trainCar.state;
    }

    const isPackageBlank = packageName == '';

    if (isPackageBlank) {
      return trainCar.state;
    }

    const playClient = await loadGoogleClient();
    const trackReleases = await runTrainStep(
      'read Play production track',
      playClient.getTrackReleases(packageName, 'production'),
    );
    const nextCarPhase = androidCarState(trackReleases);
    const isPhaseUnknown = nextCarPhase == null;

    if (isPhaseUnknown) {
      return trainCar.state;
    }

    return nextCarPhase;
  }

  async function submitNative(trainCar: NativeCar): Promise<NativeSubmission> {
    if (trainCar.kind == 'ios') {
      return submitIos();
    }

    return submitAndroid();
  }

  async function readNative(trainCar: NativeCar): Promise<NativeCarState> {
    if (trainCar.kind == 'ios') {
      return readIosCar(trainCar);
    }

    return readAndroidCar(trainCar);
  }

  async function releaseNative(trainCar: NativeCar): Promise<void> {
    const isIos = trainCar.kind == 'ios';

    if (isIos == false) {
      return;
    }

    const bundleId = appDescriptor.bundleId;
    const isBundleMissing = bundleId == null;

    if (isBundleMissing) {
      return;
    }

    const ascClient = await loadAppleClient();
    const appId = await runTrainStep('find App Store app', ascClient.getAppId(bundleId));
    const isAppMissing = appId == null;

    if (isAppMissing) {
      throw trainRuntimeFailure(
        'find App Store app',
        bundleId,
        appRecordMissingMessage(bundleId, 'launch release-train release'),
      );
    }

    const storeVersions = await runTrainStep(
      'list App Store versions',
      ascClient.listAppStoreVersions(appId, IOS_PLATFORM),
    );
    const currentVersion = pickCurrentVersion(storeVersions);
    const isVersionMissing = currentVersion == null;

    if (isVersionMissing) {
      return;
    }

    await runTrainStep(
      'release approved App Store version',
      ascClient.createAppStoreVersionReleaseRequest(currentVersion.id),
    );
  }

  async function publishOta(trainCar: OtaCar): Promise<OtaPublication> {
    const hasCloudStorage = isCloudStorage(launchConfiguration);

    if (hasCloudStorage == false) {
      throw trainRuntimeFailure(
        'resolve OTA storage',
        launchConfiguration.storage,
        'OTA needs a cloud storage provider (s3 / supabase).',
      );
    }

    const storageProvider = await runTrainStep(
      'resolve OTA storage',
      resolveStorageProvider(launchConfiguration),
    );
    const distributionDirectory = join(appDescriptor.dir, 'dist');

    try {
      logger.run(`Exporting JS bundle - ${appDescriptor.name}`);
    } catch (cause) {
      throw trainRuntimeFailure('render OTA export step', cause);
    }

    let exportOptions: CommandExecutionOptions = {
      workingDirectory: appDescriptor.dir,
      environmentOverrides: environmentValues,
    };
    const excludedNames = launchConfiguration.envExclude;
    const hasExclusions = excludedNames != null;

    if (hasExclusions) {
      exportOptions = { ...exportOptions, envExclude: excludedNames };
    }

    await runTrainStep(
      'export OTA bundle',
      executeCommand(
        'npx',
        ['expo', 'export', '--output-dir', distributionDirectory],
        exportOptions,
      ),
    );

    const exportMetadata = await runTrainStep(
      'read OTA export metadata',
      readExportMetadata(distributionDirectory),
    );
    const codeSigner = await loadCodeSigner();
    const publishedUpdate = await runTrainStep(
      'publish OTA update',
      publishOtaPlatform(
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
      ),
    );
    const publishedManifestId = publishedUpdate.manifestId;
    const hasManifestId = publishedManifestId != null;

    if (hasManifestId == false) {
      return {};
    }

    return { manifestId: publishedManifestId };
  }

  const engine: TrainEngine = {
    submitNative,
    readNative,
    releaseNative,
    publishOta,
  };

  return { engine };
}
