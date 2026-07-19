/**
 * Shared post-compile pipeline phases: build-log wrap, size readout, artifact store, upload gate, receipt.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { cancel, confirm, isCancel } from '@clack/prompts';
import type {
  AppDescriptor,
  AppleCredentials,
  BuildArtifact,
  LaunchConfig,
  Platform,
  PlayTrack,
  ResolvedBuildContext,
  SizeReport,
  SubmitTarget,
} from '../types/index.js';
import { ccacheOfferDeclined, markCcacheOfferDeclined } from '../config/firstRun.js';
import { ensureCcacheInstalled } from '../config/toolchain.js';
import { beginBuildLog, buildLogId, endBuildLog } from './buildLog.js';
import { resolveArtifactDir, resolveStorageProvider } from '../distribution/storage.js';
import { ensureArtifactDirIgnored } from '../config/gitignore.js';
import { resolveRetentionDays } from './artifactRetention.js';
import type { Logger } from '../services/logger.js';
import type { GlossaryTopic } from '../terminal/glossary.js';
import { capture, exists } from '../services/exec.js';
import { buildConsoleUrl } from '../terminal/consoleLinks.js';
import { nativeProjectDirName, nativeTargetHint, platformLabel } from '../services/platform.js';
import { isInteractive, runWithProgress, withSpinner } from '../services/progress.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import type {
  BuildOutput,
  BuildRunOptions,
  ConfirmUploadOptions,
  PreparedBuild,
  ReceiptOptions,
} from './pipelineTypes.js';
import { mb } from './pipelineProviders.js';
import process from 'node:process';

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Wrap the build-engine call so its native output is captured to a per-build log keyed by build id
 * (read back by `launch builds log` and the failure diagnostics). Skipped in dry-run — no real build
 * runs. Completion notifications fire separately at the dispatch boundary (see {@link runBuild}), so
 * this stays a single concern: own the log's lifecycle around the compile, nothing more.
 */
export async function runBuildStep(
  prepared: PreparedBuild,
  buildNumber: number,
  build: () => Promise<BuildOutput>,
): Promise<BuildOutput> {
  const { ctx, app } = prepared;
  if (ctx.dryRun) return build();
  beginBuildLog(
    buildLogId({
      appName: app.name,
      version: app.version ?? '0.0.0',
      buildNumber,
      platform: ctx.platform,
    }),
  );
  try {
    return await build();
  } finally {
    endBuildLog();
  }
}

/** Store the built artifact (skipped in dry-run) and log its location. Shared by both platform spines. */
export async function storeArtifact(
  prepared: PreparedBuild,
  artifactPath: string,
  buildNumber: number,
  sizeReport: SizeReport,
  cleanBuilt: boolean,
): Promise<void> {
  const { config, app, profile, ctx, log } = prepared;
  if (ctx.dryRun) {
    log.step('store', 'skipped (dry-run)');
    return;
  }
  const artifact: BuildArtifact = {
    path: artifactPath,
    platform: ctx.platform,
    appName: app.name,
    profile: profile.name,
    version: app.version ?? '0.0.0',
    buildNumber,
    sizeReport,
    clean: cleanBuilt,
    createdAt: new Date().toISOString(),
  };
  const provider = resolveStorageProvider(config);
  // Keep an in-repo `artifactDir` out of version control before the first binary lands — idempotent, and
  // a no-op for the global default or a cloud store. Guarantees "won't get committed" even if init was skipped.
  if (config.storage === 'local') {
    const ignored = await ensureArtifactDirIgnored(resolveArtifactDir(config.artifactDir));
    if (ignored.added)
      log.step('gitignore', `added ${ignored.entry ?? ''} (build artifacts stay out of git)`);
  }
  const stored = await provider.put(artifact);
  log.step('store', stored.location);

  // Retention: announce the policy under the store line, then sweep. `0` disables the auto-sweep; the
  // newest build per app+platform is always kept, so a promotable artifact never gets swept out from
  // under `launch release`. Only the local provider implements `prune` — cloud stores no-op here.
  const retentionDays = resolveRetentionDays(config);
  if (retentionDays > 0) {
    log.tip(`kept ~${retentionDays} days, then auto-pruned to save space (launch builds prune)`);
    if (provider.prune) {
      const swept = await provider.prune({ now: Date.now(), retentionDays });
      if (swept.pruned.length > 0) {
        const noun = swept.pruned.length === 1 ? 'build' : 'builds';
        log.step(
          'prune',
          `removed ${swept.pruned.length} old ${noun} >${retentionDays}d · freed ${mb(swept.freedBytes)}`,
        );
      }
    }
  }
}

