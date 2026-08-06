import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import { ccacheOfferDeclined, markCcacheOfferDeclined } from '../config/firstRun.js';
import { ensureArtifactDirIgnored } from '../config/gitignore.js';
import { ensureCcacheInstalled } from '../config/toolchain.js';
import {
  resolveArtifactDir,
  resolveStorageProvider,
  type StorageResolverRequirements,
} from '../distribution/storage.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { captureCommandOutput, checkCommandExists } from '../services/exec.js';
import type { Logger } from '../services/logger.js';
import { nativeProjectDirName, nativeTargetHint, platformLabel } from '../services/platform.js';
import { checkTerminalIsInteractive, runWithProgress, withSpinner } from '../services/progress.js';
import { LaunchPrompt } from '../services/prompt.js';
import { makeCommandExit } from '../terminal/commandExit.js';
import { buildConsoleUrl } from '../terminal/consoleLinks.js';
import type { GlossaryTopic } from '../terminal/glossary.js';
import type { AppDescriptor, Platform, PlayTrack, SubmitTarget } from '../types/app.js';
import type { BuildArtifact, SizeReport } from '../types/artifacts.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import type { AppleCredentials } from '../types/credentials.js';
import { resolveRetentionDays } from './artifactRetention.js';
import { beginBuildLog, buildLogId, endBuildLog } from './buildLog.js';
import { mb } from './pipelineProviders.js';
import type {
  BuildOutput,
  BuildRunOptions,
  ConfirmUploadOptions,
  PreparedBuild,
  ReceiptOptions,
} from './pipelineTypes.js';

/** Marketing version stamped on artifacts and logs when app config omits one. */
const FALLBACK_MARKETING_VERSION = '0.0.0';

/** Prefer the app's marketing version; fall back so logs and indexes never store blanks. */
const artifactMarketingVersion = (app: AppDescriptor): string => {
  if (app.version === undefined) return FALLBACK_MARKETING_VERSION;
  return app.version;
};

/**
 * Own the per-build log lifecycle around the engine compile. Dry-run skips logging because no
 * compile runs. Completion notifications fire at the dispatch boundary ({@link runBuild}).
 */
export const runBuildStep = <Failure, Requirements>(
  prepared: PreparedBuild,
  buildNumber: number,
  compileStep: () => Effect.Effect<BuildOutput, Failure, Requirements>,
) =>
  Effect.gen(function* () {
    const { buildContext, app } = prepared;
    if (buildContext.dryRun) return yield* compileStep();
    yield* beginBuildLog(
      buildLogId({
        appName: app.name,
        version: artifactMarketingVersion(app),
        buildNumber,
        platform: buildContext.platform,
      }),
    );
    return yield* compileStep().pipe(Effect.ensuring(endBuildLog()));
  });

/** Keep a local artifactDir out of git before the first binary lands (idempotent; cloud no-ops). */
const ensureLocalArtifactDirIgnored = (config: LaunchConfig, log: Logger) =>
  Effect.gen(function* () {
    if (config.storage !== 'local') return;
    const artifactDirectory = yield* resolveArtifactDir(config.artifactDir);
    const ignored = yield* ensureArtifactDirIgnored(artifactDirectory);
    if (!ignored.added) return;
    let ignoredEntry = '';
    if (ignored.entry !== undefined) ignoredEntry = ignored.entry;
    yield* log.step('gitignore', `added ${ignoredEntry} (build artifacts stay out of git)`);
  });

/**
 * Announce retention policy and sweep old local binaries. `0` disables auto-sweep; newest per
 * app+platform is always kept. Cloud providers without `prune` no-op.
 */
