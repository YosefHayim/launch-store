import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import type { AppDescriptor, Platform, PlayTrack, SubmitTarget } from '../types/app.js';
import type { BuildArtifact, SizeReport } from '../types/artifacts.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import type { AppleCredentials } from '../types/credentials.js';
import { ccacheOfferDeclined, markCcacheOfferDeclined } from '../config/firstRun.js';
import { ensureCcacheInstalled } from '../config/toolchain.js';
import { beginBuildLog, buildLogId, endBuildLog } from './buildLog.js';
import {
  resolveArtifactDir,
  resolveStorageProvider,
  type StorageResolverRequirements,
} from '../distribution/storage.js';
import { ensureArtifactDirIgnored } from '../config/gitignore.js';
import { resolveRetentionDays } from './artifactRetention.js';
import type { Logger } from '../services/logger.js';
import type { GlossaryTopic } from '../terminal/glossary.js';
import { captureCommandOutput, checkCommandExists } from '../services/exec.js';
import { buildConsoleUrl } from '../terminal/consoleLinks.js';
import { nativeProjectDirName, nativeTargetHint, platformLabel } from '../services/platform.js';
import { checkTerminalIsInteractive, runWithProgress, withSpinner } from '../services/progress.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { LaunchPrompt } from '../services/prompt.js';
import { makeCommandExit } from '../terminal/commandExit.js';
import type {
  BuildOutput,
  BuildRunOptions,
  ConfirmUploadOptions,
  PreparedBuild,
  ReceiptOptions,
} from './pipelineTypes.js';
import { mb } from './pipelineProviders.js';
/**
 * Wrap the build-engine call so its native output is captured to a per-build log keyed by build id
 * (read back by `launch builds log` and the failure diagnostics). Skipped in dry-run - no real build
 * runs. Completion notifications fire separately at the dispatch boundary (see {@link runBuild}), so
 * this stays a single concern: own the log's lifecycle around the compile, nothing more.
 */
export const runBuildStep = <Failure, Requirements>(
  prepared: PreparedBuild,
  buildNumber: number,
  build: () => Effect.Effect<BuildOutput, Failure, Requirements>,
) =>
  Effect.gen(function* () {
    const { buildContext, app } = prepared;
    if (buildContext.dryRun) return yield* build();
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    yield* beginBuildLog(
      buildLogId({
        appName: app.name,
        version: appVersion,
        buildNumber,
        platform: buildContext.platform,
      }),
    );
    return yield* build().pipe(Effect.ensuring(endBuildLog()));
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
    let appVersion = app.version;
    if (appVersion === undefined) appVersion = '0.0.0';
    const artifact: BuildArtifact = {
      path: artifactPath,
      platform: buildContext.platform,
      appName: app.name,
      profile: profile.name,
      version: appVersion,
      buildNumber,
      sizeReport,
      clean: cleanBuilt,
      createdAt: new Date().toISOString(),
    };
    const provider = yield* resolveStorageProvider(config);
    // Keep an in-repo `artifactDir` out of version control before the first binary lands - idempotent, and
    // a no-op for the global default or a cloud store. Guarantees "won't get committed" even if init was skipped.
    if (config.storage === 'local') {
      const artifactDirectory = yield* resolveArtifactDir(config.artifactDir);
      const ignored = yield* ensureArtifactDirIgnored(artifactDirectory);
      if (ignored.added) {
        let ignoredEntry = '';
        if (ignored.entry !== undefined) ignoredEntry = ignored.entry;
        yield* log.step('gitignore', `added ${ignoredEntry} (build artifacts stay out of git)`);
      }
    }
    const stored = yield* provider.put(artifact);
    yield* log.step('store', stored.location);
    // Retention: announce the policy under the store line, then sweep. `0` disables the auto-sweep; the
    // newest build per app+platform is always kept, so a promotable artifact never gets swept out from
    // under `launch release`. Only the local provider implements `prune` - cloud stores no-op here.
    const retentionDays = resolveRetentionDays(config);
    if (retentionDays > 0) {
      yield* log.tip(
        `kept ~${retentionDays} days, then auto-pruned to save space (launch builds prune)`,
      );
      if (provider.prune) {
        const swept = yield* provider.prune({ now: Date.now(), retentionDays });
        if (swept.pruned.length > 0) {
          let noun = 'builds';
          if (swept.pruned.length === 1) noun = 'build';
          yield* log.step(
            'prune',
            `removed ${swept.pruned.length} old ${noun} >${retentionDays}d - freed ${mb(swept.freedBytes)}`,
          );
        }
      }
    }
  });
