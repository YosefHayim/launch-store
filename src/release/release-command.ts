// Submits a stored build to App Store Connect or Google Play and can watch the review.

import { parseBuildRollout } from '../build/build-command-input.ts';
import { worstDownloadBytes } from '../build/pipeline-artifact.ts';
import {
  applyBuildEnvironment,
  resolveCommandEnv,
  selectApp,
} from '../build/pipeline-environment.ts';
import { mb, submitToStores } from '../build/pipeline-providers.ts';
import { resolveIosAccount } from '../build/pipeline-signing.ts';
import { loadConfig } from '../config/config.ts';
import { parseCliEnv } from '../config/environment-file.ts';
import { loadAscKeyById } from '../credentials/accounts.ts';
import { ensureArtifactPresent, resolveStorageProvider } from '../distribution/storage.ts';
import { errorMessage, hasMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { notify, type NotifyEvent } from '../services/platform/notify.ts';
import { LaunchPrompt, pickOne } from '../services/platform/prompt.ts';
import { getCredentialsProvider } from '../services/provider-support/registry.ts';
import {
  AppleStoreClientService,
  appRecordMissingMessage,
} from '../services/stores/apple-store-client.ts';
import {
  isApplePlatform,
  parsePlatform,
  platformLabel,
  readConnectPlatform,
} from '../services/stores/platform.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type { AndroidReleaseOptions, AppDescriptor, BuildProfile, Platform } from '../types/app.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { BuildResource } from '../types/apple-catalog.ts';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.ts';
import type { ResolvedEnv } from '../config/environment-file.ts';
import {
  releaseApp,
  waitForValidBuild,
  type AscReleaseApi,
  type ReleaseAction,
  type ReleaseInput,
  type ReleaseReport,
} from './app-store-release.ts';
import { resolveReleaseConfirmationMode } from './confirmation.ts';
import { resolveReleaseType, resolveWhatsNew } from './release-inputs.ts';

/** Parsed flags accepted by the public release command. */
export type ReleaseCommandOptions = Readonly<{
  env: string[];
  includeLocal: boolean;
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
  attachOnly?: boolean;
  dryRun?: boolean;
  createApp?: boolean;
  yes: boolean;
  json: boolean;
}>;

/** A release operation failed before it could produce a store report. */
export type ReleaseCommandFailure = Readonly<{
  readonly _tag: 'ReleaseCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export function makeReleaseCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): ReleaseCommandFailure {
  return { _tag: 'ReleaseCommandFailure', ...fields };
}

/** Injectable terminal boundary for public release orchestration. */
export type ReleaseCommandService = Readonly<{
  terminalIsInteractive: boolean;
  confirmRelease: (message: string) => Promise<boolean>;
  cancelRelease: () => void;
}>;

/** How an operator selected which App Store build to promote. */
type AppStoreBuildSelector =
  | Readonly<{ kind: 'latest' }>
  | Readonly<{ kind: 'number'; buildNumber: number }>
  | Readonly<{ kind: 'invalid'; selector: string }>;

type ReleaseInputCommon = Omit<ReleaseInput, 'versionString' | 'build' | 'dryRun'>;

type BuildSource =
  | Readonly<{ kind: 'upload' }>
  | Readonly<{ kind: 'promote'; storeBuild: BuildResource }>;

type SelectedStoreBuild = Readonly<{ storeBuild: BuildResource; versionString: string }>;

function releaseFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): ReleaseCommandFailure {
  if (fallbackMessage != null) {
    return makeReleaseCommandFailure({ operation, message: fallbackMessage, cause });
  }

  if (hasMessage(cause)) {
    return makeReleaseCommandFailure({ operation, message: cause.message, cause });
  }

  return makeReleaseCommandFailure({ operation, message: `${operation} failed.`, cause });
}

async function attemptRead<ReadOutput>(
  operation: string,
  read: Promise<ReadOutput>,
): Promise<ReadOutput> {
  try {
    return await read;
  } catch (error) {
    if (isCommandExit(error)) {
      throw error;
    }

    throw releaseFailure(operation, error);
  }
}

/** Whether an incrementally-built artifact needs a second public-release confirmation. */
export function shouldNudgeRelease(artifact: Pick<BuildArtifact, 'clean'>): boolean {
  return artifact.clean == false;
}

/** Whether an App Store build is processed and still usable for promotion. */
export function isVerifiedStoreBuild(storeBuild: BuildResource): boolean {
  const isProcessed = storeBuild.processingState == 'VALID';

  if (isProcessed == false) {
    return false;
  }

  return storeBuild.expired == false;
}

/** Select the newest processed, non-expired App Store build. */
export function newestValidBuild(storeBuilds: readonly BuildResource[]): BuildResource | null {
  const newestBuild = storeBuilds.find(isVerifiedStoreBuild);

  if (newestBuild == null) {
    return null;
  }

  return newestBuild;
}

/** Parse `--build latest` or `--build <n>` into a typed selector. */
export function parseAppStoreBuildSelector(selector: string): AppStoreBuildSelector {
  if (selector == 'latest') {
    return { kind: 'latest' };
  }

  const buildNumber = Number.parseInt(selector, 10);

  const isNotANumber = Number.isNaN(buildNumber);

  if (isNotANumber) {
    return { kind: 'invalid', selector };
  }

  return { kind: 'number', buildNumber };
}