const sweepStoredArtifacts = (
  storageProvider: {
    readonly prune?: (pruneOptions: {
      readonly now: number;
      readonly retentionDays: number;
    }) => Effect.Effect<{ pruned: readonly unknown[]; freedBytes: number }, unknown>;
  },
  retentionDays: number,
  log: Logger,
) =>
  Effect.gen(function* () {
    yield* log.tip(
      `kept ~${retentionDays} days, then auto-pruned to save space (launch builds prune)`,
    );
    if (storageProvider.prune === undefined) return;
    const swept = yield* storageProvider.prune({ now: Date.now(), retentionDays });
    if (swept.pruned.length === 0) return;
    let noun = 'builds';
    if (swept.pruned.length === 1) noun = 'build';
    yield* log.step(
      'prune',
      `removed ${swept.pruned.length} old ${noun} >${retentionDays}d - freed ${mb(swept.freedBytes)}`,
    );
  });

/** Store the built artifact (skipped in dry-run) and log its location. Shared by both platform spines. */
export const storeArtifact = (
  prepared: PreparedBuild,
  artifactPath: string,
  buildNumber: number,
  sizeReport: SizeReport,
  cleanBuilt: boolean,
) =>
  Effect.gen(function* () {
    const { config, app, profile, buildContext, log } = prepared;
    if (buildContext.dryRun) {
      yield* log.step('store', 'skipped (dry-run)');
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
    const storageProvider = yield* resolveStorageProvider(config);
    yield* ensureLocalArtifactDirIgnored(config, log);
    const stored = yield* storageProvider.put(buildArtifact);
    yield* log.step('store', stored.location);
    const retentionDays = resolveRetentionDays(config);
    if (retentionDays > 0) {
      yield* sweepStoredArtifacts(storageProvider, retentionDays, log);
    }
  });

/** One-line notice when a build runs without ccache. No fabricated speedup claims. */
const CCACHE_NOTICE =
  "ccache isn't installed - this build runs uncached. `launch doctor --fix` (or brew install ccache) speeds up repeat builds.";

/**
 * Offer inline ccache install when missing (interactive only). Decline is remembered; CI / no-brew
 * degrade to a notice. Never blocks or fails the build.
 */
export const nudgeIfNoCcache = (log: Logger) =>
  Effect.gen(function* () {
    if (yield* checkCommandExists('ccache')) return;
    if (yield* ccacheOfferDeclined()) {
      yield* log.warn(CCACHE_NOTICE);
      return;
    }
    switch (
      yield* ensureCcacheInstalled({
        interactive: yield* checkTerminalIsInteractive,
      })
    ) {
      case 'installed':
        yield* log.step('ccache', 'installed + configured - this build is now cached', 'ccache');
        return;
      case 'declined':
        yield* markCcacheOfferDeclined();
        yield* log.warn(CCACHE_NOTICE);
        return;
      case 'skipped-no-brew':
      case 'skipped-noninteractive':
        yield* log.warn(CCACHE_NOTICE);
        return;
    }
  });

/** Best-effort one-line ccache hit summary after an iOS build when ccache is present. */
export const reportCcacheStats = (log: Logger) =>
  Effect.gen(function* () {
    if (!(yield* checkCommandExists('ccache'))) return;
    const statsOutput = yield* captureCommandOutput('ccache', ['-s']).pipe(
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    if (statsOutput === undefined) return;
    const hitLine = statsOutput.split('\n').find((line) => /hit/i.test(line));
    if (hitLine === undefined) return;
    yield* log.step('cache', hitLine.trim(), 'ccache');
  });

/** A required native project or target is missing for the selected build platform. */
export type NativeProjectFailure = {
  readonly _tag: 'NativeProjectFailure';
  readonly platform: Platform;
  readonly message: string;
};

export const makeNativeProjectFailure = Data.tagged<NativeProjectFailure>('NativeProjectFailure');

/** Run Expo prebuild for ios/android when the native tree is missing (dry-run logs only). */
const runExpoPrebuild = (
  buildContext: ResolvedBuildContext,
  log: Logger,
  platform: 'ios' | 'android',
) =>
  Effect.gen(function* () {
    if (buildContext.dryRun) {
      yield* log.step(
        'prebuild',
        `would run \`expo prebuild --platform ${platform}\` (no ${platform}/ found)`,
        'prebuild',
      );
      return;
    }
    yield* runWithProgress('npx', ['expo', 'prebuild', '--platform', platform, '--clean'], {
      label: `Generating ${platform}/ (expo prebuild)`,
      cwd: buildContext.app.dir,
      env: buildContext.env,
    });
    yield* log.step('prebuild', `${platform}/ generated from app.json`, 'prebuild');
  });

/**
 * Ensure the Apple native Xcode project exists. iOS (and tvOS reusing ios/) can be generated by Expo
 * prebuild; macOS/visionOS have no prebuild generator and fail with an actionable gate.
 */
export const ensureNativeProject = (buildContext: ResolvedBuildContext, log: Logger) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const platform = buildContext.platform;
    const dirName = yield* nativeProjectDirName(platform);
    const nativeDir = pathService.join(buildContext.app.dir, dirName);
    if (yield* fileSystem.exists(nativeDir)) {
      yield* log.step(
        'native project',
        `using existing ${dirName}/ (no prebuild needed)`,
        'prebuild',
      );
      return;
    }
    if (platform !== 'ios' && platform !== 'tvos') {
      const targetHint = yield* nativeTargetHint(platform);
      return yield* Effect.fail(
        makeNativeProjectFailure({
          platform,
          message: `${platformLabel(platform)} native target not configured - Expo prebuild does not emit a ${platformLabel(platform)} target. Commit a native project (${targetHint}) at ${dirName}/, then re-run.`,
        }),
      );
    }
    // tvOS reuses ios/; without it, prebuild would emit iOS-only and the archive would fail later.
    if (platform === 'tvos') {
      return yield* Effect.fail(
        makeNativeProjectFailure({
          platform,
          message:
            'tvOS native target not configured - no ios/ project found. Commit a react-native-tvos project (its tvOS target lives in ios/), then re-run `launch build tvos`.',
        }),
      );
    }
    yield* runExpoPrebuild(buildContext, log, 'ios');
  });