/** The one-line notice when a build runs uncached. No fabricated multiplier - we have no measured baseline. */
const CCACHE_NOTICE =
  "ccache isn't installed - this build runs uncached. `launch doctor --fix` (or brew install ccache) speeds up repeat builds.";
/**
 * Before building, when ccache is missing, offer to install it inline (interactive only) so this build -
 * and every later one - is cached. Degrades to a one-line notice in CI / without Homebrew; once the offer
 * is declined it's remembered, so later builds show the notice but never re-prompt. Reuses doctor's
 * install+configure path via {@link ensureCcacheInstalled}, and never blocks or fails the build.
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
/** After an iOS build, surface a one-line ccache hit summary when ccache is present. Best-effort. */
export const reportCcacheStats = (log: Logger) =>
  Effect.gen(function* () {
    if (!(yield* checkCommandExists('ccache'))) return;
    const stats = yield* captureCommandOutput('ccache', ['-s']).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );
    if (stats !== null) {
      const hitLine = stats.split('\n').find((line) => /hit/i.test(line));
      if (hitLine) yield* log.step('cache', hitLine.trim(), 'ccache');
    }
  });
/** A required native project or target is missing for the selected build platform. */
export type NativeProjectFailure = Readonly<{
  readonly _tag: 'NativeProjectFailure';
  readonly platform: Platform;
  readonly message: string;
}>;
export const makeNativeProjectFailure = Data.tagged<NativeProjectFailure>('NativeProjectFailure');
/**
 * Ensure the Apple native Xcode project exists for the selected platform. iOS is generated by
 * Expo prebuild when absent (tvOS reuses the same `ios/` project - react-native-tvos targets it via the
 * build destination). macOS and visionOS have **no** prebuild generator, so a missing native project is a
 * hard, actionable gate: the user must commit one (react-native-macos / react-native-visionos) and re-run,
 * rather than have Launch silently prebuild an iOS-only project that can't archive their platform.
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
    // Only iOS (and tvOS, which shares ios/) is generated by Expo prebuild. macOS/visionOS need a committed
    // native project - prebuild does not emit their target, so fail loud with the fix instead of mis-building.
    if (platform !== 'ios' && platform !== 'tvos') {
      const targetHint = yield* nativeTargetHint(platform);
      return yield* Effect.fail(
        makeNativeProjectFailure({
          platform,
          message: `${platformLabel(platform)} native target not configured - Expo prebuild does not emit a ${platformLabel(platform)} target. Commit a native project (${targetHint}) at ${dirName}/, then re-run.`,
        }),
      );
    }
    // tvOS reuses ios/; if even that is missing, prebuild generates an iOS project but no tvOS target, so the
    // archive will fail later. Gate it here with the same actionable message rather than mis-building.
    if (platform === 'tvos') {
      return yield* Effect.fail(
        makeNativeProjectFailure({
          platform,
          message:
            'tvOS native target not configured - no ios/ project found. Commit a react-native-tvos project (its tvOS target lives in ios/), then re-run `launch build tvos`.',
        }),
      );
    }
    if (buildContext.dryRun) {
      yield* log.step(
        'prebuild',
        'would run `expo prebuild --platform ios` (no ios/ found)',
        'prebuild',
      );
      return;
    }
    yield* runWithProgress('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], {
      label: 'Generating ios/ (expo prebuild)',
      cwd: buildContext.app.dir,
      env: buildContext.env,
    });
    yield* log.step('prebuild', 'ios/ generated from app.json', 'prebuild');
  });
/** Run `expo prebuild` only when there's no native `android/` yet; otherwise use what's committed. */
export const ensureAndroidProject = (buildContext: ResolvedBuildContext, log: Logger) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const androidDir = pathService.join(buildContext.app.dir, 'android');
    if (yield* fileSystem.exists(androidDir)) {
      yield* log.step('native project', 'using existing android/ (no prebuild needed)', 'prebuild');
      return;
    }
    if (buildContext.dryRun) {
      yield* log.step(
        'prebuild',
        'would run `expo prebuild --platform android` (no android/ found)',
        'prebuild',
      );
      return;
    }
    yield* runWithProgress('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], {
      label: 'Generating android/ (expo prebuild)',
      cwd: buildContext.app.dir,
      env: buildContext.env,
    });
    yield* log.step('prebuild', 'android/ generated from app.json', 'prebuild');
  });
