import { type FileSystem, type Path, Terminal } from '@effect/platform';
import type { HttpClient } from '@effect/platform';
import { Context, Data, Effect, Layer } from 'effect';
import { worstDownloadBytes } from '../build/pipelineArtifact.js';
import { resolveCommandEnv, selectApp } from '../build/pipelineEnv.js';
import { mb, submitToStores } from '../build/pipelineProviders.js';
import { resolveIosAccount } from '../build/pipelineSigning.js';
import { loadConfig } from '../config/config.js';
import { formatEnvTable, parseCliEnv, type ResolvedEnv } from '../config/env.js';
import { loadAscKeyById } from '../credentials/accounts.js';
import { ensureArtifactPresent, resolveStorageProvider } from '../distribution/storage.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientDependencies,
} from '../services/appleStoreClient.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import { notify, type NotifyEvent } from '../services/notify.js';
import type { LaunchPathsService } from '../services/paths.js';
import { getCredentialsProvider } from '../services/registry.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import {
  isApplePlatform,
  parsePlatform,
  platformLabel,
  toAscPlatform,
} from '../services/platform.js';
import { LaunchPrompt, type LaunchPromptService, pickOne } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AndroidReleaseOptions, AppDescriptor, BuildProfile, Platform } from '../types/app.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { BuildResource } from '../types/appleCatalog.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import {
  appRecordMissingMessage,
  releaseApp,
  waitForValidBuild,
  type AscReleaseApi,
  type ReleaseAction,
  type ReleaseInput,
  type ReleaseReport,
} from './appStoreRelease.js';
import { resolveReleaseConfirmationMode } from './confirmation.js';
import { resolveReleaseType, resolveWhatsNew } from './releaseInputs.js';

/** Parsed flags accepted by the public release command. */
export type ReleaseCommandOptions = Readonly<{
  env: string[];
  includeLocal: boolean;
  printEnv: boolean;
  app?: string;
  profile: string;
  explain: boolean;
  account?: string;
  rollout?: string;
  build?: string;
  upload?: boolean;
  wait: boolean;
  manual?: boolean;
  scheduled?: string;
  phased?: boolean;
  dryRun?: boolean;
  createApp?: boolean;
  yes: boolean;
}>;