/** Run `expo prebuild` only when android/ is missing; otherwise use the committed tree. */
export const ensureAndroidProject = (buildContext: ResolvedBuildContext, log: Logger) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const androidDir = pathService.join(buildContext.app.dir, 'android');
    if (yield* fileSystem.exists(androidDir)) {
      yield* log.step('native project', 'using existing android/ (no prebuild needed)', 'prebuild');
      return;
    }
    yield* runExpoPrebuild(buildContext, log, 'android');
  });

/**
 * Poll the uploaded build's processing state under a spinner so the run ends with a clear status.
 * Safe to Ctrl-C - Apple keeps processing regardless.
 */
export const reportProcessing = (
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  buildNumber: number,
  log: Logger,
) =>
  Effect.gen(function* () {
    const appleStoreClients = yield* AppleStoreClientService;
    const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
    const processingState = yield* withSpinner(
      "Processing on Apple's side (safe to Ctrl-C; it keeps processing)",
      () =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 6; attempt++) {
            yield* Effect.sleep('10 seconds');
            const currentState = yield* appStoreClient
              .getBuildProcessingState(bundleId, buildNumber)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (currentState === null) continue;
            if (currentState !== 'PROCESSING') return currentState;
          }
          return null;
        }),
    );
    if (processingState === null) {
      yield* log.note("Still processing - it'll appear in TestFlight shortly.");
      return;
    }
    let processingDescription = `state: ${processingState}`;
    if (processingState === 'VALID') processingDescription = 'ready to test on TestFlight';
    yield* log.step('processing', processingDescription);
  });

/** Worst-case store download across device variants, or on-disk size when no per-device report exists. */
export const worstDownloadBytes = (sizeReport: SizeReport): number => {
  if (sizeReport.entries.length === 0) return sizeReport.artifactBytes;
  return sizeReport.entries.reduce((maxBytes, entry) => Math.max(maxBytes, entry.downloadBytes), 0);
};

/**
 * Canonical size headline (upload confirm + receipt): both numbers when available, on-disk alone
 * otherwise. `wrapSize` decorates each size (receipt uses {@link Logger.chip}).
 */
