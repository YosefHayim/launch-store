import { ccacheOfferDeclined, markCcacheOfferDeclined } from '../config/first-run.ts';
import { ensureArtifactDirIgnored } from '../config/gitignore.ts';
import { ensureCcacheInstalled } from '../config/toolchain.ts';
import { resolveArtifactDir, resolveStorageProvider } from '../distribution/storage.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { captureCommandOutput, checkCommandExists } from '../services/platform/exec.ts';
import type { Logger } from '../services/platform/logger.ts';
import {
  nativeProjectDirName,
  nativeTargetHint,
  platformLabel,
} from '../services/stores/platform.ts';
import {
  checkTerminalIsInteractive,
  runWithProgress,
  withSpinner,
} from '../services/platform/progress.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { makeCommandExit } from '../terminal/command-exit.ts';
import { buildConsoleUrl } from '../terminal/console-links.ts';
import type { GlossaryTopic } from '../terminal/glossary.ts';
import type { AppDescriptor, Platform, PlayTrack } from '../types/app.ts';
import type { BuildArtifact, SizeReport } from '../types/artifacts.ts';
import type { LaunchConfig, PrebuildMode, ResolvedBuildContext } from '../types/config.ts';
import type { AppleCredentials, BuildCredentials } from '../types/credentials.ts';
import type { SubmitArtifact } from '../types/providers.ts';
import { pathExists } from '../path-exists.ts';
import { join } from 'node:path';
import { resolveRetentionDays } from './artifact-retention.ts';
import { beginBuildLog, buildLogId, endBuildLog } from './build-log.ts';
import { mb, resolveSizeBudgetMB, submitToStores } from './pipeline-providers.ts';
import type {
  BuildOutput,
  BuildRunOptions,
  ConfirmUploadOptions,
  PreparedBuild,
  ReceiptOptions,
} from './pipeline-types.ts';

const BYTES_PER_KILOBYTE = 1024;
const bytesPerMegabyte = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;

/** Prefer the app's marketing version; fall back so logs and indexes never store blanks. */
function artifactMarketingVersion(app: AppDescriptor): string {
  if (app.version == null) {
    return '0.0.0';
  }

  return app.version;
}

/**
 * Own the per-build log lifecycle around the engine compile. Dry-run skips logging because no
 * compile runs.
 */
export async function runBuildStep(
  prepared: PreparedBuild,
  buildNumber: number,
  compileStep: () => Promise<BuildOutput>,
): Promise<BuildOutput> {
  const buildContext = prepared.buildContext;
  const app = prepared.app;
  const isDryRun = buildContext.dryRun == true;

  if (isDryRun) {
    const dryOutput = await compileStep();

    return dryOutput;
  }

  const logId = buildLogId({
    appName: app.name,
    version: artifactMarketingVersion(app),
    buildNumber,
    platform: buildContext.platform,
  });
  beginBuildLog(logId);

  try {
    const compiled = await compileStep();

    return compiled;
  } finally {
    endBuildLog();
  }
}

/** Keep a local artifactDir out of git before the first binary lands. Cloud storage no-ops. */
async function ensureLocalArtifactDirIgnored(
  launchConfig: LaunchConfig,
  log: Logger,
): Promise<void> {
  const isLocal = launchConfig.storage == 'local';

  if (isLocal == false) {
    return;
  }

  const artifactDirectory = await resolveArtifactDir(launchConfig.artifactDir);
  const ignored = await ensureArtifactDirIgnored(artifactDirectory);
  const wasAdded = ignored.added == true;

  if (wasAdded == false) {
    return;
  }

  let ignoredEntry = '';

  if (ignored.entry != null) {
    ignoredEntry = ignored.entry;
  }

  log.step('gitignore', `added ${ignoredEntry} (build artifacts stay out of git)`);
}

type PruneSweep = {
  pruned: readonly unknown[];
  freedBytes: number;
};

