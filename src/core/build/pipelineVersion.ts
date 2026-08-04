import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { AppleCredentials } from '../types/credentials.js';
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
import { executeCommand, provideNodeCommandServices } from '../services/exec.js';
import { checkTerminalIsInteractive, withSpinner } from '../services/progress.js';
import { nativeProjectDirName } from '../services/platform.js';
import { AppleStoreClientService } from '../services/appleStoreClient.js';
import { GoogleStoreClientService } from '../services/googleStoreClient.js';
import { LaunchPrompt } from '../services/prompt.js';
import type { BuildRunOptions, BumpResolution } from './pipelineTypes.js';
import type { MutableDeep } from '../types/mutable.js';

export type BuildVersionFailure = Readonly<{
  readonly _tag: 'BuildVersionFailure';
  readonly message: string;
}>;

export const makeBuildVersionFailure = Data.tagged<BuildVersionFailure>('BuildVersionFailure');

type PromptedVersion = Readonly<{
  readonly chosen: string;
  readonly kind: BumpKind | undefined;
}>;
/**
 * Stamp a single key into the build platform's generated `Info.plist`. Stamping the plist directly -
 * rather than only writing `app.json` - is what makes a version/build choice take effect even when the
 * native project is committed (so prebuild, which would otherwise read `app.json`, never runs). The
 * native directory is the platform's ({@link nativeProjectDirName}: `ios/` for iOS & tvOS, `macos/`,
 * `visionos/`). Returns whether a target Info.plist was found.
 */
export const setNativePlistValue = (
  appDir: string,
  platform: Platform,
  key: string,
  plistValue: string | number,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const nativeDirectory = pathService.join(appDir, yield* nativeProjectDirName(platform));
    if (!(yield* fileSystem.exists(nativeDirectory))) return false;
    const nativeEntries = yield* fileSystem.readDirectory(nativeDirectory);
    let targetDirectory: string | undefined;
    for (const nativeEntry of nativeEntries) {
      const plistPath = pathService.join(nativeDirectory, nativeEntry, 'Info.plist');
      if (yield* fileSystem.exists(plistPath)) {
        targetDirectory = nativeEntry;
        break;
      }
    }
    if (targetDirectory === undefined) return false;
    yield* provideNodeCommandServices(
      executeCommand('/usr/libexec/PlistBuddy', [
        '-c',
        `Set :${key} ${plistValue}`,
        pathService.join(nativeDirectory, targetDirectory, 'Info.plist'),
      ]),
    );
    return true;
  });
/** Set the build number (`CFBundleVersion`) into the platform's generated Info.plist. */
export const setIosBuildNumber = (appDir: string, platform: Platform, buildNumber: number) => {
  return setNativePlistValue(appDir, platform, 'CFBundleVersion', buildNumber);
};
/** Set the marketing version (`CFBundleShortVersionString`) into the platform's generated Info.plist. */
export const setIosMarketingVersion = (appDir: string, platform: Platform, version: string) => {
  return setNativePlistValue(appDir, platform, 'CFBundleShortVersionString', version);
};
/** Resolve the next build number from App Store Connect, or a placeholder in dry-run. */
export const nextBuildNumber = (
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  dryRun: boolean,
): Effect.Effect<number, unknown, AppleStoreClientService> =>
  Effect.gen(function* () {
    if (dryRun) return 1;
    if (!bundleId) return 1;
    const appleStoreClients = yield* AppleStoreClientService;
    const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
    const latestBuildNumber = yield* appStoreClient.getLatestBuildNumber(bundleId);
    return latestBuildNumber + 1;
  });
/**
 * How the marketing-version bump gets chosen for one run. `apply` carries the resolved {@link BumpKind}
 * and where it came from; `prompt` runs the interactive picker; `leave` keeps the app-config version as-is.
 */
/**
 * Decide how to pick the version bump, by precedence: an explicit `--bump` kind wins and applies even
 * non-interactively (so the version is scriptable in CI); otherwise, when we can prompt, `--bump ask`
 * forces the picker, a remembered pick auto-applies, and a first run prompts; when we can't prompt and
 * no flag was given, the app-config version is left untouched. Pure -> testable with no store round-trip.
 */