/**
 * Poll the uploaded build's processing state briefly under a spinner, so the run ends with a clear
 * status instead of dead air between polls. Safe to Ctrl-C - Apple keeps processing regardless.
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
    const state = yield* withSpinner(
      "Processing on Apple's side (safe to Ctrl-C; it keeps processing)",
      () =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 6; attempt++) {
            yield* Effect.sleep('10 seconds');
            const processingState = yield* appStoreClient
              .getBuildProcessingState(bundleId, buildNumber)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (processingState && processingState !== 'PROCESSING') return processingState;
          }
          return null;
        }),
    );
    if (state !== null) {
      let processingDescription = `state: ${state}`;
      if (state === 'VALID') processingDescription = 'ready to test on TestFlight';
      yield* log.step('processing', processingDescription);
    } else {
      yield* log.note("Still processing - it'll appear in TestFlight shortly.");
    }
  });
/** Worst-case store download across device variants, or the on-disk size when no per-device report exists. */
export const worstDownloadBytes = (report: SizeReport): number => {
  if (report.entries.length === 0) return report.artifactBytes;
  return report.entries.reduce((max, entry) => Math.max(max, entry.downloadBytes), 0);
};
/**
 * The canonical size string wherever a size headline appears (the upload confirm and the receipt):
 * both numbers, no hierarchy. Falls back to on-disk alone when the build produced no per-device
 * estimate, so the line never claims a download figure it doesn't have. `wrap` decorates each size
 * value - the receipt passes {@link Logger.chip} to pill the numbers - and defaults to identity so
 * existing plain callers are unchanged.
 */
export const sizeSummary = (
  report: SizeReport,
  wrap: (size: string) => string = (size) => size,
): string => {
  if (report.entries.length === 0)
    return `on disk ${wrap(mb(report.artifactBytes))} (no per-device estimate)`;
  return `download ${wrap(mb(worstDownloadBytes(report)))} - on disk ${wrap(mb(report.artifactBytes))}`;
};
/** A build whose worst-case download grows beyond this fraction over the previous one earns a warning. */
const GROWTH_WARN_RATIO = 0.1;
/**
 * The size lines for the pre-upload checkpoint, with an optional delta against the previous build.
 * Returns the display lines (download + on-disk, or on-disk alone when there's no per-device estimate)
 * plus, when the worst-case download grew past {@link GROWTH_WARN_RATIO}, the growth to warn about - so
 * the caller renders the line and the warning consistently. Pure (no I/O) for direct unit testing.
 */