async function sweepStoredArtifacts(
  storageProvider: {
    readonly prune?: (pruneOptions: {
      readonly now: number;
      readonly retentionDays: number;
    }) => Promise<PruneSweep>;
  },
  retentionDays: number,
  log: Logger,
): Promise<void> {
  log.tip(`kept ~${retentionDays} days, then auto-pruned to save space (launch builds prune)`);

  if (storageProvider.prune == null) {
    return;
  }

  const swept = await storageProvider.prune({ now: Date.now(), retentionDays });
  const removedNothing = swept.pruned.length == 0;

  if (removedNothing) {
    return;
  }

  let noun = 'builds';

  if (swept.pruned.length == 1) {
    noun = 'build';
  }

  const megabytes = mb(swept.freedBytes);
  log.step(
    'prune',
    `removed ${swept.pruned.length} old ${noun} >${retentionDays}d - freed ${megabytes}`,
  );
}

/** Store the built artifact (skipped in dry-run) and log its location. */
export async function storeArtifact(
  prepared: PreparedBuild,
  artifactPath: string,
  buildNumber: number,
  sizeReport: SizeReport,
  cleanBuilt: boolean,
): Promise<void> {
  const launchConfig = prepared.config;
  const app = prepared.app;
  const profile = prepared.profile;
  const buildContext = prepared.buildContext;
  const log = prepared.log;
  const isDryRun = buildContext.dryRun == true;

  if (isDryRun) {
    log.step('store', 'skipped (dry-run)');
    return;
  }

  const buildArtifact: BuildArtifact = {
    path: artifactPath,
    platform: buildContext.platform,
    appName: app.name,
    profile: profile.name,
    version: artifactMarketingVersion(app),
    buildNumber,
    sizeReport,
    clean: cleanBuilt,
    createdAt: new Date().toISOString(),
  };
  const storageProvider = await resolveStorageProvider(launchConfig);

  await ensureLocalArtifactDirIgnored(launchConfig, log);

  const stored = await storageProvider.put(buildArtifact);

  log.step('store', stored.location);

  const retentionDays = resolveRetentionDays(launchConfig);
  const shouldSweep = retentionDays > 0;

  if (shouldSweep) {
    await sweepStoredArtifacts(storageProvider, retentionDays, log);
  }
}

function warnNoCcache(log: Logger): void {
  log.warn(
    "ccache isn't installed - this build runs uncached. `launch doctor --fix` (or brew install ccache) speeds up repeat builds.",
  );
}

/**
 * Offer inline ccache install when missing. Decline is remembered. Never blocks the build.
 */
export async function nudgeIfNoCcache(log: Logger): Promise<void> {
  const ccacheExists = await checkCommandExists('ccache');

  if (ccacheExists) {
    return;
  }

  const offerDeclined = await ccacheOfferDeclined();

  if (offerDeclined) {
    warnNoCcache(log);
    return;
  }

  const terminalIsInteractive = checkTerminalIsInteractive();
  const installStatus = await ensureCcacheInstalled({
    interactive: terminalIsInteractive,
  });

  switch (installStatus) {
    case 'installed':
      log.step('ccache', 'installed + configured - this build is now cached', 'ccache');
      return;
    case 'declined':
      await markCcacheOfferDeclined();
      warnNoCcache(log);
      return;
    case 'skipped-no-brew':
    case 'skipped-noninteractive':
      warnNoCcache(log);
      return;
  }
}

function isCacheHitLine(line: string): boolean {
  // A ccache stats row that mentions hits.
  return /hit/i.test(line);
}

/** Best-effort one-line ccache hit summary after an iOS build when ccache is present. */
export async function reportCcacheStats(log: Logger): Promise<void> {
  const ccacheExists = await checkCommandExists('ccache');

  if (ccacheExists == false) {
    return;
  }

  let statsOutput: string;

  try {
    statsOutput = await captureCommandOutput('ccache', ['-s']);
  } catch (error) {
    const statsFailed = error != null;

    if (statsFailed) {
      return;
    }

    return;
  }

  const hitLine = statsOutput.split('\n').find(isCacheHitLine);

  if (hitLine == null) {
    return;
  }

  log.step('cache', hitLine.trim(), 'ccache');
}

/** A required native project or target is missing for the selected build platform. */
export type NativeProjectFailure = {
  readonly _tag: 'NativeProjectFailure';
  readonly platform: Platform;
  readonly message: string;
};