export const resolveBumpKind = (args: {
  flag: BumpKind | 'ask' | undefined;
  remembered: BumpKind | undefined;
  canPrompt: boolean;
}): BumpResolution => {
  if (args.flag && args.flag !== 'ask') return { mode: 'apply', kind: args.flag, source: 'flag' };
  if (!args.canPrompt) return { mode: 'leave' };
  if (args.flag === 'ask') return { mode: 'prompt' };
  if (args.remembered) return { mode: 'apply', kind: args.remembered, source: 'remembered' };
  return { mode: 'prompt' };
};
/**
 * The interactive version picker: patch/minor/major above the baseline, keep the current, or type a
 * custom one. Returns the resolved version and its {@link BumpKind} - `undefined` for a typed "Custom..."
 * version, which has no kind and so is never remembered. Cancelling (Ctrl-C) exits cleanly.
 */
export const promptVersion = (baseline: string, current: string, latest: string | null) =>
  Effect.gen(function* () {
    const launchPrompt = yield* LaunchPrompt;
    const patchVersion = nextVersion(baseline, 'patch');
    const minorVersion = nextVersion(baseline, 'minor');
    const majorVersion = nextVersion(baseline, 'major');
    let promptMessage = 'No versions on App Store Connect yet. Which version ships?';
    let initialSelection: BumpKind | 'custom' = 'keep';
    if (latest !== null) {
      promptMessage = `App Store Connect's latest is ${latest}. Which version ships next?`;
      initialSelection = 'patch';
    }
    const choice = yield* launchPrompt.select<BumpKind | 'custom'>({
      message: promptMessage,
      initialSelection,
      choices: [
        { selection: 'patch', label: `Patch  -> ${patchVersion}`, hint: 'bug fixes' },
        { selection: 'minor', label: `Minor  -> ${minorVersion}`, hint: 'new features' },
        { selection: 'major', label: `Major  -> ${majorVersion}`, hint: 'breaking changes' },
        {
          selection: 'keep',
          label: `Keep   -> ${current}`,
          hint: 'reuse the app config version',
        },
        { selection: 'custom', label: 'Custom...', hint: 'type a version' },
      ],
    });
    if (choice === 'custom') {
      const typedVersion = yield* launchPrompt.requiredText('Version (MAJOR.MINOR.PATCH):');
      const parsedVersion = parseVersion(typedVersion);
      if (parsedVersion === null) {
        return yield* Effect.fail(
          makeBuildVersionFailure({ message: 'Use a version like 1.2.3.' }),
        );
      }
      const customVersion: PromptedVersion = {
        chosen: formatVersion(parsedVersion),
        kind: undefined,
      };
      return customVersion;
    }
    if (choice === 'keep') {
      const currentVersion: PromptedVersion = { chosen: current, kind: 'keep' };
      return currentVersion;
    }
    const bumpedVersion: PromptedVersion = {
      chosen: nextVersion(baseline, choice),
      kind: choice,
    };
    return bumpedVersion;
  });
/**
 * Stamp the resolved version into Info.plist + a static app.json, mirror it onto `app.version` so every
 * later step reports it, warn when it doesn't increment the store's latest, and log the step. `note`
 * explains the source (e.g. `patch, remembered`) so the line is self-documenting.
 */
export const applyChosenVersion = (
  app: MutableDeep<AppDescriptor>,
  platform: Platform,
  chosen: string,
  latest: string | null,
  note: string,
  log: Logger,
) =>
  Effect.gen(function* () {
    if (latest && compareVersions(chosen, latest) <= 0) {
      yield* log.warn(
        `${chosen} doesn't increment the store's ${latest} - fine for another TestFlight build, but the App Store rejects a release that reuses a version.`,
      );
    }
    const stamped = yield* setIosMarketingVersion(app.dir, platform, chosen);
    const persisted = yield* writeAppVersion(app, chosen);
    app.version = chosen;
    let persistenceNote = 'app config not written (dynamic config)';
    if (persisted) persistenceNote = 'app config updated';
    const notes = [persistenceNote];
    if (!stamped) notes.push('Info.plist not stamped');
    yield* log.step(
      'version',
      `${log.chip(chosen)} (${note}; ${notes.join('; ')})`,
      'marketing-version',
    );
  });