/** Resolve the staged-rollout fraction for a Play production release. */
export function resolveAndroidRollout(
  profileRollout: number | undefined,
  rolloutFlag: number | undefined,
): number {
  if (rolloutFlag != null) {
    return rolloutFlag;
  }

  if (profileRollout != null) {
    return profileRollout;
  }

  return 1;
}

/** The `--dry-run` plan for a Play production release: the build, the track and the rollout it would ship with. */
export function androidReleasePlanLines(
  artifact: Pick<BuildArtifact, 'version' | 'buildNumber' | 'clean'>,
  rollout: number,
): string[] {
  const fullRolloutPercent = 100;
  const planLines = [
    `submit ${artifact.version} (${artifact.buildNumber}) to the PUBLIC Play production track`,
    `roll out to ${Math.round(rollout * fullRolloutPercent)}% of users`,
  ];

  const needsCleanBuild = shouldNudgeRelease(artifact);

  if (needsCleanBuild) {
    planLines.push(
      'incremental build - run `launch-store build android --clean` first for a from-scratch artifact',
    );
  }

  return planLines;
}

function isFailedReceipt(releaseAction: ReleaseAction, mode: 'plan' | 'receipt'): boolean {
  if (mode != 'receipt') {
    return false;
  }

  return releaseAction.status == 'failed';
}

function readErrorSuffix(releaseAction: ReleaseAction): string {
  if (releaseAction.error != null) {
    return ` - ${releaseAction.error}`;
  }

  return '';
}

function readNoteSuffix(releaseAction: ReleaseAction): string {
  if (releaseAction.status != 'skipped') {
    return '';
  }

  if (releaseAction.note == null) {
    return '';
  }

  return ` (${releaseAction.note})`;
}

/** Format one release-plan / receipt line from a recorded action. */
export function formatReleaseActionLine(
  releaseAction: ReleaseAction,
  mode: 'plan' | 'receipt',
): string {
  const failedReceipt = isFailedReceipt(releaseAction, mode);

  if (failedReceipt) {
    return `x ${releaseAction.description}${readErrorSuffix(releaseAction)}`;
  }

  return `- ${releaseAction.description}${readNoteSuffix(releaseAction)}`;
}

function actionFailed(releaseAction: ReleaseAction): boolean {
  return releaseAction.status == 'failed';
}

/** Count failed steps in a release report for exit-code decisions. */
export function countFailedReleaseActions(releaseReport: ReleaseReport): number {
  let failureCount = 0;

  for (const releaseAction of releaseReport.actions) {
    if (actionFailed(releaseAction)) {
      failureCount += 1;
    }
  }

  return failureCount;
}

function matchesStoredBuild(
  storedBuild: BuildArtifact,
  appName: string,
  platform: Platform,
): boolean {
  if (storedBuild.appName != appName) {
    return false;
  }

  return storedBuild.platform == platform;
}

function findStoredPlatformBuild(
  storedBuilds: readonly BuildArtifact[],
  appName: string,
  platform: Platform,
): BuildArtifact | undefined {
  function isStoredBuild(storedBuild: BuildArtifact): boolean {
    return matchesStoredBuild(storedBuild, appName, platform);
  }

  return storedBuilds.find(isStoredBuild);
}

/** Live public-release terminal dependencies. */
function ReleaseCommandServiceLive(): ReleaseCommandService {
  const terminalIsInteractive = process.stdout.isTTY == true;

  async function confirmRelease(message: string): Promise<boolean> {
    try {
      return await LaunchPrompt.confirm(message);
    } catch (error) {
      throw releaseFailure('confirm public release', error);
    }
  }

  function cancelRelease(): void {
    LaunchPrompt.cancel('Cancelled - nothing submitted.');
  }

  return { terminalIsInteractive, confirmRelease, cancelRelease };
}

export async function resolveVersionString(
  ascClient: Pick<AscReleaseApi, 'getLatestMarketingVersion'>,
  appDescriptor: AppDescriptor,
  bundleId: string,
  storeBuild: BuildResource | null,
): Promise<string> {
  const promotedVersion = storeBuild?.marketingVersion;

  if (promotedVersion != null) {
    return promotedVersion;
  }

  const configuredVersion = appDescriptor.version;

  if (configuredVersion != null) {
    return configuredVersion;
  }

  const latestVersion = await attemptRead(
    'read latest App Store version',
    ascClient.getLatestMarketingVersion(bundleId),
  );

  if (latestVersion != null) {
    return latestVersion;
  }

  throw releaseFailure(
    'resolve marketing version',
    appDescriptor,
    `Could not determine a marketing version for ${appDescriptor.name}. Set "version" in app.json.`,
  );
}

async function confirmPublicRelease(
  commandService: ReleaseCommandService,
  message: string,
  commandOptions: ReleaseCommandOptions,
): Promise<boolean> {
  try {
    const confirmationMode = resolveReleaseConfirmationMode({
      yes: commandOptions.yes == true,
      canPrompt: commandService.terminalIsInteractive,
    });

    if (confirmationMode == 'confirmed') {
      return true;
    }
  } catch (error) {
    const failureMessage = errorMessage(error);
    throw releaseFailure('confirm public release', error, failureMessage);
  }

  return commandService.confirmRelease(message);
}