export function makeNativeProjectFailure(fields: {
  platform: Platform;
  message: string;
}): NativeProjectFailure {
  return { _tag: 'NativeProjectFailure', platform: fields.platform, message: fields.message };
}

async function runExpoPrebuild(
  buildContext: ResolvedBuildContext,
  log: Logger,
  platform: 'ios' | 'android',
  reason: string,
): Promise<void> {
  const isDryRun = buildContext.dryRun == true;

  if (isDryRun) {
    log.step(
      'prebuild',
      `would run \`expo prebuild --platform ${platform} --clean\` (${reason})`,
      'prebuild',
    );
    return;
  }

  await runWithProgress('npx', ['expo', 'prebuild', '--platform', platform, '--clean'], {
    label: `Generating ${platform}/ (expo prebuild)`,
    cwd: buildContext.app.dir,
    env: buildContext.env,
  });
  log.step('prebuild', `${platform}/ generated from app.json`, 'prebuild');
}

function shouldAlwaysPrebuildIos(prebuild: PrebuildMode, platform: Platform): boolean {
  if (prebuild != 'always') {
    return false;
  }

  return platform == 'ios';
}

function needsCommittedNativeProject(platform: Platform): boolean {
  if (platform == 'ios') {
    return false;
  }

  if (platform == 'tvos') {
    return false;
  }

  return true;
}

/**
 * Ensure the Apple native project exists. iOS can be generated by Expo prebuild. macOS and visionOS
 * cannot, and tvOS reuses a committed ios/ project.
 */
export async function ensureNativeProject(
  buildContext: ResolvedBuildContext,
  log: Logger,
  prebuild: PrebuildMode = 'missing',
): Promise<void> {
  const platform = buildContext.platform;
  const dirName = nativeProjectDirName(platform);
  const nativeDir = join(buildContext.app.dir, dirName);
  const alwaysPrebuild = shouldAlwaysPrebuildIos(prebuild, platform);

  if (alwaysPrebuild) {
    await runExpoPrebuild(buildContext, log, 'ios', "prebuild: 'always'");
    return;
  }

  const nativeExists = await pathExists(nativeDir);

  if (nativeExists) {
    log.step('native project', `using existing ${dirName}/ (no prebuild needed)`, 'prebuild');
    return;
  }

  const needsCommit = needsCommittedNativeProject(platform);

  if (needsCommit) {
    const targetHint = nativeTargetHint(platform);

    throw makeNativeProjectFailure({
      platform,
      message: `${platformLabel(platform)} native target not configured - Expo prebuild does not emit a ${platformLabel(platform)} target. Commit a native project (${targetHint}) at ${dirName}/, then re-run.`,
    });
  }

  const isTvos = platform == 'tvos';

  if (isTvos) {
    throw makeNativeProjectFailure({
      platform,
      message:
        'tvOS native target not configured - no ios/ project found. Commit a react-native-tvos project (its tvOS target lives in ios/), then re-run `launch build tvos`.',
    });
  }

  await runExpoPrebuild(buildContext, log, 'ios', 'no ios/ found');
}

/** Run `expo prebuild` when android/ is missing, or on every build with `prebuild: 'always'`. */
export async function ensureAndroidProject(
  buildContext: ResolvedBuildContext,
  log: Logger,
  prebuild: PrebuildMode = 'missing',
): Promise<void> {
  const alwaysPrebuild = prebuild == 'always';

  if (alwaysPrebuild) {
    await runExpoPrebuild(buildContext, log, 'android', "prebuild: 'always'");
    return;
  }

  const androidDir = join(buildContext.app.dir, 'android');
  const androidExists = await pathExists(androidDir);

  if (androidExists) {
    log.step('native project', 'using existing android/ (no prebuild needed)', 'prebuild');
    return;
  }

  await runExpoPrebuild(buildContext, log, 'android', 'no android/ found');
}

function waitForAppleProcessingPoll(): Promise<void> {
  const processingPollDelayMilliseconds = 10_000;

  return new Promise(function finishWait(finish) {
    setTimeout(finish, processingPollDelayMilliseconds);
  });
}