export const sizeSummary = (
  sizeReport: SizeReport,
  wrapSize: (size: string) => string = (size) => size,
): string => {
  if (sizeReport.entries.length === 0) {
    return `on disk ${wrapSize(mb(sizeReport.artifactBytes))} (no per-device estimate)`;
  }
  return `download ${wrapSize(mb(worstDownloadBytes(sizeReport)))} - on disk ${wrapSize(mb(sizeReport.artifactBytes))}`;
};

/** A build whose worst-case download grows beyond this fraction over the previous one earns a warning. */
const GROWTH_WARN_RATIO = 0.1;

export type UploadSizeGrowth = {
  readonly pct: number;
  readonly buildNumber: number;
};

export type UploadSizeReadout = {
  readonly lines: string[];
  readonly grew: UploadSizeGrowth | null;
};

/**
 * Pre-upload size lines plus optional growth vs the previous build. Pure for unit testing.
 * Growth past {@link GROWTH_WARN_RATIO} is returned so callers render line + warning consistently.
 */
export const uploadSizeReadout = (
  sizeReport: SizeReport,
  previous?: {
    downloadBytes: number;
    buildNumber: number;
  },
): UploadSizeReadout => {
  if (sizeReport.entries.length === 0) {
    return {
      lines: [`on disk ${mb(sizeReport.artifactBytes)} (no per-device estimate)`],
      grew: null,
    };
  }
  const worstBytes = worstDownloadBytes(sizeReport);
  let downloadLine = `download ${mb(worstBytes)}`;
  let grew: UploadSizeGrowth | null = null;
  if (previous !== undefined && previous.downloadBytes > 0) {
    const deltaBytes = worstBytes - previous.downloadBytes;
    const growthRatio = deltaBytes / previous.downloadBytes;
    let deltaSign = '-';
    if (deltaBytes >= 0) deltaSign = '+';
    downloadLine += ` (${deltaSign}${mb(Math.abs(deltaBytes))} since build ${previous.buildNumber})`;
    if (growthRatio > GROWTH_WARN_RATIO) {
      grew = {
        pct: Math.round(growthRatio * 100),
        buildNumber: previous.buildNumber,
      };
    }
  }
  return {
    lines: [downloadLine, `on disk ${mb(sizeReport.artifactBytes)}`],
    grew,
  };
};

/**
 * Most recent prior stored build for this app+platform (baseline for upload-time size delta).
 * Skips the build just stored (matched by build number). Undefined on the first build.
 */
export const previousBuild = (
  config: LaunchConfig,
  app: AppDescriptor,
  platform: Platform,
  currentBuildNumber: number,
): Effect.Effect<
  | {
      downloadBytes: number;
      buildNumber: number;
    }
  | undefined,
  unknown,
  StorageResolverRequirements
> =>
  Effect.gen(function* () {
    const storageProvider = yield* resolveStorageProvider(config);
    const artifactHistory = yield* storageProvider.list();
    const priorArtifact = artifactHistory.find(
      (buildArtifact) =>
        buildArtifact.appName === app.name &&
        buildArtifact.platform === platform &&
        buildArtifact.buildNumber !== currentBuildNumber,
    );
    if (priorArtifact === undefined) return undefined;
    return {
      downloadBytes: worstDownloadBytes(priorArtifact.sizeReport),
      buildNumber: priorArtifact.buildNumber,
    };
  });

/**
 * Per-device size readout (iOS thinning / Android bundletool), or a single on-disk line when no
 * per-device report. Display only - budget decision lives in {@link confirmUpload}.
 */
export const reportSize = (
  sizeReport: SizeReport,
  log: Logger,
  sizeTopic: GlossaryTopic = 'app-thinning',
) =>
  Effect.gen(function* () {
    if (sizeReport.entries.length === 0) {
      yield* log.step(
        'size',
        `${log.chip(mb(sizeReport.artifactBytes))} on disk (no per-device report)`,
        sizeTopic,
      );
      return;
    }
    for (const entry of sizeReport.entries) {
      let installSuffix = '';
      if (entry.installBytes > 0) installSuffix = ` - install ${mb(entry.installBytes)}`;
      yield* log.step(
        'size',
        `${entry.device}: download ${log.chip(mb(entry.downloadBytes))}${installSuffix}`,
        sizeTopic,
      );
    }
  });