async function confirmOrCancel(
  commandService: ReleaseCommandService,
  message: string,
  commandOptions: ReleaseCommandOptions,
): Promise<boolean> {
  const confirmed = await confirmPublicRelease(commandService, message, commandOptions);

  if (confirmed) {
    return true;
  }

  commandService.cancelRelease();

  return false;
}

async function confirmIncrementalArtifact(
  commandService: ReleaseCommandService,
  artifact: Pick<BuildArtifact, 'clean'>,
  message: string,
  commandOptions: ReleaseCommandOptions,
): Promise<boolean> {
  const needsNudge = shouldNudgeRelease(artifact);

  if (needsNudge == false) {
    return true;
  }

  return confirmOrCancel(commandService, message, commandOptions);
}

function renderReleasePlan(releaseReport: ReleaseReport, appName: string, logger: Logger): void {
  const planLines = releaseReport.actions.map(function planLine(releaseAction) {
    return formatReleaseActionLine(releaseAction, 'plan');
  });

  const planIsEmpty = planLines.length == 0;

  if (planIsEmpty) {
    planLines.push('nothing to do - already submitted or up to date');
  }

  logger.box(
    `Plan - ${appName} ${releaseReport.versionString} (dry run, nothing submitted)`,
    planLines,
  );
}

/** Receipt title: an attach-only run says the build is attached, because nothing was submitted. */
function attachedWithFailures(isAttachOnly: boolean, hasFailedSteps: boolean): boolean {
  if (isAttachOnly == false) {
    return false;
  }

  return hasFailedSteps;
}

function pickReceiptTitle(isAttachOnly: boolean, buildLabel: string, failureCount: number): string {
  const hasFailedSteps = failureCount > 0;

  const attachedAndFailed = attachedWithFailures(isAttachOnly, hasFailedSteps);

  if (attachedAndFailed) {
    return `Attached with ${failureCount} failed step(s) - see below`;
  }

  if (isAttachOnly) {
    return `Build ${buildLabel} attached - not submitted for review`;
  }

  if (hasFailedSteps) {
    return `Submitted with ${failureCount} failed step(s) - see below`;
  }

  return 'Submitted for App Store review';
}

interface ReleaseReceipt {
  appName: string;
  buildLabel: string;
  isAttachOnly: boolean;
}

function renderReleaseReport(
  releaseReport: ReleaseReport,
  receipt: ReleaseReceipt,
  logger: Logger,
): number {
  if (releaseReport.alreadyInReview) {
    logger.note(
      `${receipt.appName} ${releaseReport.versionString} is already ${releaseReport.appStoreState} - nothing to submit.`,
    );

    return 0;
  }

  const failureCount = countFailedReleaseActions(releaseReport);
  const receiptLines = releaseReport.actions.map(function receiptLine(releaseAction) {
    return formatReleaseActionLine(releaseAction, 'receipt');
  });
  const receiptTitle = pickReceiptTitle(receipt.isAttachOnly, receipt.buildLabel, failureCount);
  const stateLines = readStateLines(receipt.isAttachOnly, releaseReport.appStoreState);

  logger.box(receiptTitle, [
    `${receipt.appName} ${releaseReport.versionString} (build ${receipt.buildLabel})`,
    ...stateLines,
    ...receiptLines,
  ]);

  return failureCount;
}

function readStateLines(isAttachOnly: boolean, appStoreState: string): string[] {
  if (isAttachOnly) {
    return [`App Store state: ${appStoreState}`];
  }

  return [];
}

function exitMissingAppRecord(bundleId: string, logger: Logger): void {
  const missingRecordMessage = appRecordMissingMessage(bundleId);
  logger.note(missingRecordMessage);
  completeCommand(1, missingRecordMessage);
}

async function resolveBuildToPromote(
  ascClient: AscReleaseApi,
  appId: string,
  appName: string,
  selector: string,
): Promise<BuildResource> {
  const buildSelector = parseAppStoreBuildSelector(selector);

  if (buildSelector.kind == 'invalid') {
    throw releaseFailure(
      'parse App Store build selector',
      selector,
      `--build must be a build number or "latest" (got "${selector}").`,
    );
  }

  if (buildSelector.kind == 'latest') {
    const storeBuilds = await attemptRead('list App Store builds', ascClient.listBuilds(appId));
    const storeBuild = newestValidBuild(storeBuilds);

    if (storeBuild != null) {
      return storeBuild;
    }

    throw releaseFailure(
      'resolve App Store build',
      selector,
      `No processed build on App Store Connect for ${appName}. Upload one first.`,
    );
  }

  const storeBuild = await attemptRead(
    'find App Store build',
    ascClient.findBuildByVersion(appId, buildSelector.buildNumber),
  );

  if (storeBuild != null) {
    return storeBuild;
  }

  throw releaseFailure(
    'find App Store build',
    selector,
    `No build ${buildSelector.buildNumber} on App Store Connect for ${appName}.`,
  );
}

function readBuildHint(storeBuild: BuildResource): string {
  if (storeBuild.uploadedDate != null) {
    const isoDateLength = 10;

    return `verified - uploaded ${storeBuild.uploadedDate.slice(0, isoDateLength)}`;
  }

  return 'verified';
}