/** The one-line notice when a build runs uncached. No fabricated multiplier — we have no measured baseline. */
const CCACHE_NOTICE =
  "ccache isn't installed — this build runs uncached. `launch doctor --fix` (or brew install ccache) speeds up repeat builds.";

/**
 * Before building, when ccache is missing, offer to install it inline (interactive only) so this build —
 * and every later one — is cached. Degrades to a one-line notice in CI / without Homebrew; once the offer
 * is declined it's remembered, so later builds show the notice but never re-prompt. Reuses doctor's
 * install+configure path via {@link ensureCcacheInstalled}, and never blocks or fails the build.
 */
export async function nudgeIfNoCcache(log: Logger): Promise<void> {
  if (await exists('ccache')) return;
  if (ccacheOfferDeclined()) {
    log.warn(CCACHE_NOTICE);
    return;
  }
  switch (await ensureCcacheInstalled({ interactive: isInteractive() })) {
    case 'installed':
      log.step('ccache', 'installed + configured — this build is now cached', 'ccache');
      return;
    case 'declined':
      markCcacheOfferDeclined();
      log.warn(CCACHE_NOTICE);
      return;
    case 'skipped-no-brew':
    case 'skipped-noninteractive':
      log.warn(CCACHE_NOTICE);
      return;
  }
}

/** After an iOS build, surface a one-line ccache hit summary when ccache is present. Best-effort. */
export async function reportCcacheStats(log: Logger): Promise<void> {
  if (!(await exists('ccache'))) return;
  try {
    const stats = await capture('ccache', ['-s']);
    const hitLine = stats.split('\n').find((line) => /hit/i.test(line));
    if (hitLine) log.step('cache', hitLine.trim(), 'ccache');
  } catch {
    /* ccache -s unavailable — skip the summary */
  }
}

/**
 * Ensure the Apple native Xcode project exists for `ctx.platform` before the build. iOS is generated by
 * Expo prebuild when absent (tvOS reuses the same `ios/` project — react-native-tvos targets it via the
 * build destination). macOS and visionOS have **no** prebuild generator, so a missing native project is a
 * hard, actionable gate: the user must commit one (react-native-macos / react-native-visionos) and re-run,
 * rather than have Launch silently prebuild an iOS-only project that can't archive their platform.
 */
export async function ensureNativeProject(ctx: ResolvedBuildContext, log: Logger): Promise<void> {
  const platform = ctx.platform;
  const dirName = nativeProjectDirName(platform);
  const nativeDir = join(ctx.app.dir, dirName);
  if (existsSync(nativeDir)) {
    log.step('native project', `using existing ${dirName}/ (no prebuild needed)`, 'prebuild');
    return;
  }
  // Only iOS (and tvOS, which shares ios/) is generated by Expo prebuild. macOS/visionOS need a committed
  // native project — prebuild does not emit their target, so fail loud with the fix instead of mis-building.
  if (platform !== 'ios' && platform !== 'tvos') {
    throw new Error(
      `${platformLabel(platform)} native target not configured — Expo prebuild does not emit a ${platformLabel(platform)} ` +
        `target. Commit a native project (${nativeTargetHint(platform)}) at ${dirName}/, then re-run.`,
    );
  }
  // tvOS reuses ios/; if even that is missing, prebuild generates an iOS project but no tvOS target, so the
  // archive will fail later. Gate it here with the same actionable message rather than mis-building.
  if (platform === 'tvos') {
    throw new Error(
      'tvOS native target not configured — no ios/ project found. Commit a react-native-tvos project (its ' +
        'tvOS target lives in ios/), then re-run `launch build tvos`.',
    );
  }
  if (ctx.dryRun) {
    log.step('prebuild', 'would run `expo prebuild --platform ios` (no ios/ found)', 'prebuild');
    return;
  }
  await runWithProgress('npx', ['expo', 'prebuild', '--platform', 'ios', '--clean'], {
    label: 'Generating ios/ (expo prebuild)',
    cwd: ctx.app.dir,
    env: ctx.env,
  });
  log.step('prebuild', 'ios/ generated from app.json', 'prebuild');
}

/** Run `expo prebuild` only when there's no native `android/` yet; otherwise use what's committed. */
export async function ensureAndroidProject(ctx: ResolvedBuildContext, log: Logger): Promise<void> {
  const androidDir = join(ctx.app.dir, 'android');
  if (existsSync(androidDir)) {
    log.step('native project', 'using existing android/ (no prebuild needed)', 'prebuild');
    return;
  }
  if (ctx.dryRun) {
    log.step(
      'prebuild',
      'would run `expo prebuild --platform android` (no android/ found)',
      'prebuild',
    );
    return;
  }
  await runWithProgress('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], {
    label: 'Generating android/ (expo prebuild)',
    cwd: ctx.app.dir,
    env: ctx.env,
  });
  log.step('prebuild', 'android/ generated from app.json', 'prebuild');
}