/** A release operation failed before it could produce a store report. */
export type ReleaseCommandFailure = Readonly<{
  readonly _tag: 'ReleaseCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeReleaseCommandFailure =
  Data.tagged<ReleaseCommandFailure>('ReleaseCommandFailure');

/** Injectable terminal boundary for public release orchestration. */
export type ReleaseCommandService = Readonly<{
  terminalIsInteractive: boolean;
  confirmRelease: (message: string) => Effect.Effect<boolean, ReleaseCommandFailure>;
  cancelRelease: () => Effect.Effect<void>;
}>;
export const ReleaseCommandService =
  Context.GenericTag<ReleaseCommandService>('ReleaseCommandService');

/** How an operator selected which App Store build to promote. */
export type AppStoreBuildSelector =
  | Readonly<{ kind: 'latest' }>
  | Readonly<{ kind: 'number'; buildNumber: number }>
  | Readonly<{ kind: 'invalid'; selector: string }>;

type ReleaseInputCommon = Omit<ReleaseInput, 'versionString' | 'build' | 'dryRun'>;
type BuildSource =
  | Readonly<{ kind: 'upload' }>
  | Readonly<{ kind: 'promote'; storeBuild: BuildResource }>;
type SelectedStoreBuild = Readonly<{ storeBuild: BuildResource; versionString: string }>;

const releaseFailure = (
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): ReleaseCommandFailure => {
  let message = fallbackMessage;
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = `${operation} failed.`;
  return makeReleaseCommandFailure({ operation, message, cause });
};

const attemptRead = <ReadOutput>(
  operation: string,
  read: Effect.Effect<ReadOutput, unknown>,
): Effect.Effect<ReadOutput, ReleaseCommandFailure> =>
  read.pipe(Effect.mapError((cause) => releaseFailure(operation, cause)));

const writeLog = (
  operation: string,
  logWrite: ReturnType<Logger['line']>,
): Effect.Effect<void, ReleaseCommandFailure> =>
  logWrite.pipe(Effect.mapError((cause) => releaseFailure(operation, cause)));

/** Whether an incrementally-built artifact needs a second public-release confirmation. */
export const shouldNudgeRelease = (artifact: Pick<BuildArtifact, 'clean'>): boolean =>
  !artifact.clean;

/** Whether an App Store build is processed and still usable for promotion. */
export const isVerifiedStoreBuild = (storeBuild: BuildResource): boolean =>
  storeBuild.processingState === 'VALID' && !storeBuild.expired;

/** Select the newest processed, non-expired App Store build. */
export const newestValidBuild = (storeBuilds: readonly BuildResource[]): BuildResource | null => {
  const newestBuild = storeBuilds.find(isVerifiedStoreBuild);
  if (newestBuild === undefined) return null;
  return newestBuild;
};

/** Parse `--build latest` or `--build <n>` into a typed selector. */
export const parseAppStoreBuildSelector = (selector: string): AppStoreBuildSelector => {
  if (selector === 'latest') return { kind: 'latest' };
  const buildNumber = Number.parseInt(selector, 10);
  if (Number.isNaN(buildNumber)) return { kind: 'invalid', selector };
  return { kind: 'number', buildNumber };
};

/** Resolve the staged-rollout fraction for a Play production release. */
export const resolveAndroidRollout = (
  profileRollout: number | undefined,
  rolloutFlag: string | undefined,
): number => {
  if (rolloutFlag !== undefined) return Number.parseFloat(rolloutFlag);
  if (profileRollout !== undefined) return profileRollout;
  return 1;
};

/** Format one release-plan / receipt line from a recorded action. */
export const formatReleaseActionLine = (
  releaseAction: ReleaseAction,
  mode: 'plan' | 'receipt',
): string => {
  if (mode === 'receipt' && releaseAction.status === 'failed') {
    let errorSuffix = '';
    if (releaseAction.error !== undefined) errorSuffix = ` - ${releaseAction.error}`;
    return `x ${releaseAction.description}${errorSuffix}`;
  }
  let noteSuffix = '';
  if (releaseAction.status === 'skipped' && releaseAction.note !== undefined) {
    noteSuffix = ` (${releaseAction.note})`;
  }
  return `- ${releaseAction.description}${noteSuffix}`;
};

/** Count failed steps in a release report for exit-code decisions. */
export const countFailedReleaseActions = (releaseReport: ReleaseReport): number => {
  let failureCount = 0;
  for (const releaseAction of releaseReport.actions) {
    if (releaseAction.status === 'failed') failureCount += 1;
  }
  return failureCount;
};

const findStoredPlatformBuild = (
  storedBuilds: readonly BuildArtifact[],
  appName: string,
  platform: Platform,
): BuildArtifact | undefined =>
  storedBuilds.find(
    (storedBuild) => storedBuild.appName === appName && storedBuild.platform === platform,
  );

const resolveVersionString = (
  ascClient: AscReleaseApi,
  appDescriptor: AppDescriptor,
  bundleId: string,
): Effect.Effect<string, ReleaseCommandFailure> =>
  Effect.gen(function* () {
    const configuredVersion = appDescriptor.version;
    if (configuredVersion !== undefined) return configuredVersion;
    const latestVersion = yield* attemptRead(
      'read latest App Store version',
      ascClient.getLatestMarketingVersion(bundleId),
    );
    if (latestVersion !== null) return latestVersion;
    return yield* Effect.fail(
      releaseFailure(
        'resolve marketing version',
        appDescriptor,
        `Could not determine a marketing version for ${appDescriptor.name}. Set "version" in app.json.`,
      ),
    );
  });

const confirmPublicRelease = (
  commandService: ReleaseCommandService,
  message: string,
  commandOptions: ReleaseCommandOptions,
): Effect.Effect<boolean, ReleaseCommandFailure> =>
  Effect.gen(function* () {
    const confirmationMode = yield* resolveReleaseConfirmationMode({
      yes: commandOptions.yes === true,
      canPrompt: commandService.terminalIsInteractive,
    }).pipe(
      Effect.mapError((cause) => releaseFailure('confirm public release', cause, cause.message)),
    );
    if (confirmationMode === 'confirmed') return true;
    return yield* commandService.confirmRelease(message);
  });

const confirmOrCancel = (
  commandService: ReleaseCommandService,
  message: string,
  commandOptions: ReleaseCommandOptions,
): Effect.Effect<boolean, ReleaseCommandFailure> =>
  Effect.gen(function* () {
    const confirmed = yield* confirmPublicRelease(commandService, message, commandOptions);
    if (confirmed) return true;
    yield* commandService.cancelRelease();
    return false;
  });

const confirmIncrementalArtifact = (
  commandService: ReleaseCommandService,
  artifact: Pick<BuildArtifact, 'clean'>,
  message: string,
  commandOptions: ReleaseCommandOptions,
): Effect.Effect<boolean, ReleaseCommandFailure> => {
  if (!shouldNudgeRelease(artifact)) return Effect.succeed(true);
  return confirmOrCancel(commandService, message, commandOptions);
};

const renderReleasePlan = (
  releaseReport: ReleaseReport,
  appName: string,
  logger: Logger,
): Effect.Effect<void, ReleaseCommandFailure> => {
  const planLines = releaseReport.actions.map((releaseAction) =>
    formatReleaseActionLine(releaseAction, 'plan'),
  );
  if (planLines.length === 0) planLines.push('nothing to do - already submitted or up to date');
  return writeLog(
    'render release plan',
    logger.box(
      `Plan - ${appName} ${releaseReport.versionString} (dry run, nothing submitted)`,
      planLines,
    ),
  );
};

const renderReleaseReport = (
  releaseReport: ReleaseReport,
  appName: string,
  buildLabel: string,
  logger: Logger,
): Effect.Effect<number, ReleaseCommandFailure> => {
  if (releaseReport.alreadyInReview) {
    return writeLog(
      'render release report',
      logger.note(
        `${appName} ${releaseReport.versionString} is already ${releaseReport.appStoreState} - nothing to submit.`,
      ),
    ).pipe(Effect.as(0));
  }
  const failureCount = countFailedReleaseActions(releaseReport);
  const receiptLines = releaseReport.actions.map((releaseAction) =>
    formatReleaseActionLine(releaseAction, 'receipt'),
  );
  let receiptTitle = 'Submitted for App Store review';
  if (failureCount > 0) receiptTitle = `Submitted with ${failureCount} failed step(s) - see below`;
  return writeLog(
    'render release report',
    logger.box(receiptTitle, [
      `${appName} ${releaseReport.versionString} (build ${buildLabel})`,
      ...receiptLines,
    ]),
  ).pipe(Effect.as(failureCount));
};

const exitMissingAppRecord = (
  bundleId: string,
  logger: Logger,
): Effect.Effect<void, CommandExit | ReleaseCommandFailure> =>
  Effect.gen(function* () {
    yield* writeLog(
      'render missing App Store record',
      logger.note(appRecordMissingMessage(bundleId)),
    );
    yield* completeCommand(1);
  });

const resolveBuildToPromote = (
  ascClient: AscReleaseApi,
  appId: string,
  appName: string,
  selector: string,
): Effect.Effect<BuildResource, ReleaseCommandFailure> =>
  Effect.gen(function* () {
    const buildSelector = parseAppStoreBuildSelector(selector);
    if (buildSelector.kind === 'invalid') {
      return yield* Effect.fail(
        releaseFailure(
          'parse App Store build selector',
          selector,
          `--build must be a build number or "latest" (got "${selector}").`,
        ),
      );
    }
    if (buildSelector.kind === 'latest') {
      const storeBuilds = yield* attemptRead('list App Store builds', ascClient.listBuilds(appId));
      const storeBuild = newestValidBuild(storeBuilds);
      if (storeBuild !== null) return storeBuild;
      return yield* Effect.fail(
        releaseFailure(
          'resolve App Store build',
          selector,
          `No processed build on App Store Connect for ${appName}. Upload one first.`,
        ),
      );
    }
    const storeBuild = yield* attemptRead(
      'find App Store build',
      ascClient.findBuildByVersion(appId, buildSelector.buildNumber),
    );
    if (storeBuild !== null) return storeBuild;
    return yield* Effect.fail(
      releaseFailure(
        'find App Store build',
        selector,
        `No build ${buildSelector.buildNumber} on App Store Connect for ${appName}.`,
      ),
    );
  });

const resolveBuildSource = (
  ascClient: AscReleaseApi,
  appId: string,
  appName: string,
  commandOptions: ReleaseCommandOptions,
  logger: Logger,
  terminalIsInteractive: boolean,
): Effect.Effect<BuildSource, ReleaseCommandFailure, LaunchPromptService | Logger> =>
  Effect.gen(function* () {
    if (commandOptions.upload === true) return { kind: 'upload' };
    if (commandOptions.build !== undefined) {
      const storeBuild = yield* resolveBuildToPromote(
        ascClient,
        appId,
        appName,
        commandOptions.build,
      );
      return { kind: 'promote', storeBuild };
    }
    const storeBuilds = yield* attemptRead('list App Store builds', ascClient.listBuilds(appId));
    const verifiedBuilds = storeBuilds.filter(isVerifiedStoreBuild);
    if (verifiedBuilds.length === 0) {
      if (terminalIsInteractive)
        yield* writeLog(
          'render release build selection',
          logger.note(
            'No verified TestFlight build to promote yet - will upload the latest local build.',
          ),
        );
      return { kind: 'upload' };
    }
    const promoteOptions = verifiedBuilds.map((storeBuild) => {
      let hint = 'verified';
      if (storeBuild.uploadedDate !== undefined)
        hint = `verified - uploaded ${storeBuild.uploadedDate.slice(0, 10)}`;
      const promoteSource: BuildSource = { kind: 'promote', storeBuild };
      return {
        selection: promoteSource,
        label: `Promote build ${storeBuild.version}`,
        hint,
      };
    });
    const firstPromote = promoteOptions[0];
    const uploadSource: BuildSource = { kind: 'upload' };
    const selectionOptions = [
      {
        selection: uploadSource,
        label: 'Upload the latest local build',
        hint: 'send a fresh .ipa to TestFlight',
      },
      ...promoteOptions,
    ];
    if (firstPromote === undefined) return { kind: 'upload' };
    return yield* pickOne<BuildSource>({
      message: 'Release which build?',
      choices: selectionOptions,
      canPrompt: terminalIsInteractive,
      initialSelection: firstPromote.selection,
      nonInteractive: {
        kind: 'fallback',
        selection: uploadSource,
        note: 'Non-interactive: uploading the latest local build (pass --build <n> to promote a verified one).',
      },
    }).pipe(Effect.mapError((cause) => releaseFailure('select release build', cause)));
  });

const resolveIosBuild = (
  ascClient: AscReleaseApi,
  appId: string,
  appDescriptor: AppDescriptor,
  bundleId: string,
  launchConfig: LaunchConfig,
  commandOptions: ReleaseCommandOptions,
  buildContext: ResolvedBuildContext,
  logger: Logger,
  commandService: ReleaseCommandService,
): Effect.Effect<
  SelectedStoreBuild | null,
  ReleaseCommandFailure,
  FileSystem.FileSystem | LaunchPathsService | LaunchPromptService | Logger | Path.Path
> =>
  Effect.gen(function* () {
    const buildSource = yield* resolveBuildSource(
      ascClient,
      appId,
      appDescriptor.name,
      commandOptions,
      logger,
      commandService.terminalIsInteractive,
    );
    if (buildSource.kind === 'promote') {
      const versionString = yield* resolveVersionString(ascClient, appDescriptor, bundleId);
      const confirmed = yield* confirmOrCancel(
        commandService,
        `Submit ${appDescriptor.name} ${versionString} (build ${buildSource.storeBuild.version}) for App Store review?`,
        commandOptions,
      );
      if (!confirmed) return null;
      return { storeBuild: buildSource.storeBuild, versionString };
    }
    const storageProvider = yield* resolveStorageProvider(launchConfig).pipe(
      Effect.mapError((cause) => releaseFailure('resolve storage provider', cause)),
    );
    const storedBuilds = yield* storageProvider
      .list()
      .pipe(Effect.mapError((cause) => releaseFailure('read stored builds', cause)));
    const artifact = findStoredPlatformBuild(
      storedBuilds,
      appDescriptor.name,
      buildContext.platform,
    );
    if (artifact === undefined) {
      return yield* Effect.fail(
        releaseFailure(
          'find local release build',
          buildContext.platform,
          `No stored ${platformLabel(buildContext.platform)} build for ${appDescriptor.name}. Run \`launch build ${buildContext.platform}\` first, or promote one with --build.`,
        ),
      );
    }
    yield* ensureArtifactPresent(artifact, appDescriptor.name, buildContext.platform).pipe(
      Effect.mapError((cause) => releaseFailure('verify local release build', cause)),
    );
    const downloadBytes = worstDownloadBytes(artifact.sizeReport);
    const noticeDetails: string[] = [];
    if (downloadBytes > 0)
      noticeDetails.push(
        `download size ~${mb(downloadBytes)} (size budget already checked at build)`,
      );
    yield* writeLog(
      'render App Store release notice',
      logger.notice(
        `Release ${appDescriptor.name} ${artifact.version} (build ${artifact.buildNumber}) to the App Store`,
        ...noticeDetails,
      ),
    );
    const uploadConfirmed = yield* confirmOrCancel(
      commandService,
      `Upload and submit ${appDescriptor.name} ${artifact.version} (${artifact.buildNumber}) for review?`,
      commandOptions,
    );
    if (!uploadConfirmed) return null;
    const incrementalConfirmed = yield* confirmIncrementalArtifact(
      commandService,
      artifact,
      `This build was incremental, not clean - promote anyway? (\`launch build ${buildContext.platform} --clean\` for a fresh one)`,
      commandOptions,
    );
    if (!incrementalConfirmed) return null;
    const credentialsProvider = yield* getCredentialsProvider(launchConfig.credentials).pipe(
      Effect.mapError((cause) => releaseFailure('resolve credentials provider', cause)),
    );
    const buildCredentials = yield* credentialsProvider
      .resolveBuildCredentials(buildContext)
      .pipe(Effect.mapError((cause) => releaseFailure('resolve build credentials', cause)));
    yield* writeLog(
      'render App Store upload step',
      logger.step(
        'upload',
        `uploading build ${artifact.buildNumber} to App Store Connect`,
        'testflight',
      ),
    );
    yield* submitToStores(
      launchConfig,
      buildContext.platform,
      artifact.path,
      'production',
      buildCredentials,
      buildContext,
    ).pipe(Effect.mapError((cause) => releaseFailure('upload App Store build', cause)));
    if (!commandOptions.wait) {
      yield* writeLog(
        'render App Store upload outcome',
        logger.note(
          `Uploaded build ${artifact.buildNumber}; Apple is processing it. Once \`launch status -a ${appDescriptor.name}\` shows it VALID, submit with \`launch release ${buildContext.platform} -a ${appDescriptor.name} --build ${artifact.buildNumber}\`.`,
        ),
      );
      return null;
    }
    yield* writeLog(
      'render App Store processing step',
      logger.step('processing', 'waiting for App Store Connect to finish processing the build'),
    );
    const storeBuild = yield* attemptRead(
      'wait for App Store build processing',
      waitForValidBuild(ascClient, appId, artifact.buildNumber),
    );
    return { storeBuild, versionString: artifact.version };
  });

const releaseAppleBuild = (
  platform: Platform,
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  commandOptions: ReleaseCommandOptions,
  launchConfig: LaunchConfig,
  resolvedEnvironment: ResolvedEnv,
): Effect.Effect<
  void,
  CommandExit | ReleaseCommandFailure,
  | AppleStoreClientDependencies
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | ReleaseCommandService
  | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const commandService = yield* ReleaseCommandService;
    const appleStoreClient = yield* AppleStoreClientService;
    const logger = yield* createLogger(commandOptions.explain);
    const bundleId = appDescriptor.bundleId;
    if (bundleId === undefined) {
      return yield* Effect.fail(
        releaseFailure(
          'resolve Apple bundle id',
          appDescriptor,
          `${appDescriptor.name} has no bundle id (ios.bundleIdentifier in app.json).`,
        ),
      );
    }
    const accountRecord = yield* resolveIosAccount(commandOptions, logger).pipe(
      Effect.mapError((cause) => releaseFailure('resolve Apple account', cause)),
    );
    const ascKey = yield* loadAscKeyById(accountRecord.keyId).pipe(
      Effect.mapError((cause) => releaseFailure('load App Store Connect key', cause)),
    );
    if (ascKey === null) {
      return yield* Effect.fail(
        releaseFailure(
          'load App Store Connect key',
          accountRecord,
          `No App Store Connect key stored for account ${accountRecord.label}. Run \`launch creds set-key\`.`,
        ),
      );
    }
    const ascClient = yield* appleStoreClient
      .createClient(ascKey)
      .pipe(Effect.mapError((cause) => releaseFailure('create App Store client', cause)));
    const appId = yield* attemptRead('read App Store app id', ascClient.getAppId(bundleId));
    if (commandOptions.createApp === true) {
      yield* exitMissingAppRecord(bundleId, logger);
      return;
    }
    if (appId === null) {
      yield* exitMissingAppRecord(bundleId, logger);
      return;
    }
    const releaseTypeSettings = resolveReleaseType(launchConfig.release, commandOptions);
    const whatsNew = yield* resolveWhatsNew(launchConfig.release, appDescriptor.dir).pipe(
      Effect.mapError((cause) => releaseFailure('read release notes', cause)),
    );
    if (Object.keys(whatsNew).length === 0)
      yield* writeLog(
        'render missing release notes warning',
        logger.warn(
          "No release notes configured (release.releaseNotes or store.config.json) - keeps the existing What's New.",
        ),
      );
    const ascPlatform = yield* toAscPlatform(platform).pipe(
      Effect.mapError((cause) => releaseFailure('map App Store platform', cause, cause.message)),
    );
    let phasedRelease = commandOptions.phased === true;
    if (launchConfig.release?.phasedRelease === true) phasedRelease = true;
    const releaseInputCommon: ReleaseInputCommon = {
      bundleId,
      platform: ascPlatform,
      releaseType: releaseTypeSettings.releaseType,
      phasedRelease,
      usesNonExemptEncryption: launchConfig.release?.usesNonExemptEncryption === true,
      whatsNew,
    };
    if (releaseTypeSettings.earliestReleaseDate !== undefined)
      releaseInputCommon.earliestReleaseDate = releaseTypeSettings.earliestReleaseDate;
    if (commandOptions.dryRun === true) {
      let storeBuild: BuildResource | null = null;
      if (commandOptions.build !== undefined)
        storeBuild = yield* resolveBuildToPromote(
          ascClient,
          appId,
          appDescriptor.name,
          commandOptions.build,
        );
      if (storeBuild === null)
        yield* writeLog(
          'render release plan assumption',
          logger.note(
            'Plan assumes uploading the latest local build (pass --build <n> to plan against a verified build).',
          ),
        );
      const versionString = yield* resolveVersionString(ascClient, appDescriptor, bundleId);
      const releaseReport = yield* attemptRead(
        'plan App Store release',
        releaseApp(ascClient, {
          ...releaseInputCommon,
          versionString,
          build: storeBuild,
          dryRun: true,
        }),
      );
      yield* renderReleasePlan(releaseReport, appDescriptor.name, logger);
      return;
    }
    const buildContext: ResolvedBuildContext = {
      platform,
      app: appDescriptor,
      profile: buildProfile,
      env: resolvedEnvironment.values,
      explain: commandOptions.explain,
      dryRun: false,
      forceClean: false,
    };
    const selectedBuild = yield* resolveIosBuild(
      ascClient,
      appId,
      appDescriptor,
      bundleId,
      launchConfig,
      commandOptions,
      buildContext,
      logger,
      commandService,
    );
    if (selectedBuild === null) return;
    const releaseInput: ReleaseInput = {
      ...releaseInputCommon,
      versionString: selectedBuild.versionString,
      build: selectedBuild.storeBuild,
      dryRun: false,
    };
    const parsedBuildNumber = Number.parseInt(selectedBuild.storeBuild.version, 10);
    const notifyEvent: NotifyEvent = {
      event: 'submit',
      status: 'success',
      app: appDescriptor.name,
      platform,
      version: selectedBuild.versionString,
      destination: 'App Store review',
    };
    if (!Number.isNaN(parsedBuildNumber)) notifyEvent.buildNumber = parsedBuildNumber;
    const releaseReport = yield* attemptRead(
      'submit App Store release',
      releaseApp(ascClient, releaseInput),
    ).pipe(
      Effect.tapError((cause) =>
        notify(launchConfig, {
          ...notifyEvent,
          status: 'failure',
          error: cause.message,
        }).pipe(
          Effect.mapError((notifyFailure) =>
            releaseFailure('send release failure notification', notifyFailure),
          ),
        ),
      ),
    );
    const failureCount = yield* renderReleaseReport(
      releaseReport,
      appDescriptor.name,
      selectedBuild.storeBuild.version,
      logger,
    );
    if (failureCount > 0) {
      yield* completeCommand(1);
      yield* notify(launchConfig, {
        ...notifyEvent,
        status: 'failure',
        error: `${failureCount} release step(s) failed`,
      }).pipe(
        Effect.mapError((cause) => releaseFailure('send release failure notification', cause)),
      );
      return;
    }
    yield* notify(launchConfig, notifyEvent).pipe(
      Effect.mapError((cause) => releaseFailure('send release notification', cause)),
    );
    yield* writeLog(
      'render release tracking hint',
      logger.note(`Track the review with \`launch status -a ${appDescriptor.name} --watch\`.`),
    );
  });