function shouldExplainMissingBuild(
  verifiedBuildCount: number,
  terminalIsInteractive: boolean,
): boolean {
  if (verifiedBuildCount != 0) {
    return false;
  }

  return terminalIsInteractive;
}

async function resolveBuildSource(
  ascClient: AscReleaseApi,
  appId: string,
  appName: string,
  commandOptions: ReleaseCommandOptions,
  logger: Logger,
  terminalIsInteractive: boolean,
): Promise<BuildSource> {
  if (commandOptions.upload == true) {
    return { kind: 'upload' };
  }

  if (commandOptions.build != null) {
    const storeBuild = await resolveBuildToPromote(ascClient, appId, appName, commandOptions.build);

    return { kind: 'promote', storeBuild };
  }

  const storeBuilds = await attemptRead('list App Store builds', ascClient.listBuilds(appId));
  const verifiedBuilds = storeBuilds.filter(isVerifiedStoreBuild);

  const explainMissingBuild = shouldExplainMissingBuild(
    verifiedBuilds.length,
    terminalIsInteractive,
  );

  if (explainMissingBuild) {
    logger.note(
      'No verified TestFlight build to promote yet - will upload the latest local build.',
    );
  }

  const hasNoVerifiedBuild = verifiedBuilds.length == 0;

  if (hasNoVerifiedBuild) {
    return { kind: 'upload' };
  }

  function promoteChoice(storeBuild: BuildResource) {
    const promoteSource: BuildSource = { kind: 'promote', storeBuild };

    return {
      selection: promoteSource,
      label: `Promote build ${storeBuild.version}`,
      hint: readBuildHint(storeBuild),
    };
  }

  const promoteOptions = verifiedBuilds.map(promoteChoice);
  const firstPromote = promoteOptions[0];
  const uploadSource: BuildSource = { kind: 'upload' };

  if (firstPromote == null) {
    return uploadSource;
  }

  try {
    return await pickOne<BuildSource>({
      message: 'Release which build?',
      choices: [
        {
          selection: uploadSource,
          label: 'Upload the latest local build',
          hint: 'send a fresh .ipa to TestFlight',
        },
        ...promoteOptions,
      ],
      canPrompt: terminalIsInteractive,
      initialSelection: firstPromote.selection,
      nonInteractive: {
        kind: 'fallback',
        selection: uploadSource,
        note: 'Non-interactive: uploading the latest local build (pass --build <n> to promote a verified one).',
      },
    });
  } catch (error) {
    throw releaseFailure('select release build', error);
  }
}

/** The confirmation question for promoting a build; attach-only says it will not submit. */
function describePromotionQuestion(promotion: {
  appName: string;
  versionString: string;
  buildLabel: string;
  attachOnly: boolean;
}): string {
  if (promotion.attachOnly) {
    return `Attach build ${promotion.buildLabel} to ${promotion.appName} ${promotion.versionString} without submitting for review?`;
  }

  return `Submit ${promotion.appName} ${promotion.versionString} (build ${promotion.buildLabel}) for App Store review?`;
}

async function resolveIosBuild(
  ascClient: AscReleaseApi,
  appId: string,
  appDescriptor: AppDescriptor,
  bundleId: string,
  launchConfig: LaunchConfig,
  commandOptions: ReleaseCommandOptions,
  buildContext: ResolvedBuildContext,
  logger: Logger,
  commandService: ReleaseCommandService,
): Promise<SelectedStoreBuild | null> {
  const buildSource = await resolveBuildSource(
    ascClient,
    appId,
    appDescriptor.name,
    commandOptions,
    logger,
    commandService.terminalIsInteractive,
  );

  if (buildSource.kind == 'promote') {
    const versionString = await resolveVersionString(
      ascClient,
      appDescriptor,
      bundleId,
      buildSource.storeBuild,
    );
    const promotionQuestion = describePromotionQuestion({
      appName: appDescriptor.name,
      versionString,
      buildLabel: buildSource.storeBuild.version,
      attachOnly: commandOptions.attachOnly == true,
    });
    const confirmed = await confirmOrCancel(commandService, promotionQuestion, commandOptions);

    if (confirmed == false) {
      return null;
    }

    return { storeBuild: buildSource.storeBuild, versionString };
  }

  const storageProvider = await readStorageProvider(launchConfig);
  const storedBuilds = await readStoredBuilds(storageProvider);
  const artifact = findStoredPlatformBuild(storedBuilds, appDescriptor.name, buildContext.platform);

  if (artifact == null) {
    throw releaseFailure(
      'find local release build',
      buildContext.platform,
      `No stored ${platformLabel(buildContext.platform)} build for ${appDescriptor.name}. Run \`launch-store build ${buildContext.platform}\` first, or promote one with --build.`,
    );
  }

  try {
    await ensureArtifactPresent(artifact, appDescriptor.name, buildContext.platform);
  } catch (error) {
    throw releaseFailure('verify local release build', error);
  }

  const downloadBytes = worstDownloadBytes(artifact.sizeReport);
  const noticeDetails = readDownloadNotice(downloadBytes);

  logger.notice(
    `Release ${appDescriptor.name} ${artifact.version} (build ${artifact.buildNumber}) to the App Store`,
    ...noticeDetails,
  );

  const uploadConfirmed = await confirmOrCancel(
    commandService,
    `Upload and submit ${appDescriptor.name} ${artifact.version} (${artifact.buildNumber}) for review?`,
    commandOptions,
  );

  if (uploadConfirmed == false) {
    return null;
  }

  const incrementalConfirmed = await confirmIncrementalArtifact(
    commandService,
    artifact,
    `This build was incremental, not clean - promote anyway? (\`launch-store build ${buildContext.platform} --clean\` for a fresh one)`,
    commandOptions,
  );

  if (incrementalConfirmed == false) {
    return null;
  }

  const buildCredentials = await readBuildCredentials(launchConfig, buildContext);

  logger.step(
    'upload',
    `uploading build ${artifact.buildNumber} to App Store Connect`,
    'testflight',
  );

  try {
    await submitToStores(
      launchConfig,
      buildContext.platform,
      artifact,
      buildCredentials,
      buildContext,
    );
  } catch (error) {
    throw releaseFailure('upload App Store build', error);
  }

  if (commandOptions.wait == false) {
    logger.note(
      `Uploaded build ${artifact.buildNumber}; Apple is processing it. Once \`launch-store status -a ${appDescriptor.name}\` shows it VALID, submit with \`launch-store release ${buildContext.platform} -a ${appDescriptor.name} --build ${artifact.buildNumber}\`.`,
    );

    return null;
  }

  logger.step('processing', 'waiting for App Store Connect to finish processing the build');

  const buildProgram = waitForValidBuild(ascClient, appId, artifact.buildNumber, {
    marketingVersion: artifact.version,
  });
  const storeBuild = await attemptRead('wait for App Store build processing', buildProgram);

  return { storeBuild, versionString: artifact.version };
}