/**
 * Poll the uploaded build's processing state briefly under a spinner, so the run ends with a clear
 * status instead of dead air between polls. Safe to Ctrl-C — Apple keeps processing regardless.
 */
export async function reportProcessing(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  buildNumber: number,
  log: Logger,
): Promise<void> {
  const asc = new AppStoreConnectClient(ascKey);
  const state = await withSpinner(
    "Processing on Apple's side (safe to Ctrl-C; it keeps processing)",
    async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        // biome-ignore lint/performance/noAwaitInLoops: poll loop — each pass re-reads remote state after a fixed delay, so the iterations are inherently sequential
        await delay(10_000);
        try {
          const current = await asc.getBuildProcessingState(bundleId, buildNumber);
          if (current && current !== 'PROCESSING') return current;
        } catch {
          /* transient; keep polling */
        }
      }
      return null;
    },
  );
  if (state) {
    log.step('processing', state === 'VALID' ? 'ready to test on TestFlight' : `state: ${state}`);
  } else {
    log.info("Still processing — it'll appear in TestFlight shortly.");
  }
}

/** Worst-case store download across device variants, or the on-disk size when no per-device report exists. */
export function worstDownloadBytes(report: SizeReport): number {
  if (report.entries.length === 0) return report.artifactBytes;
  return report.entries.reduce((max, entry) => Math.max(max, entry.downloadBytes), 0);
}

/**
 * The canonical size string wherever a size headline appears (the upload confirm and the receipt):
 * both numbers, no hierarchy. Falls back to on-disk alone when the build produced no per-device
 * estimate, so the line never claims a download figure it doesn't have. `wrap` decorates each size
 * value — the receipt passes {@link Logger.chip} to pill the numbers — and defaults to identity so
 * existing plain callers are unchanged.
 */
export function sizeSummary(
  report: SizeReport,
  wrap: (size: string) => string = (size) => size,
): string {
  if (report.entries.length === 0)
    return `on disk ${wrap(mb(report.artifactBytes))} (no per-device estimate)`;
  return `download ${wrap(mb(worstDownloadBytes(report)))} · on disk ${wrap(mb(report.artifactBytes))}`;
}

/** A build whose worst-case download grows beyond this fraction over the previous one earns a warning. */
const GROWTH_WARN_RATIO = 0.1;

/**
 * The size lines for the pre-upload checkpoint, with an optional delta against the previous build.
 * Returns the display lines (download + on-disk, or on-disk alone when there's no per-device estimate)
 * plus, when the worst-case download grew past {@link GROWTH_WARN_RATIO}, the growth to warn about — so
 * the caller renders the line and the warning consistently. Pure (no I/O) for direct unit testing.
 */
export function uploadSizeReadout(
  report: SizeReport,
  previous?: { downloadBytes: number; buildNumber: number },
): { lines: string[]; grew: { pct: number; buildNumber: number } | null } {
  if (report.entries.length === 0) {
    return { lines: [`on disk ${mb(report.artifactBytes)} (no per-device estimate)`], grew: null };
  }
  const worst = worstDownloadBytes(report);
  let downloadLine = `download ${mb(worst)}`;
  let grew: { pct: number; buildNumber: number } | null = null;
  if (previous && previous.downloadBytes > 0) {
    const delta = worst - previous.downloadBytes;
    const ratio = delta / previous.downloadBytes;
    downloadLine += ` (${delta >= 0 ? '+' : '-'}${mb(Math.abs(delta))} since build ${previous.buildNumber})`;
    if (ratio > GROWTH_WARN_RATIO)
      grew = { pct: Math.round(ratio * 100), buildNumber: previous.buildNumber };
  }
  return { lines: [downloadLine, `on disk ${mb(report.artifactBytes)}`], grew };
}

/**
 * The most recent prior stored build for this app+platform — the baseline for the upload-time size
 * delta. Reads the newest-first artifact index and skips the build we just stored (matched by build
 * number) so the delta compares against the previous upload, not itself. Undefined on the first build.
 */