const releaseAndroidBuild = (
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  commandOptions: ReleaseCommandOptions,
  launchConfig: LaunchConfig,
  resolvedEnvironment: ResolvedEnv,
): Effect.Effect<
  void,
  ReleaseCommandFailure,
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchPathsService
  | Logger
  | Path.Path
  | ReleaseCommandService
> =>
  Effect.gen(function* () {
    const commandService = yield* ReleaseCommandService;
    const logger = yield* createLogger(commandOptions.explain);
    const storageProvider = yield* resolveStorageProvider(launchConfig).pipe(
      Effect.mapError((cause) => releaseFailure('resolve storage provider', cause)),
    );
    const storedBuilds = yield* storageProvider
      .list()
      .pipe(Effect.mapError((cause) => releaseFailure('read stored builds', cause)));
    const latestBuild = findStoredPlatformBuild(storedBuilds, appDescriptor.name, 'android');
    if (latestBuild === undefined) {
      return yield* Effect.fail(
        releaseFailure(
          'find Android release build',
          appDescriptor.name,
          `No stored android build for ${appDescriptor.name}. Run \`launch build android\` first.`,
        ),
      );
    }
    yield* ensureArtifactPresent(latestBuild, appDescriptor.name, 'android').pipe(
      Effect.mapError((cause) => releaseFailure('verify Android release build', cause)),
    );
    const releaseConfirmed = yield* confirmOrCancel(
      commandService,
      `Submit ${appDescriptor.name} ${latestBuild.version} (${latestBuild.buildNumber}) to the PUBLIC Play production track?`,
      commandOptions,
    );
    if (!releaseConfirmed) return;
    const incrementalConfirmed = yield* confirmIncrementalArtifact(
      commandService,
      latestBuild,
      'This build was incremental, not clean - promote anyway? Run `launch build android --clean` first for a from-scratch artifact.',
      commandOptions,
    );
    if (!incrementalConfirmed) return;
    const rollout = resolveAndroidRollout(buildProfile.rollout, commandOptions.rollout);
    const android: AndroidReleaseOptions = { track: 'production', rollout };
    const buildContext: ResolvedBuildContext = {
      platform: 'android',
      app: appDescriptor,
      profile: buildProfile,
      env: resolvedEnvironment.values,
      explain: commandOptions.explain,
      dryRun: false,
      forceClean: false,
      android,
    };
    const credentialsProvider = yield* getCredentialsProvider(launchConfig.credentials).pipe(
      Effect.mapError((cause) => releaseFailure('resolve credentials provider', cause)),
    );
    const buildCredentials = yield* credentialsProvider
      .resolveBuildCredentials(buildContext)
      .pipe(Effect.mapError((cause) => releaseFailure('resolve build credentials', cause)));
    const notifyEvent: NotifyEvent = {
      event: 'submit',
      status: 'success',
      app: appDescriptor.name,
      platform: 'android',
      version: latestBuild.version,
      buildNumber: latestBuild.buildNumber,
      destination: 'the Play production track',
    };
    const downloadBytes = worstDownloadBytes(latestBuild.sizeReport);
    if (downloadBytes > 0) notifyEvent.sizeBytes = downloadBytes;
    yield* submitToStores(
      launchConfig,
      'android',
      latestBuild.path,
      'production',
      buildCredentials,
      buildContext,
    ).pipe(
      Effect.mapError((cause) => releaseFailure('submit Android release', cause)),
      Effect.tapError((cause) =>
        notify(launchConfig, {
          ...notifyEvent,
          status: 'failure',
          error: cause.message,
        }).pipe(
          Effect.mapError((notifyFailure) =>
            releaseFailure('send release failure notification', notifyFailure),
          ),
        ),
      ),
    );
    yield* writeLog(
      'render Play release outcome',
      logger.line(
        `Submitted ${appDescriptor.name} ${latestBuild.version} (${latestBuild.buildNumber}) to the Play production track.`,
      ),
    );
    yield* notify(launchConfig, notifyEvent).pipe(
      Effect.mapError((cause) => releaseFailure('send release notification', cause)),
    );
  });