function readDownloadNotice(downloadBytes: number): string[] {
  const hasDownloadSize = downloadBytes > 0;

  if (hasDownloadSize) {
    return [`download size ~${mb(downloadBytes)} (size budget already checked at build)`];
  }

  return [];
}

async function readStorageProvider(launchConfig: LaunchConfig) {
  try {
    return await resolveStorageProvider(launchConfig);
  } catch (error) {
    throw releaseFailure('resolve storage provider', error);
  }
}

async function readStoredBuilds(
  storageProvider: Awaited<ReturnType<typeof resolveStorageProvider>>,
): Promise<readonly BuildArtifact[]> {
  try {
    return await storageProvider.list();
  } catch (error) {
    throw releaseFailure('read stored builds', error);
  }
}

async function readBuildCredentials(
  launchConfig: LaunchConfig,
  buildContext: ResolvedBuildContext,
) {
  var credentialsProvider: ReturnType<typeof getCredentialsProvider>;

  try {
    credentialsProvider = getCredentialsProvider(launchConfig.credentials);
  } catch (error) {
    throw releaseFailure('resolve credentials provider', error);
  }

  try {
    return await credentialsProvider.resolveBuildCredentials(buildContext);
  } catch (error) {
    throw releaseFailure('resolve build credentials', error);
  }
}

function readPhasedRelease(
  commandOptions: ReleaseCommandOptions,
  launchConfig: LaunchConfig,
): boolean {
  if (commandOptions.phased == true) {
    return true;
  }

  return launchConfig.release?.phasedRelease == true;
}

function readReleaseInputCommon(
  bundleId: string,
  platform: string,
  launchConfig: LaunchConfig,
  commandOptions: ReleaseCommandOptions,
  whatsNew: Record<string, string>,
): ReleaseInputCommon {
  const releaseTypeSettings = resolveReleaseType(launchConfig.release, commandOptions);
  const releaseInputCommon: ReleaseInputCommon = {
    bundleId,
    platform,
    releaseType: releaseTypeSettings.releaseType,
    phasedRelease: readPhasedRelease(commandOptions, launchConfig),
    usesNonExemptEncryption: launchConfig.release?.usesNonExemptEncryption == true,
    whatsNew,
    attachOnly: commandOptions.attachOnly == true,
  };

  if (releaseTypeSettings.earliestReleaseDate != null) {
    releaseInputCommon.earliestReleaseDate = releaseTypeSettings.earliestReleaseDate;
  }

  if (launchConfig.release?.copyright != null) {
    releaseInputCommon.copyright = launchConfig.release.copyright;
  }

  return releaseInputCommon;
}

function needsBuildForAttach(commandOptions: ReleaseCommandOptions): boolean {
  if (commandOptions.attachOnly != true) {
    return false;
  }

  return commandOptions.build == null;
}