const noteProceedDespiteBudget = (log: Logger, overBudget: boolean) => {
  if (!overBudget) return Effect.void;
  return log.note('Proceeding anyway (non-interactive or --yes).');
};

/**
 * Single pre-upload checkpoint: surfaces app/build/size, warns over budget or growth, and asks to
 * continue only on an interactive TTY without `--yes`.
 */
export const confirmUpload = (options: ConfirmUploadOptions) =>
  Effect.gen(function* () {
    const { report, budgetMB, destination, app, version, buildNumber, previous, yes, log } =
      options;
    const overBudget = worstDownloadBytes(report) > budgetMB * 1024 * 1024;
    const { lines, grew } = uploadSizeReadout(report, previous);
    yield* log.notice(
      ` Upload to ${destination}`,
      `${app.name} ${version} (build ${buildNumber})`,
      ...lines,
    );
    if (grew !== null) {
      yield* log.warn(`Grew ${grew.pct}% since build ${grew.buildNumber}.`);
    }
    if (overBudget) {
      yield* log.warn(
        `Worst-case download ${mb(worstDownloadBytes(report))} is over the ${budgetMB} MB budget.`,
      );
    }
    if (yes) {
      yield* noteProceedDespiteBudget(log, overBudget);
      return;
    }
    const canPrompt = yield* checkTerminalIsInteractive;
    if (!canPrompt) {
      yield* noteProceedDespiteBudget(log, overBudget);
      return;
    }
    const launchPrompt = yield* LaunchPrompt;
    const proceed = yield* launchPrompt.confirm('Continue?');
    if (proceed) return;
    let cancellationMessage = 'Stopped before upload.';
    if (overBudget) cancellationMessage = 'Stopped before upload (over size budget).';
    yield* launchPrompt.cancel(cancellationMessage);
    return yield* Effect.fail(makeCommandExit({ exitCode: 0 }));
  });

/** Receipt destination line: where the build went (or that it was not uploaded). */
export const receiptDestination = (
  platform: Platform,
  options: BuildRunOptions,
  track?: PlayTrack,
): string => {
  if (!options.submit) return 'built - not uploaded';
  if (platform === 'android') {
    let playTrack: PlayTrack = 'internal';
    if (track !== undefined) playTrack = track;
    return `Play - ${playTrack} track`;
  }
  if (options.target === 'testing') return 'TestFlight';
  return 'App Store - in review';
};

/**
 * Best-effort deep link to the uploaded build in App Store Connect. Falls back to console home
 * when the app id cannot be resolved. Never fails the build.
 */
export const resolveAscBuildLink = (
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  target: SubmitTarget,
) =>
  Effect.gen(function* () {
    const appleStoreClients = yield* AppleStoreClientService;
    const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
    const appId = yield* appStoreClient
      .getAppId(bundleId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    let linkAppId: string | undefined;
    if (appId !== null) linkAppId = appId;
    let consoleDestination: 'testflight' | 'asc' = 'asc';
    if (target === 'testing') consoleDestination = 'testflight';
    return buildConsoleUrl(consoleDestination, 'ios', linkAppId);
  });

/**
 * End-of-run "Shipped" receipt: app/version/build, both-numbers size, destination, optional link.
 * Headline values are pilled via {@link Logger.chip}.
 */
export const renderReceipt = (options: ReceiptOptions) =>
  Effect.gen(function* () {
    const { app, version, buildNumber, report, destination, link, log } = options;
    const receiptLines = [
      `${log.chip(app.name)} ${log.chip(version)} (${buildNumber})`,
      sizeSummary(report, (size) => log.chip(size)),
      destination,
    ];
    if (link !== undefined && link.length > 0) receiptLines.push(link);
    yield* log.shipped(receiptLines);
  });
