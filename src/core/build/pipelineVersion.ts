/**
 * Marketing version and build-number / versionCode resolution for the build spines.
 */

import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cancel, isCancel, select, text } from '@clack/prompts';
import type { AppDescriptor, AppleCredentials, Platform } from '../types/index.js';
import { writeAppVersion } from '../config/config.js';
import {
  compareVersions,
  formatVersion,
  highestVersion,
  nextVersion,
  parseVersion,
  type BumpKind,
} from '../release/version.js';
import { readLastBump } from '../distribution/lastRun.js';
import type { Logger } from '../services/logger.js';
import { run } from '../services/exec.js';
import { isInteractive, withSpinner } from '../services/progress.js';
import { nativeProjectDirName } from '../services/platform.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { GooglePlayClient, parseServiceAccount } from '../../google/playClient.js';
import type { BuildRunOptions, BumpResolution } from './pipelineTypes.js';
import process from 'node:process';

/**
 * Stamp a single key into the build platform's generated `Info.plist`. Stamping the plist directly —
 * rather than only writing `app.json` — is what makes a version/build choice take effect even when the
 * native project is committed (so prebuild, which would otherwise read `app.json`, never runs). The
 * native directory is the platform's ({@link nativeProjectDirName}: `ios/` for iOS & tvOS, `macos/`,
 * `visionos/`). Returns whether a target Info.plist was found.
 */
export async function setNativePlistValue(
  appDir: string,
  platform: Platform,
  key: string,
  value: string | number,
): Promise<boolean> {
  const nativeDir = join(appDir, nativeProjectDirName(platform));
  if (!existsSync(nativeDir)) return false;
  const targetDir = readdirSync(nativeDir).find((entry) =>
    existsSync(join(nativeDir, entry, 'Info.plist')),
  );
  if (!targetDir) return false;
  await run('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :${key} ${value}`,
    join(nativeDir, targetDir, 'Info.plist'),
  ]);
  return true;
}

/** Set the build number (`CFBundleVersion`) into the platform's generated Info.plist. */
export function setIosBuildNumber(
  appDir: string,
  platform: Platform,
  buildNumber: number,
): Promise<boolean> {
  return setNativePlistValue(appDir, platform, 'CFBundleVersion', buildNumber);
}

/** Set the marketing version (`CFBundleShortVersionString`) into the platform's generated Info.plist. */
export function setIosMarketingVersion(
  appDir: string,
  platform: Platform,
  version: string,
): Promise<boolean> {
  return setNativePlistValue(appDir, platform, 'CFBundleShortVersionString', version);
}

/** Resolve the next build number from App Store Connect, or a placeholder in dry-run. */
export async function nextBuildNumber(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || !bundleId) return 1;
  const asc = new AppStoreConnectClient(ascKey);
  return (await asc.getLatestBuildNumber(bundleId)) + 1;
}

/**
 * How the marketing-version bump gets chosen for one run. `apply` carries the resolved {@link BumpKind}
 * and where it came from; `prompt` runs the interactive picker; `leave` keeps the app-config version as-is.
 */
/**
 * Decide how to pick the version bump, by precedence: an explicit `--bump` kind wins and applies even
 * non-interactively (so the version is scriptable in CI); otherwise, when we can prompt, `--bump ask`
 * forces the picker, a remembered pick auto-applies, and a first run prompts; when we can't prompt and
 * no flag was given, the app-config version is left untouched. Pure → testable with no store round-trip.
 */
export function resolveBumpKind(args: {
  flag: BumpKind | 'ask' | undefined;
  remembered: BumpKind | undefined;
  canPrompt: boolean;
}): BumpResolution {
  if (args.flag && args.flag !== 'ask') return { mode: 'apply', kind: args.flag, source: 'flag' };
  if (!args.canPrompt) return { mode: 'leave' };
  if (args.flag === 'ask') return { mode: 'prompt' };
  if (args.remembered) return { mode: 'apply', kind: args.remembered, source: 'remembered' };
  return { mode: 'prompt' };
}

/**
 * The interactive version picker: patch/minor/major above the baseline, keep the current, or type a
 * custom one. Returns the resolved version and its {@link BumpKind} — `undefined` for a typed "Custom…"
 * version, which has no kind and so is never remembered. Cancelling (Ctrl-C) exits cleanly.
 */
export async function promptVersion(
  baseline: string,
  current: string,
  latest: string | null,
): Promise<{ chosen: string; kind: BumpKind | undefined }> {
  const patch = nextVersion(baseline, 'patch');
  const minor = nextVersion(baseline, 'minor');
  const major = nextVersion(baseline, 'major');
  const choice = await select<BumpKind | 'custom'>({
    message: latest
      ? `App Store Connect's latest is ${latest}. Which version ships next?`
      : 'No versions on App Store Connect yet. Which version ships?',
    initialValue: latest ? 'patch' : 'keep',
    options: [
      { value: 'patch', label: `Patch  → ${patch}`, hint: 'bug fixes' },
      { value: 'minor', label: `Minor  → ${minor}`, hint: 'new features' },
      { value: 'major', label: `Major  → ${major}`, hint: 'breaking changes' },
      { value: 'keep', label: `Keep   → ${current}`, hint: 'reuse the app config version' },
      { value: 'custom', label: 'Custom…', hint: 'type a version' },
    ],
  });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  if (choice === 'custom') {
    const typed = await text({
      message: 'Version (MAJOR.MINOR.PATCH):',
      initialValue: patch,
      validate: (value) => (value && parseVersion(value) ? undefined : 'Use a version like 1.2.3.'),
    });
    if (isCancel(typed)) {
      cancel('Cancelled.');
      process.exit(0);
    }
    const parsed = parseVersion(typed);
    return { chosen: parsed ? formatVersion(parsed) : typed.trim(), kind: undefined };
  }
  if (choice === 'keep') return { chosen: current, kind: 'keep' };
  return { chosen: nextVersion(baseline, choice), kind: choice };
}