async function releaseAppleBuild(
  platform: Platform,
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  commandOptions: ReleaseCommandOptions,
  launchConfig: LaunchConfig,
  resolvedEnvironment: ResolvedEnv,
  commandService: ReleaseCommandService,
): Promise<void> {
  const logger = createLogger(commandOptions.explain);
  const bundleId = appDescriptor.bundleId;

  if (bundleId == null) {
    throw releaseFailure(
      'resolve Apple bundle id',
      appDescriptor,
      `${appDescriptor.name} has no bundle id (ios.bundleIdentifier in app.json).`,
    );
  }

  const accountRecord = await readIosAccount(commandOptions, logger);
  const ascKey = await readAscKey(accountRecord.keyId, accountRecord.label);

  var ascClient: AscReleaseApi;

  try {
    ascClient = AppleStoreClientService.createClient(ascKey);
  } catch (error) {
    throw releaseFailure('create App Store client', error);
  }

  const appId = await attemptRead('read App Store app id', ascClient.getAppId(bundleId));

  if (commandOptions.createApp == true) {
    exitMissingAppRecord(bundleId, logger);

    return;
  }

  if (appId == null) {
    exitMissingAppRecord(bundleId, logger);

    return;
  }

  const whatsNew = await readWhatsNew(launchConfig, appDescriptor);

  const whatsNewIsEmpty = Object.keys(whatsNew).length == 0;

  if (whatsNewIsEmpty) {
    logger.warn(
      "No release notes configured (release.releaseNotes or listing in launch.config.ts) - keeps the existing What's New.",
    );
  }

  const ascPlatform = readAscPlatform(platform);
  const releaseInputCommon = readReleaseInputCommon(
    bundleId,
    ascPlatform,
    launchConfig,
    commandOptions,
    whatsNew,
  );

  if (needsBuildForAttach(commandOptions)) {
    throw releaseFailure(
      'select App Store build',
      'attach-only',
      '--attach-only needs an existing build: pass --build <n> or --build latest.',
    );
  }

  if (commandOptions.dryRun == true) {
    await planAppleRelease(
      ascClient,
      appId,
      appDescriptor,
      bundleId,
      commandOptions,
      releaseInputCommon,
      logger,
    );

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
  const selectedBuild = await resolveIosBuild(
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

  if (selectedBuild == null) {
    return;
  }

  const releaseInput: ReleaseInput = {
    ...releaseInputCommon,
    versionString: selectedBuild.versionString,
    build: selectedBuild.storeBuild,
    dryRun: false,
  };
  const notifyEvent = readAppleNotifyEvent(appDescriptor.name, platform, selectedBuild);
  const releaseReport = await submitAppleRelease(
    launchConfig,
    ascClient,
    releaseInput,
    notifyEvent,
  );
  const failureCount = renderReleaseReport(
    releaseReport,
    {
      appName: appDescriptor.name,
      buildLabel: selectedBuild.storeBuild.version,
      isAttachOnly: releaseInput.attachOnly,
    },
    logger,
  );

  const hasFailedSteps = failureCount > 0;

  if (hasFailedSteps) {
    const failureMessage = `${failureCount} release step(s) failed`;

    const failedSubmitEvent = readFailedSubmitEvent(notifyEvent, failureMessage);

    await sendReleaseNotification(launchConfig, failedSubmitEvent);
    completeCommand(1, failureMessage);

    return;
  }

  if (releaseInput.attachOnly) {
    return;
  }

  await sendReleaseNotification(launchConfig, notifyEvent);
  logger.note(`Track the review with \`launch-store status -a ${appDescriptor.name} --watch\`.`);
}

async function readIosAccount(commandOptions: ReleaseCommandOptions, logger: Logger) {
  try {
    return await resolveIosAccount(commandOptions, logger);
  } catch (error) {
    throw releaseFailure('resolve Apple account', error);
  }
}

async function readAscKey(keyId: string, accountLabel: string) {
  var ascKey: Awaited<ReturnType<typeof loadAscKeyById>>;

  try {
    ascKey = await loadAscKeyById(keyId);
  } catch (error) {
    throw releaseFailure('load App Store Connect key', error);
  }

  if (ascKey == null) {
    throw releaseFailure(
      'load App Store Connect key',
      keyId,
      `No App Store Connect key stored for account ${accountLabel}. Run \`launch-store creds set-key\`.`,
    );
  }

  return ascKey;
}

async function readWhatsNew(launchConfig: LaunchConfig, app: AppDescriptor) {
  try {
    return await resolveWhatsNew(launchConfig, app);
  } catch (error) {
    throw releaseFailure('read release notes', error);
  }
}

function readAscPlatform(platform: Platform): string {
  try {
    return readConnectPlatform(platform);
  } catch (error) {
    const failureMessage = errorMessage(error);
    throw releaseFailure('map App Store platform', error, failureMessage);
  }
}

async function readPlannedStoreBuild(
  ascClient: AscReleaseApi,
  appId: string,
  appName: string,
  commandOptions: ReleaseCommandOptions,
): Promise<BuildResource | null> {
  if (commandOptions.build == null) {
    return null;
  }

  return resolveBuildToPromote(ascClient, appId, appName, commandOptions.build);
}

async function planAppleRelease(
  ascClient: AscReleaseApi,
  appId: string,
  appDescriptor: AppDescriptor,
  bundleId: string,
  commandOptions: ReleaseCommandOptions,
  releaseInputCommon: ReleaseInputCommon,
  logger: Logger,
): Promise<void> {
  const storeBuild = await readPlannedStoreBuild(
    ascClient,
    appId,
    appDescriptor.name,
    commandOptions,
  );

  if (storeBuild == null) {
    logger.note(
      'Plan assumes uploading the latest local build (pass --build <n> to plan against a verified build).',
    );
  }

  const versionString = await resolveVersionString(ascClient, appDescriptor, bundleId, storeBuild);
  const releaseReport = await attemptRead(
    'plan App Store release',
    releaseApp(ascClient, {
      ...releaseInputCommon,
      versionString,
      build: storeBuild,
      dryRun: true,
    }),
  );

  renderReleasePlan(releaseReport, appDescriptor.name, logger);
}

type ReleaseSubmitEvent = {
  event: 'submit';
  status: 'success' | 'failure';
  app: string;
  platform: Platform;
  version: string;
  buildNumber?: number;
  sizeBytes?: number;
  destination?: string;
  error?: string;
};

function readFailedSubmitEvent(
  notifyEvent: ReleaseSubmitEvent,
  failureMessage: string,
): ReleaseSubmitEvent {
  const failedEvent: ReleaseSubmitEvent = {
    event: 'submit',
    status: 'failure',
    app: notifyEvent.app,
    platform: notifyEvent.platform,
    version: notifyEvent.version,
    error: failureMessage,
  };

  const buildNumber = notifyEvent.buildNumber;

  const hasBuildNumber = buildNumber != null;

  if (hasBuildNumber) {
    failedEvent.buildNumber = buildNumber;
  }

  const sizeBytes = notifyEvent.sizeBytes;

  const hasSizeBytes = sizeBytes != null;

  if (hasSizeBytes) {
    failedEvent.sizeBytes = sizeBytes;
  }

  const destination = notifyEvent.destination;

  const hasDestination = destination != null;

  if (hasDestination) {
    failedEvent.destination = destination;
  }

  return failedEvent;
}

function readAppleNotifyEvent(
  appName: string,
  platform: Platform,
  selectedBuild: SelectedStoreBuild,
): ReleaseSubmitEvent {
  const notifyEvent: ReleaseSubmitEvent = {
    event: 'submit',
    status: 'success',
    app: appName,
    platform,
    version: selectedBuild.versionString,
    destination: 'App Store review',
  };
  const parsedBuildNumber = Number.parseInt(selectedBuild.storeBuild.version, 10);

  const hasBuildNumber = Number.isNaN(parsedBuildNumber) == false;

  if (hasBuildNumber) {
    notifyEvent.buildNumber = parsedBuildNumber;
  }

  return notifyEvent;
}

async function submitAppleRelease(
  launchConfig: LaunchConfig,
  ascClient: AscReleaseApi,
  releaseInput: ReleaseInput,
  notifyEvent: ReleaseSubmitEvent,
): Promise<ReleaseReport> {
  try {
    return await releaseApp(ascClient, releaseInput);
  } catch (error) {
    if (isCommandExit(error)) {
      throw error;
    }

    const submitFailure = releaseFailure('submit App Store release', error);

    try {
      const failedSubmitEvent = readFailedSubmitEvent(notifyEvent, submitFailure.message);
      await notify(launchConfig, failedSubmitEvent);
    } catch (notifyFailure) {
      throw releaseFailure('send release failure notification', notifyFailure);
    }

    throw submitFailure;
  }
}

async function sendReleaseNotification(
  launchConfig: LaunchConfig,
  notifyEvent: NotifyEvent,
): Promise<void> {
  try {
    await notify(launchConfig, notifyEvent);
  } catch (error) {
    throw releaseFailure('send release notification', error);
  }
}

async function releaseAndroidBuild(
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  commandOptions: ReleaseCommandOptions,
  launchConfig: LaunchConfig,
  resolvedEnvironment: ResolvedEnv,
  commandService: ReleaseCommandService,
): Promise<void> {
  const logger = createLogger(commandOptions.explain);
  const rolloutFlag = readRolloutFlag(commandOptions.rollout);
  const storageProvider = await readStorageProvider(launchConfig);
  const storedBuilds = await readStoredBuilds(storageProvider);
  const latestBuild = findStoredPlatformBuild(storedBuilds, appDescriptor.name, 'android');

  if (latestBuild == null) {
    throw releaseFailure(
      'find Android release build',
      appDescriptor.name,
      `No stored android build for ${appDescriptor.name}. Run \`launch-store build android\` first.`,
    );
  }

  try {
    await ensureArtifactPresent(latestBuild, appDescriptor.name, 'android');
  } catch (error) {
    throw releaseFailure('verify Android release build', error);
  }

  const rollout = resolveAndroidRollout(buildProfile.rollout, rolloutFlag);

  if (commandOptions.dryRun == true) {
    logger.box(
      `Plan - ${appDescriptor.name} ${latestBuild.version} (dry run, nothing submitted)`,
      androidReleasePlanLines(latestBuild, rollout),
    );

    return;
  }

  const releaseConfirmed = await confirmOrCancel(
    commandService,
    `Submit ${appDescriptor.name} ${latestBuild.version} (${latestBuild.buildNumber}) to the PUBLIC Play production track?`,
    commandOptions,
  );

  if (releaseConfirmed == false) {
    return;
  }

  const incrementalConfirmed = await confirmIncrementalArtifact(
    commandService,
    latestBuild,
    'This build was incremental, not clean - promote anyway? Run `launch-store build android --clean` first for a from-scratch artifact.',
    commandOptions,
  );

  if (incrementalConfirmed == false) {
    return;
  }

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
  const buildCredentials = await readBuildCredentials(launchConfig, buildContext);
  const notifyEvent = readAndroidNotifyEvent(appDescriptor.name, latestBuild);

  try {
    await submitToStores(launchConfig, 'android', latestBuild, buildCredentials, buildContext);
  } catch (error) {
    if (isCommandExit(error)) {
      throw error;
    }

    const submitFailure = releaseFailure('submit Android release', error);

    try {
      const failedSubmitEvent = readFailedSubmitEvent(notifyEvent, submitFailure.message);
      await notify(launchConfig, failedSubmitEvent);
    } catch (notifyFailure) {
      throw releaseFailure('send release failure notification', notifyFailure);
    }

    throw submitFailure;
  }

  logger.line(
    `Submitted ${appDescriptor.name} ${latestBuild.version} (${latestBuild.buildNumber}) to the Play production track.`,
  );
  await sendReleaseNotification(launchConfig, notifyEvent);
}

function readRolloutFlag(rollout: string | undefined): number | undefined {
  try {
    return parseBuildRollout(rollout);
  } catch (error) {
    const failureMessage = errorMessage(error);
    throw releaseFailure('parse --rollout', error, failureMessage);
  }
}

function readAndroidNotifyEvent(appName: string, latestBuild: BuildArtifact): ReleaseSubmitEvent {
  const notifyEvent: ReleaseSubmitEvent = {
    event: 'submit',
    status: 'success',
    app: appName,
    platform: 'android',
    version: latestBuild.version,
    buildNumber: latestBuild.buildNumber,
    destination: 'the Play production track',
  };
  const downloadBytes = worstDownloadBytes(latestBuild.sizeReport);

  const hasDownloadSize = downloadBytes > 0;

  if (hasDownloadSize) {
    notifyEvent.sizeBytes = downloadBytes;
  }

  return notifyEvent;
}

function readBuildProfile(
  profiles: Record<string, BuildProfile>,
  profileName: string,
): BuildProfile {
  const namedProfile = profiles[profileName];

  if (namedProfile != null) {
    return namedProfile;
  }

  return { name: profileName };
}

function refusesAndroidAttach(commandOptions: ReleaseCommandOptions, platform: Platform): boolean {
  if (commandOptions.attachOnly != true) {
    return false;
  }

  return isApplePlatform(platform) == false;
}

/** Parse inputs, resolve shared configuration, and dispatch to the store-specific release path. */
export async function releaseCommandProgram(
  platformArgument: string,
  commandOptions: ReleaseCommandOptions,
  commandService: ReleaseCommandService = ReleaseCommandServiceLive(),
): Promise<void> {
  const platform = readReleasePlatform(platformArgument);

  if (refusesAndroidAttach(commandOptions, platform)) {
    throw releaseFailure(
      'select release platform',
      'attach-only',
      '--attach-only is iOS only; Google Play has no attach-without-submit step.',
    );
  }

  const loadedConfiguration = await readLaunchConfiguration();
  const appDescriptor = await readSelectedApp(loadedConfiguration.apps, commandOptions.app);
  const buildProfile = readBuildProfile(
    loadedConfiguration.config.profiles,
    commandOptions.profile,
  );
  const environmentOverrides = readEnvironmentOverrides(commandOptions.env);
  const resolvedEnvironment = await readResolvedEnvironment(
    appDescriptor,
    buildProfile,
    environmentOverrides,
    commandOptions,
    loadedConfiguration.config.envExclude,
  );

  if (isApplePlatform(platform)) {
    await releaseAppleBuild(
      platform,
      appDescriptor,
      buildProfile,
      commandOptions,
      loadedConfiguration.config,
      resolvedEnvironment,
      commandService,
    );

    return;
  }

  await releaseAndroidBuild(
    appDescriptor,
    buildProfile,
    commandOptions,
    loadedConfiguration.config,
    resolvedEnvironment,
    commandService,
  );
}

function readReleasePlatform(platformArgument: string): Platform {
  try {
    return parsePlatform(platformArgument);
  } catch (error) {
    const failureMessage = errorMessage(error);
    throw releaseFailure('parse release platform', error, failureMessage);
  }
}

async function readLaunchConfiguration() {
  try {
    return await loadConfig();
  } catch (error) {
    throw releaseFailure('load Launch configuration', error);
  }
}

async function readSelectedApp(apps: readonly AppDescriptor[], appName: string | undefined) {
  try {
    return await selectApp(apps, appName);
  } catch (error) {
    const failureMessage = errorMessage(error);
    throw releaseFailure('select app', error, failureMessage);
  }
}

function readEnvironmentOverrides(pairs: string[]): Record<string, string> {
  try {
    return parseCliEnv(pairs);
  } catch (error) {
    const failureMessage = errorMessage(error);
    throw releaseFailure('parse environment overrides', error, failureMessage);
  }
}

async function readResolvedEnvironment(
  appDescriptor: AppDescriptor,
  buildProfile: BuildProfile,
  environmentOverrides: Record<string, string>,
  commandOptions: ReleaseCommandOptions,
  envExclude: readonly string[] | undefined,
) {
  let resolved: Awaited<ReturnType<typeof resolveCommandEnv>>;

  try {
    resolved = await resolveCommandEnv({
      app: appDescriptor,
      profile: buildProfile,
      cliEnv: environmentOverrides,
      includeLocal: commandOptions.includeLocal,
      envExclude,
    });
  } catch (error) {
    throw releaseFailure('resolve release environment', error);
  }

  return applyBuildEnvironment(resolved, createLogger(false));
}