/** Parse inputs, resolve shared configuration, and dispatch to the store-specific release path. */
export const releaseCommandProgram = (
  platformArgument: string,
  commandOptions: ReleaseCommandOptions,
): Effect.Effect<
  void,
  CommandExit | ReleaseCommandFailure,
  | AppleStoreClientDependencies
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | ReleaseCommandService
  | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const platform = yield* parsePlatform(platformArgument).pipe(
      Effect.mapError((cause) => releaseFailure('parse release platform', cause, cause.message)),
    );
    const loadedConfiguration = yield* loadConfig().pipe(
      Effect.mapError((cause) => releaseFailure('load Launch configuration', cause)),
    );
    const appDescriptor = yield* selectApp(loadedConfiguration.apps, commandOptions.app).pipe(
      Effect.mapError((cause) => releaseFailure('select app', cause, cause.message)),
    );
    let buildProfile = loadedConfiguration.config.profiles[commandOptions.profile];
    if (buildProfile === undefined) buildProfile = { name: commandOptions.profile };
    const environmentOverrides = yield* parseCliEnv(commandOptions.env).pipe(
      Effect.mapError((cause) =>
        releaseFailure('parse environment overrides', cause, cause.message),
      ),
    );
    const resolvedEnvironment = yield* resolveCommandEnv({
      app: appDescriptor,
      profile: buildProfile,
      cliEnv: environmentOverrides,
      includeLocal: commandOptions.includeLocal,
      envExclude: loadedConfiguration.config.envExclude,
    }).pipe(Effect.mapError((cause) => releaseFailure('resolve release environment', cause)));
    if (commandOptions.printEnv) {
      const logger = yield* createLogger(false);
      yield* writeLog(
        'render release environment',
        logger.line(formatEnvTable(resolvedEnvironment)),
      );
      return;
    }
    if (isApplePlatform(platform)) {
      return yield* releaseAppleBuild(
        platform,
        appDescriptor,
        buildProfile,
        commandOptions,
        loadedConfiguration.config,
        resolvedEnvironment,
      );
    }
    return yield* releaseAndroidBuild(
      appDescriptor,
      buildProfile,
      commandOptions,
      loadedConfiguration.config,
      resolvedEnvironment,
    );
  });

/** Live public-release terminal dependencies. */
export const ReleaseCommandServiceLive = Layer.effect(
  ReleaseCommandService,
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    const launchPrompt = yield* LaunchPrompt;
    return {
      terminalIsInteractive,
      confirmRelease: (message) =>
        launchPrompt
          .confirm(message)
          .pipe(Effect.mapError((cause) => releaseFailure('confirm public release', cause))),
      cancelRelease: () => launchPrompt.cancel('Cancelled - nothing submitted.'),
    } satisfies ReleaseCommandService;
  }),
);