/**
 * Resolve - and apply - the app's marketing version before the build. By precedence (see
 * {@link resolveBumpKind}): an explicit `--bump`, a remembered pick (auto-applied, no prompt), the
 * interactive picker, or - under `--yes`/CI with no flag - the app-config version untouched. The chosen
 * version is computed above the store's latest (App Store + TestFlight) and the app's own version, then
 * stamped into Info.plist + app config and mirrored onto `app.version` so every later step reports it.
 * Returns the {@link BumpKind} applied (for remembering on success), or `undefined` when nothing was
 * applied or a one-off Custom version was typed.
 */
export const resolveMarketingVersion = (
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  app: MutableDeep<AppDescriptor>,
  platform: Platform,
  options: BuildRunOptions,
  log: Logger,
) =>
  Effect.gen(function* () {
    let currentVersion = app.version;
    if (currentVersion === undefined) currentVersion = '0.0.0';
    if (options.dryRun) {
      log.step(
        'version',
        `would suggest the next version above the store's latest (config has ${currentVersion})`,
        'marketing-version',
      );
      return;
    }
    const rememberedBump = yield* readLastBump(app.name);
    const terminalIsInteractive = yield* checkTerminalIsInteractive;
    const decision = resolveBumpKind({
      flag: options.bump,
      remembered: rememberedBump,
      canPrompt: terminalIsInteractive && options.yes !== true,
    });
    if (decision.mode === 'leave') {
      log.step(
        'version',
        `${currentVersion} (from app config; not prompting under --yes / non-interactive)`,
        'marketing-version',
      );
      return;
    }
    let latest: string | null = null;
    if (bundleId) {
      const appleStoreClients = yield* AppleStoreClientService;
      const appStoreClient = yield* appleStoreClients.createEffectClient(ascKey);
      latest = yield* withSpinner('Checking versions already on App Store Connect', () =>
        appStoreClient.getLatestMarketingVersion(bundleId),
      );
    }
    // Never propose at or below what's already on the store or what the app config already declares.
    let versionBaseline = highestVersion(
      [latest, currentVersion].filter((version): version is string => version !== null),
    );
    if (versionBaseline === null) versionBaseline = currentVersion;
    if (decision.mode === 'prompt') {
      const { chosen, kind } = yield* promptVersion(versionBaseline, currentVersion, latest);
      let versionChoiceLabel = 'custom';
      if (kind !== undefined) versionChoiceLabel = kind;
      yield* applyChosenVersion(app, platform, chosen, latest, versionChoiceLabel, log);
      return kind;
    }
    // apply (flag or remembered): compute the version from the kind.
    let chosen = currentVersion;
    if (decision.kind !== 'keep') chosen = nextVersion(versionBaseline, decision.kind);
    let source = 'remembered';
    if (decision.source === 'flag') source = '--bump';
    yield* applyChosenVersion(app, platform, chosen, latest, `${decision.kind}, ${source}`, log);
    return decision.kind;
  });
/**
 * Resolve the next Android `versionCode`: one above the highest of Google Play's latest and the
 * `app.json` floor, or a placeholder in dry-run. The Android twin of {@link nextBuildNumber} - the
 * store stays the source of truth, but an intentional local bump (the floor) is never clobbered.
 */
export const nextVersionCode = (
  serviceAccountJson: string,
  packageName: string,
  floor: number,
  dryRun: boolean,
): Effect.Effect<number, unknown, GoogleStoreClientService> =>
  Effect.gen(function* () {
    if (dryRun) return Math.max(floor, 0) + 1;
    if (!serviceAccountJson) return Math.max(floor, 0) + 1;
    const googleStoreClients = yield* GoogleStoreClientService;
    const playStoreClient = yield* googleStoreClients.createEffectClient(serviceAccountJson);
    const latest = yield* playStoreClient.getLatestVersionCode(packageName);
    return Math.max(latest, floor) + 1;
  });
/**
 * Stamp the bumped `versionCode` into the generated `android/app/build.gradle`. A line-edit (no
 * PlistBuddy analog on Android); returns whether a `versionCode <n>` line was found and updated.
 */
export const setAndroidVersionCode = (appDir: string, versionCode: number) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const gradlePath = pathService.join(appDir, 'android', 'app', 'build.gradle');
    if (!(yield* fileSystem.exists(gradlePath))) return false;
    const originalGradle = yield* fileSystem.readFileString(gradlePath);
    const updatedGradle = originalGradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
    if (updatedGradle === originalGradle) return false;
    yield* fileSystem.writeFileString(gradlePath, updatedGradle);
    return true;
  });