async function readAppleProcessingState(
  appStoreClient: {
    getBuildProcessingState: (bundleId: string, buildNumber: number) => Promise<string | null>;
  },
  bundleId: string,
  buildNumber: number,
): Promise<string | null> {
  try {
    const currentState = await appStoreClient.getBuildProcessingState(bundleId, buildNumber);

    return currentState;
  } catch (error) {
    const pollFailed = error != null;

    if (pollFailed) {
      return null;
    }

    return null;
  }
}

async function pollAppleProcessingState(
  appStoreClient: {
    getBuildProcessingState: (bundleId: string, buildNumber: number) => Promise<string | null>;
  },
  bundleId: string,
  buildNumber: number,
): Promise<string | null> {
  const processingAttemptLimit = 6;

  for (let attempt = 0; attempt < processingAttemptLimit; attempt += 1) {
    await waitForAppleProcessingPoll();

    const currentState = await readAppleProcessingState(appStoreClient, bundleId, buildNumber);
    const isUnknown = currentState == null;

    if (isUnknown) {
      continue;
    }

    const finishedProcessing = currentState != 'PROCESSING';

    if (finishedProcessing) {
      return currentState;
    }
  }

  return null;
}

/** Poll the uploaded build until Apple leaves PROCESSING, or time runs out. */
export async function reportProcessing(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  buildNumber: number,
  log: Logger,
): Promise<void> {
  const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);

  async function pollProcessing(): Promise<string | null> {
    const processingState = await pollAppleProcessingState(appStoreClient, bundleId, buildNumber);

    return processingState;
  }

  const processingState = await withSpinner(
    "Processing on Apple's side (safe to Ctrl-C; it keeps processing)",
    pollProcessing,
  );
  const stillProcessing = processingState == null;

  if (stillProcessing) {
    log.note("Still processing - it'll appear in TestFlight shortly.");
    return;
  }

  let processingDescription = `state: ${processingState}`;

  if (processingState == 'VALID') {
    processingDescription = 'ready to test on TestFlight';
  }

  log.step('processing', processingDescription);
}

/** Worst-case store download across device variants, or on-disk size when no per-device report exists. */
export function worstDownloadBytes(sizeReport: SizeReport): number {
  const hasNoEntries = sizeReport.entries.length == 0;

  if (hasNoEntries) {
    return sizeReport.artifactBytes;
  }

  return sizeReport.entries.reduce(function largerDownload(
    maxBytes: number,
    sizeEntry: SizeReport['entries'][number],
  ) {
    return Math.max(maxBytes, sizeEntry.downloadBytes);
  }, 0);
}

/** Canonical size headline. `wrapSize` decorates each size. */
export function sizeSummary(
  sizeReport: SizeReport,
  wrapSize: (size: string) => string = function identitySize(size: string) {
    return size;
  },
): string {
  const hasNoEntries = sizeReport.entries.length == 0;

  if (hasNoEntries) {
    const megabytes = mb(sizeReport.artifactBytes);
    return `on disk ${wrapSize(megabytes)} (no per-device estimate)`;
  }

  const megabytes = mb(worstDownloadBytes(sizeReport));
  return `download ${wrapSize(megabytes)} - on disk ${wrapSize(mb(sizeReport.artifactBytes))}`;
}

/** A build whose worst-case download grows beyond this fraction over the previous one earns a warning. */
const growthWarnRatio = 0.1;

type UploadSizeGrowth = {
  readonly pct: number;
  readonly buildNumber: number;
};

type UploadSizeReadout = {
  readonly lines: string[];
  readonly grew: UploadSizeGrowth | null;
};

type PreviousDownload = {
  downloadBytes: number;
  buildNumber: number;
};

function hasPreviousDownload(previous: PreviousDownload | undefined): previous is PreviousDownload {
  if (previous == null) {
    return false;
  }

  return previous.downloadBytes > 0;
}

/**
 * Pre-upload size lines plus optional growth vs the previous build.
 */