export const uploadSizeReadout = (
  report: SizeReport,
  previous?: {
    downloadBytes: number;
    buildNumber: number;
  },
): {
  lines: string[];
  grew: {
    pct: number;
    buildNumber: number;
  } | null;
} => {
  if (report.entries.length === 0) {
    return { lines: [`on disk ${mb(report.artifactBytes)} (no per-device estimate)`], grew: null };
  }
  const worst = worstDownloadBytes(report);
  let downloadLine = `download ${mb(worst)}`;
  let grew: {
    pct: number;
    buildNumber: number;
  } | null = null;
  if (previous && previous.downloadBytes > 0) {
    const delta = worst - previous.downloadBytes;
    const ratio = delta / previous.downloadBytes;
    let deltaSign = '-';
    if (delta >= 0) deltaSign = '+';
    downloadLine += ` (${deltaSign}${mb(Math.abs(delta))} since build ${previous.buildNumber})`;
    if (ratio > GROWTH_WARN_RATIO)
      grew = { pct: Math.round(ratio * 100), buildNumber: previous.buildNumber };
  }
  return { lines: [downloadLine, `on disk ${mb(report.artifactBytes)}`], grew };
};
/**
 * The most recent prior stored build for this app+platform - the baseline for the upload-time size
 * delta. Reads the newest-first artifact index and skips the build we just stored (matched by build
 * number) so the delta compares against the previous upload, not itself. Undefined on the first build.
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
    const history = yield* storageProvider.list();
    const prior = history.find(
      (artifact) =>
        artifact.appName === app.name &&
        artifact.platform === platform &&
        artifact.buildNumber !== currentBuildNumber,
    );
    if (prior === undefined) return undefined;
    return {
      downloadBytes: worstDownloadBytes(prior.sizeReport),
      buildNumber: prior.buildNumber,
    };
  });
/**
 * Print the per-device size readout for a freshly built artifact (iOS thinning / Android bundletool),
 * or a single on-disk line when there's no per-device report. Display only - the budget decision lives
 * in {@link confirmUpload}, so this runs on every build, including `--no-submit`. `sizeTopic` selects
 * the matching `--explain` block.
 */
export const reportSize = (
  report: SizeReport,
  log: Logger,
  sizeTopic: GlossaryTopic = 'app-thinning',
) =>
  Effect.gen(function* () {
    if (report.entries.length === 0) {
      yield* log.step(
        'size',
        `${log.chip(mb(report.artifactBytes))} on disk (no per-device report)`,
        sizeTopic,
      );
      return;
    }
    for (const entry of report.entries) {
      let installSuffix = '';
      if (entry.installBytes > 0) installSuffix = ` - install ${mb(entry.installBytes)}`;
      yield* log.step(
        'size',
        `${entry.device}: download ${log.chip(mb(entry.downloadBytes))}${installSuffix}`,
        sizeTopic,
      );
    }
  });
/**
 * The single pre-upload checkpoint, at the real upload boundary. It always surfaces what's about to
 * ship - app, build number, and the both-numbers size - and, when the worst-case download exceeds the
 * budget, leads with a warning (this is where the old size gate now lives). In an interactive terminal
 * it asks to continue; in CI / a pipe / under `--yes` it never blocks on stdin - it proceeds, but
 * still logs the over-budget warning so the record shows it.
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
    if (grew) {
      yield* log.warn(`Grew ${grew.pct}% since build ${grew.buildNumber}.`);
    }
    if (overBudget) {
      yield* log.warn(
        `Worst-case download ${mb(worstDownloadBytes(report))} is over the ${budgetMB} MB budget.`,
      );
    }
    if (yes) {
      if (overBudget) yield* log.note('Proceeding anyway (non-interactive or --yes).');
      return;
    }
    const canPrompt = yield* checkTerminalIsInteractive;
    if (!canPrompt) {
      if (overBudget) yield* log.note('Proceeding anyway (non-interactive or --yes).');
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
/** The receipt's destination line: where the build actually went (or that it wasn't uploaded). */
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
 * Best-effort deep link to the uploaded build in App Store Connect: a real per-app TestFlight/overview
 * URL when the app id resolves, else the console home. Never throws - a link is a nicety, not a gate.
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
 * The end-of-run "Shipped" receipt: one scannable summary of what landed where - app/version/build,
 * the both-numbers size, the destination, and a console link, with the headline values (app, version,
 * size) pilled via {@link Logger.chip}. A sailing pixel boat crowns the box on a TTY; plain lines in CI
 * (see {@link Logger.shipped}). Async because the boat animates.
 */
export const renderReceipt = (options: ReceiptOptions) =>
  Effect.gen(function* () {
    const { app, version, buildNumber, report, destination, link, log } = options;
    const rows = [
      `${log.chip(app.name)} ${log.chip(version)} (${buildNumber})`,
      sizeSummary(report, (size) => log.chip(size)),
      destination,
    ];
    if (link) rows.push(link);
    yield* log.shipped(rows);
  });