/**
 * Stamp the resolved version into Info.plist + a static app.json, mirror it onto `app.version` so every
 * later step reports it, warn when it doesn't increment the store's latest, and log the step. `note`
 * explains the source (e.g. `patch, remembered`) so the line is self-documenting.
 */
export async function applyChosenVersion(
  app: AppDescriptor,
  platform: Platform,
  chosen: string,
  latest: string | null,
  note: string,
  log: Logger,
): Promise<void> {
  if (latest && compareVersions(chosen, latest) <= 0) {
    log.warn(
      `${chosen} doesn't increment the store's ${latest} — fine for another TestFlight build, but the App Store rejects a release that reuses a version.`,
    );
  }
  const stamped = await setIosMarketingVersion(app.dir, platform, chosen);
  const persisted = writeAppVersion(app, chosen);
  app.version = chosen;
  const notes = [persisted ? 'app config updated' : 'app config not written (dynamic config)'];
  if (!stamped) notes.push('Info.plist not stamped');
  log.step('version', `${log.chip(chosen)} (${note}; ${notes.join('; ')})`, 'marketing-version');
}

/**
 * Resolve — and apply — the app's marketing version before the build. By precedence (see
 * {@link resolveBumpKind}): an explicit `--bump`, a remembered pick (auto-applied, no prompt), the
 * interactive picker, or — under `--yes`/CI with no flag — the app-config version untouched. The chosen
 * version is computed above the store's latest (App Store + TestFlight) and the app's own version, then
 * stamped into Info.plist + app config and mirrored onto `app.version` so every later step reports it.
 * Returns the {@link BumpKind} applied (for remembering on success), or `undefined` when nothing was
 * applied or a one-off Custom version was typed.
 */
export async function resolveMarketingVersion(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  app: AppDescriptor,
  platform: Platform,
  options: BuildRunOptions,
  log: Logger,
): Promise<BumpKind | undefined> {
  const current = app.version ?? '0.0.0';

  if (options.dryRun) {
    log.step(
      'version',
      `would suggest the next version above the store's latest (config has ${current})`,
      'marketing-version',
    );
    return;
  }

  const decision = resolveBumpKind({
    flag: options.bump,
    remembered: readLastBump(app.name),
    canPrompt: isInteractive() && options.yes !== true,
  });
  if (decision.mode === 'leave') {
    log.step(
      'version',
      `${current} (from app config; not prompting under --yes / non-interactive)`,
      'marketing-version',
    );
    return;
  }

  const latest = bundleId
    ? await withSpinner('Checking versions already on App Store Connect', () =>
        new AppStoreConnectClient(ascKey).getLatestMarketingVersion(bundleId),
      )
    : null;
  // Never propose at or below what's already on the store or what the app config already declares.
  const baseline =
    highestVersion([latest, current].filter((v): v is string => v !== null)) ?? current;

  if (decision.mode === 'prompt') {
    const { chosen, kind } = await promptVersion(baseline, current, latest);
    await applyChosenVersion(app, platform, chosen, latest, kind ?? 'custom', log);
    return kind;
  }

  // apply (flag or remembered): compute the version from the kind.
  const chosen = decision.kind === 'keep' ? current : nextVersion(baseline, decision.kind);
  const source = decision.source === 'flag' ? '--bump' : 'remembered';
  await applyChosenVersion(app, platform, chosen, latest, `${decision.kind}, ${source}`, log);
  return decision.kind;
}

/**
 * Resolve the next Android `versionCode`: one above the highest of Google Play's latest and the
 * `app.json` floor, or a placeholder in dry-run. The Android twin of {@link nextBuildNumber} — the
 * store stays the source of truth, but an intentional local bump (the floor) is never clobbered.
 */
export async function nextVersionCode(
  serviceAccountJson: string,
  packageName: string,
  floor: number,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || !packageName || !serviceAccountJson) return Math.max(floor, 0) + 1;
  const play = new GooglePlayClient(parseServiceAccount(serviceAccountJson));
  const latest = await play.getLatestVersionCode(packageName);
  return Math.max(latest, floor) + 1;
}

/**
 * Stamp the bumped `versionCode` into the generated `android/app/build.gradle`. A line-edit (no
 * PlistBuddy analog on Android); returns whether a `versionCode <n>` line was found and updated.
 */
export function setAndroidVersionCode(appDir: string, versionCode: number): boolean {
  const gradlePath = join(appDir, 'android', 'app', 'build.gradle');
  if (!existsSync(gradlePath)) return false;
  const original = readFileSync(gradlePath, 'utf8');
  const updated = original.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  if (updated === original) return false;
  writeFileSync(gradlePath, updated);
  return true;
}