export function uploadSizeReadout(
  sizeReport: SizeReport,
  previous?: PreviousDownload,
): UploadSizeReadout {
  const hasNoEntries = sizeReport.entries.length == 0;

  if (hasNoEntries) {
    return {
      lines: [`on disk ${mb(sizeReport.artifactBytes)} (no per-device estimate)`],
      grew: null,
    };
  }

  const worstBytes = worstDownloadBytes(sizeReport);
  let downloadLine = `download ${mb(worstBytes)}`;
  let grew: UploadSizeGrowth | null = null;

  if (hasPreviousDownload(previous)) {
    const deltaBytes = worstBytes - previous.downloadBytes;
    const growthRatio = deltaBytes / previous.downloadBytes;
    let deltaSign = '-';

    if (deltaBytes >= 0) {
      deltaSign = '+';
    }

    downloadLine += ` (${deltaSign}${mb(Math.abs(deltaBytes))} since build ${previous.buildNumber})`;

    const grewPastRatio = growthRatio > growthWarnRatio;

    if (grewPastRatio) {
      grew = { pct: Math.round(growthRatio * 100), buildNumber: previous.buildNumber };
    }
  }

  return {
    lines: [downloadLine, `on disk ${mb(sizeReport.artifactBytes)}`],
    grew,
  };
}

function isEarlierBuild(appName: string, platform: Platform, currentBuildNumber: number) {
  return function matches(buildArtifact: BuildArtifact): boolean {
    const isSameApp = buildArtifact.appName == appName;

    if (isSameApp == false) {
      return false;
    }

    const isSamePlatform = buildArtifact.platform == platform;

    if (isSamePlatform == false) {
      return false;
    }

    return buildArtifact.buildNumber != currentBuildNumber;
  };
}

/** Most recent prior stored build for this app and platform, skipping the build just stored. */
export async function previousBuild(
  launchConfig: LaunchConfig,
  app: AppDescriptor,
  platform: Platform,
  currentBuildNumber: number,
): Promise<PreviousDownload | undefined> {
  const storageProvider = await resolveStorageProvider(launchConfig);
  const artifactHistory = await storageProvider.list();
  const buildProgram = isEarlierBuild(app.name, platform, currentBuildNumber);
  const priorArtifact = artifactHistory.find(buildProgram);

  if (priorArtifact == null) {
    return undefined;
  }

  return {
    downloadBytes: worstDownloadBytes(priorArtifact.sizeReport),
    buildNumber: priorArtifact.buildNumber,
  };
}

/** Per-device size readout, or a single on-disk line when no per-device report exists. */
export async function reportSize(
  sizeReport: SizeReport,
  log: Logger,
  sizeTopic: GlossaryTopic = 'app-thinning',
): Promise<void> {
  const hasNoEntries = sizeReport.entries.length == 0;

  if (hasNoEntries) {
    const megabytes = mb(sizeReport.artifactBytes);
    log.step('size', `${log.chip(megabytes)} on disk (no per-device report)`, sizeTopic);
    return;
  }

  for (const sizeEntry of sizeReport.entries) {
    let installSuffix = '';
    const hasInstallBytes = sizeEntry.installBytes > 0;

    if (hasInstallBytes) {
      installSuffix = ` - install ${mb(sizeEntry.installBytes)}`;
    }

    const megabytes = mb(sizeEntry.downloadBytes);
    log.step(
      'size',
      `${sizeEntry.device}: download ${log.chip(megabytes)}${installSuffix}`,
      sizeTopic,
    );
  }
}

function noteProceedDespiteBudget(log: Logger, overBudget: boolean): void {
  if (overBudget == false) {
    return;
  }

  log.note('Proceeding anyway (non-interactive or --yes).');
}

/**
 * Show size, warn over budget or growth, and ask to continue only on an interactive TTY without `--yes`.
 * Cancel exits with code 0.
 */