export async function previousBuild(
  config: LaunchConfig,
  app: AppDescriptor,
  platform: Platform,
  currentBuildNumber: number,
): Promise<{ downloadBytes: number; buildNumber: number } | undefined> {
  const history = await resolveStorageProvider(config).list();
  const prior = history.find(
    (artifact) =>
      artifact.appName === app.name &&
      artifact.platform === platform &&
      artifact.buildNumber !== currentBuildNumber,
  );
  return prior
    ? { downloadBytes: worstDownloadBytes(prior.sizeReport), buildNumber: prior.buildNumber }
    : undefined;
}

/**
 * Print the per-device size readout for a freshly built artifact (iOS thinning / Android bundletool),
 * or a single on-disk line when there's no per-device report. Display only — the budget decision lives
 * in {@link confirmUpload}, so this runs on every build, including `--no-submit`. `sizeTopic` selects
 * the matching `--explain` block.
 */
export function reportSize(
  report: SizeReport,
  log: Logger,
  sizeTopic: GlossaryTopic = 'app-thinning',
): void {
  if (report.entries.length === 0) {
    log.step(
      'size',
      `${log.chip(mb(report.artifactBytes))} on disk (no per-device report)`,
      sizeTopic,
    );
    return;
  }
  for (const entry of report.entries) {
    const installSuffix = entry.installBytes > 0 ? ` · install ${mb(entry.installBytes)}` : '';
    log.step(
      'size',
      `${entry.device}: download ${log.chip(mb(entry.downloadBytes))}${installSuffix}`,
      sizeTopic,
    );
  }
}

/**
 * The single pre-upload checkpoint, at the real upload boundary. It always surfaces what's about to
 * ship — app, build number, and the both-numbers size — and, when the worst-case download exceeds the
 * budget, leads with a warning (this is where the old size gate now lives). In an interactive terminal
 * it asks to continue; in CI / a pipe / under `--yes` it never blocks on stdin — it proceeds, but
 * still logs the over-budget warning so the record shows it.
 */
export async function confirmUpload(options: ConfirmUploadOptions): Promise<void> {
  const { report, budgetMB, destination, app, version, buildNumber, previous, yes, log } = options;
  const overBudget = worstDownloadBytes(report) > budgetMB * 1024 * 1024;
  const { lines, grew } = uploadSizeReadout(report, previous);

  log.notice(
    `⬆ Upload to ${destination}`,
    `${app.name} ${version} (build ${buildNumber})`,
    ...lines,
  );
  if (grew) {
    log.warn(`Grew ${grew.pct}% since build ${grew.buildNumber}.`);
  }
  if (overBudget) {
    log.warn(
      `Worst-case download ${mb(worstDownloadBytes(report))} is over the ${budgetMB} MB budget.`,
    );
  }

  if (yes || !isInteractive()) {
    if (overBudget) log.info('Proceeding anyway (non-interactive or --yes).');
    return;
  }
  const proceed = await confirm({ message: 'Continue?' });
  if (isCancel(proceed) || !proceed) {
    cancel(overBudget ? 'Stopped before upload (over size budget).' : 'Stopped before upload.');
    process.exit(0);
  }
}

/** The receipt's destination line: where the build actually went (or that it wasn't uploaded). */
export function receiptDestination(
  platform: Platform,
  options: BuildRunOptions,
  track?: PlayTrack,
): string {
  if (!options.submit) return 'built · not uploaded';
  if (platform === 'android') return `Play · ${track ?? 'internal'} track`;
  return options.target === 'testing' ? 'TestFlight' : 'App Store · in review';
}

/**
 * Best-effort deep link to the uploaded build in App Store Connect: a real per-app TestFlight/overview
 * URL when the app id resolves, else the console home. Never throws — a link is a nicety, not a gate.
 */
export async function resolveAscBuildLink(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  target: SubmitTarget,
): Promise<string> {
  const appId =
    (await new AppStoreConnectClient(ascKey).getAppId(bundleId).catch(() => null)) ?? undefined;
  return buildConsoleUrl(target === 'testing' ? 'testflight' : 'asc', 'ios', appId);
}

/**
 * The end-of-run "Shipped" receipt: one scannable summary of what landed where — app/version/build,
 * the both-numbers size, the destination, and a console link, with the headline values (app, version,
 * size) pilled via {@link Logger.chip}. A sailing pixel boat crowns the box on a TTY; plain lines in CI
 * (see {@link Logger.shipped}). Async because the boat animates.
 */
export async function renderReceipt(options: ReceiptOptions): Promise<void> {
  const { app, version, buildNumber, report, destination, link, log } = options;
  const rows = [
    `${log.chip(app.name)} ${log.chip(version)} (${buildNumber})`,
    sizeSummary(report, (size) => log.chip(size)),
    destination,
  ];
  if (link) rows.push(link);
  await log.shipped(rows);
}