export async function confirmUpload(uploadOptions: ConfirmUploadOptions): Promise<void> {
  const report = uploadOptions.report;
  const budgetMB = uploadOptions.budgetMB;
  const destination = uploadOptions.destination;
  const app = uploadOptions.app;
  const version = uploadOptions.version;
  const buildNumber = uploadOptions.buildNumber;
  const previous = uploadOptions.previous;
  const yes = uploadOptions.yes;
  const log = uploadOptions.log;
  const overBudget = worstDownloadBytes(report) > budgetMB * bytesPerMegabyte;
  const readout = uploadSizeReadout(report, previous);

  log.notice(
    ` Upload to ${destination}`,
    `${app.name} ${version} (build ${buildNumber})`,
    ...readout.lines,
  );

  const grew = readout.grew;

  if (grew != null) {
    log.warn(`Grew ${grew.pct}% since build ${grew.buildNumber}.`);
  }

  if (overBudget) {
    const megabytes = mb(worstDownloadBytes(report));
    log.warn(`Worst-case download ${megabytes} is over the ${budgetMB} MB budget.`);
  }

  if (yes) {
    noteProceedDespiteBudget(log, overBudget);
    return;
  }

  const canPrompt = checkTerminalIsInteractive();

  if (canPrompt == false) {
    noteProceedDespiteBudget(log, overBudget);
    return;
  }

  const launchPrompt = LaunchPrompt;
  const proceed = await launchPrompt.confirm('Continue?');

  if (proceed) {
    return;
  }

  let cancellationMessage = 'Stopped before upload.';

  if (overBudget) {
    cancellationMessage = 'Stopped before upload (over size budget).';
  }

  launchPrompt.cancel(cancellationMessage);
  throw makeCommandExit({ exitCode: 0 });
}

/** Confirm the upload against the size budget, then send the iOS build to every configured store. */
export async function uploadIosBuild(
  prepared: PreparedBuild,
  buildOptions: BuildRunOptions,
  artifact: SubmitArtifact,
  sizeReport: SizeReport,
  credentials: BuildCredentials,
): Promise<void> {
  const launchConfig = prepared.config;
  const app = prepared.app;
  const log = prepared.log;
  const buildContext = prepared.buildContext;
  const previous = await previousBuild(
    launchConfig,
    app,
    buildContext.platform,
    artifact.buildNumber,
  );

  const sizeBudgetMB = resolveSizeBudgetMB(buildOptions, prepared.profile);
  await confirmUpload({
    report: sizeReport,
    budgetMB: sizeBudgetMB,
    destination: 'TestFlight',
    app,
    version: artifact.version,
    buildNumber: artifact.buildNumber,
    previous,
    yes: buildOptions.yes == true,
    log,
  });
  await submitToStores(launchConfig, buildContext.platform, artifact, credentials, buildContext);
  log.step('submit', 'uploaded to TestFlight', 'testflight');
}

/** Receipt destination line: where the build went, or that it was not uploaded. */
export function receiptDestination(
  platform: Platform,
  buildOptions: BuildRunOptions,
  track?: PlayTrack,
): string {
  const didNotSubmit = buildOptions.submit == false;

  if (didNotSubmit) {
    return 'built - not uploaded';
  }

  const isAndroid = platform == 'android';

  if (isAndroid) {
    let playTrack: PlayTrack = 'internal';

    if (track != null) {
      playTrack = track;
    }

    return `Play - ${playTrack} track`;
  }

  return 'TestFlight';
}

/** Best-effort deep link to the uploaded build. Falls back to the console home. Never fails the build. */
export async function resolveAscBuildLink(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
): Promise<string> {
  const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);
  let appId: string | null = null;

  try {
    appId = await appStoreClient.getAppId(bundleId);
  } catch (error) {
    const lookupFailed = error != null;

    if (lookupFailed) {
      appId = null;
    }
  }

  let linkAppId: string | undefined;

  if (appId != null) {
    linkAppId = appId;
  }

  return buildConsoleUrl('testflight', 'ios', linkAppId);
}

function hasReceiptLink(link: string | undefined): link is string {
  if (link == null) {
    return false;
  }

  return link.length > 0;
}

/** End-of-run receipt: app, version, build, size, destination, and an optional link. */
export async function renderReceipt(receiptOptions: ReceiptOptions): Promise<void> {
  const app = receiptOptions.app;
  const version = receiptOptions.version;
  const buildNumber = receiptOptions.buildNumber;
  const report = receiptOptions.report;
  const destination = receiptOptions.destination;
  const link = receiptOptions.link;
  const log = receiptOptions.log;
  const receiptLines = [
    `${log.chip(app.name)} ${log.chip(version)} (${buildNumber})`,
    sizeSummary(report, function chipSize(size: string) {
      return log.chip(size);
    }),
    destination,
  ];

  if (hasReceiptLink(link)) {
    receiptLines.push(link);
  }

  log.shipped(receiptLines);
}
