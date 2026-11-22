import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import type { AppDescriptor, Platform } from '../types/app.ts';
import type { AppleCredentials } from '../types/credentials.ts';
import { writeAppVersion } from '../config/config.ts';
import {
  compareVersions,
  formatVersion,
  highestVersion,
  nextVersion,
  parseVersion,
  type BumpKind,
} from '../release/version.ts';
import { readLastBump } from '../distribution/last-run.ts';
import type { Logger } from '../services/platform/logger.ts';
import { executeCommand } from '../services/platform/exec.ts';
import { checkTerminalIsInteractive, withSpinner } from '../services/platform/progress.ts';
import { nativeProjectDirName } from '../services/stores/platform.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { GoogleStoreClientService } from '../services/stores/google-store-client.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { BuildRunOptions, BumpResolution } from './pipeline-types.ts';
import type { MutableDeep } from '../types/mutable.ts';

type BuildVersionFailure = Readonly<{
  readonly _tag: 'BuildVersionFailure';
  readonly message: string;
}>;

function makeBuildVersionFailure(fields: { message: string }): BuildVersionFailure {
  return { _tag: 'BuildVersionFailure', message: fields.message };
}

type PromptedVersion = Readonly<{
  readonly chosen: string;
  readonly kind: BumpKind | undefined;
}>;

function isDirectoryName(childName: string): boolean {
  return childName != '';
}

/**
 * Find the native target directory that holds Info.plist. Directories are checked before the plist
 * probe because a regular file makes `Info.plist` look like `ENOTDIR`.
 */
export async function findNativeTargetDirectory(nativeDirectory: string): Promise<string | null> {
  const nativeEntries = await readdir(nativeDirectory);

  for (const childName of nativeEntries) {
    const isNamed = isDirectoryName(childName);

    if (isNamed == false) {
      continue;
    }

    const childPath = join(nativeDirectory, childName);
    const childInfo = await stat(childPath);
    const isDirectory = childInfo.isDirectory();

    if (isDirectory == false) {
      continue;
    }

    const infoPlistPath = join(childPath, 'Info.plist');
    const hasInfoPlist = await pathExists(infoPlistPath);

    if (hasInfoPlist) {
      return childName;
    }
  }

  return null;
}

/** Stamp one key into the platform's generated Info.plist. Returns whether a target plist was found. */
export async function setNativePlistValue(
  appDir: string,
  platform: Platform,
  key: string,
  plistValue: string | number,
): Promise<boolean> {
  const nativeDirectory = join(appDir, nativeProjectDirName(platform));
  const directoryExists = await pathExists(nativeDirectory);

  if (directoryExists == false) {
    return false;
  }

  const targetDirectory = await findNativeTargetDirectory(nativeDirectory);

  if (targetDirectory == null) {
    return false;
  }

  const plistPath = join(nativeDirectory, targetDirectory, 'Info.plist');

  await executeCommand('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${plistValue}`, plistPath]);

  return true;
}

/** Set `CFBundleVersion` in the platform's generated Info.plist. */
export function setIosBuildNumber(
  appDir: string,
  platform: Platform,
  buildNumber: number,
): Promise<boolean> {
  return setNativePlistValue(appDir, platform, 'CFBundleVersion', buildNumber);
}

function setIosMarketingVersion(
  appDir: string,
  platform: Platform,
  version: string,
): Promise<boolean> {
  return setNativePlistValue(appDir, platform, 'CFBundleShortVersionString', version);
}

/** Next App Store Connect build number, or 1 when the run is dry or has no bundle id. */
export async function nextBuildNumber(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  isDryRun: boolean,
): Promise<number> {
  if (isDryRun) {
    return 1;
  }

  const hasBundleId = bundleId != '';

  if (hasBundleId == false) {
    return 1;
  }

  const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);
  const latestBuildNumber = await appStoreClient.getLatestBuildNumber(bundleId);

  return latestBuildNumber + 1;
}

function isExplicitBumpKind(flag: BumpKind | 'ask' | undefined): flag is BumpKind {
  if (flag == null) {
    return false;
  }

  return flag != 'ask';
}

/**
 * Decide how to pick the version bump. An explicit `--bump` kind wins, even without a TTY.
 */
export function resolveBumpKind(args: {
  flag: BumpKind | 'ask' | undefined;
  remembered: BumpKind | undefined;
  canPrompt: boolean;
}): BumpResolution {
  if (isExplicitBumpKind(args.flag)) {
    return { mode: 'apply', kind: args.flag, source: 'flag' };
  }

  if (args.canPrompt == false) {
    return { mode: 'leave' };
  }

  if (args.flag == 'ask') {
    return { mode: 'prompt' };
  }

  const remembered = args.remembered;

  if (isExplicitBumpKind(remembered)) {
    return { mode: 'apply', kind: remembered, source: 'remembered' };
  }

  return { mode: 'prompt' };
}

function canPromptForMarketingVersion(
  terminalIsInteractive: boolean,
  yes: boolean | undefined,
): boolean {
  if (terminalIsInteractive == false) {
    return false;
  }

  return yes != true;
}

async function promptVersion(
  baseline: string,
  current: string,
  latest: string | null,
): Promise<PromptedVersion> {
  const launchPrompt = LaunchPrompt;
  const patchVersion = nextVersion(baseline, 'patch');
  const minorVersion = nextVersion(baseline, 'minor');
  const majorVersion = nextVersion(baseline, 'major');
  let promptMessage = 'No versions on App Store Connect yet. Which version ships?';
  let initialSelection: BumpKind | 'custom' = 'keep';

  if (latest != null) {
    promptMessage = `App Store Connect's latest is ${latest}. Which version ships next?`;
    initialSelection = 'patch';
  }

  const choice = await launchPrompt.select<BumpKind | 'custom'>({
    message: promptMessage,
    initialSelection,
    choices: [
      { selection: 'patch', label: `Patch  -> ${patchVersion}`, hint: 'bug fixes' },
      { selection: 'minor', label: `Minor  -> ${minorVersion}`, hint: 'new features' },
      { selection: 'major', label: `Major  -> ${majorVersion}`, hint: 'breaking changes' },
      { selection: 'keep', label: `Keep   -> ${current}`, hint: 'reuse the app config version' },
      { selection: 'custom', label: 'Custom...', hint: 'type a version' },
    ],
  });
  const isCustom = choice == 'custom';

  if (isCustom) {
    const typedVersion = await launchPrompt.requiredText('Version (MAJOR.MINOR.PATCH):');
    const parsedVersion = parseVersion(typedVersion);

    if (parsedVersion == null) {
      throw makeBuildVersionFailure({ message: 'Use a version like 1.2.3.' });
    }

    return { chosen: formatVersion(parsedVersion), kind: undefined };
  }

  const isKeep = choice == 'keep';

  if (isKeep) {
    return { chosen: current, kind: 'keep' };
  }

  return { chosen: nextVersion(baseline, choice), kind: choice };
}

function doesNotIncrementStore(latest: string | null, chosen: string): boolean {
  if (latest == null) {
    return false;
  }

  const hasLatest = latest != '';

  if (hasLatest == false) {
    return false;
  }

  return compareVersions(chosen, latest) <= 0;
}

async function applyChosenVersion(
  app: MutableDeep<AppDescriptor>,
  platform: Platform,
  chosen: string,
  latest: string | null,
  note: string,
  log: Logger,
): Promise<void> {
  const shouldWarn = doesNotIncrementStore(latest, chosen);

  if (shouldWarn) {
    log.warn(
      `${chosen} doesn't increment the store's ${latest} - fine for another TestFlight build, but the App Store rejects a release that reuses a version.`,
    );
  }

  const stamped = await setIosMarketingVersion(app.dir, platform, chosen);
  const persisted = await writeAppVersion(app, chosen);

  app.version = chosen;

  let persistenceNote = 'app config not written (dynamic config)';

  if (persisted) {
    persistenceNote = 'app config updated';
  }

  const notes = [persistenceNote];

  if (stamped == false) {
    notes.push('Info.plist not stamped');
  }

  log.step('version', `${log.chip(chosen)} (${note}; ${notes.join('; ')})`, 'marketing-version');
}

function isPresentVersion(version: string | null): version is string {
  return version != null;
}

function currentMarketingVersion(app: AppDescriptor): string {
  if (app.version == null) {
    return '0.0.0';
  }

  return app.version;
}

/**
 * Resolve and apply the marketing version before the build. Returns the bump kind to remember.
 */
export async function resolveMarketingVersion(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
  app: MutableDeep<AppDescriptor>,
  platform: Platform,
  buildOptions: BuildRunOptions,
  log: Logger,
): Promise<BumpKind | undefined> {
  const currentVersion = currentMarketingVersion(app);

  if (buildOptions.dryRun) {
    log.step(
      'version',
      `would suggest the next version above the store's latest (config has ${currentVersion})`,
      'marketing-version',
    );
    return undefined;
  }

  const rememberedBump = await readLastBump(app.name);
  const terminalIsInteractive = checkTerminalIsInteractive();
  const decision = resolveBumpKind({
    flag: buildOptions.bump,
    remembered: rememberedBump,
    canPrompt: canPromptForMarketingVersion(terminalIsInteractive, buildOptions.yes),
  });

  if (decision.mode == 'leave') {
    log.step(
      'version',
      `${currentVersion} (from app config; not prompting under --yes / non-interactive)`,
      'marketing-version',
    );
    return undefined;
  }

  const latest = await readStoreMarketingVersion(ascKey, bundleId);
  let versionBaseline = highestVersion([latest, currentVersion].filter(isPresentVersion));

  if (versionBaseline == null) {
    versionBaseline = currentVersion;
  }

  if (decision.mode == 'prompt') {
    const prompted = await promptVersion(versionBaseline, currentVersion, latest);
    let versionChoiceLabel = 'custom';

    if (prompted.kind != null) {
      versionChoiceLabel = prompted.kind;
    }

    await applyChosenVersion(app, platform, prompted.chosen, latest, versionChoiceLabel, log);

    return prompted.kind;
  }

  const bumpKind = decision.kind;
  let chosen = currentVersion;
  const keepsCurrent = bumpKind == 'keep';

  if (keepsCurrent == false) {
    chosen = nextVersion(versionBaseline, bumpKind);
  }

  let source = 'remembered';

  if (decision.source == 'flag') {
    source = '--bump';
  }

  await applyChosenVersion(app, platform, chosen, latest, `${decision.kind}, ${source}`, log);

  return decision.kind;
}

async function readStoreMarketingVersion(
  ascKey: AppleCredentials['ascKey'],
  bundleId: string,
): Promise<string | null> {
  const hasBundleId = bundleId != '';

  if (hasBundleId == false) {
    return null;
  }

  const appStoreClient = AppleStoreClientService.createEffectClient(ascKey);

  async function readLatest(): Promise<string | null> {
    const latest = await appStoreClient.getLatestMarketingVersion(bundleId);

    return latest;
  }

  const latest = await withSpinner('Checking versions already on App Store Connect', readLatest);

  return latest;
}

function nextCodeAboveFloor(floor: number): number {
  return Math.max(floor, 0) + 1;
}

/** Next Android versionCode, one above Play's latest and the app.json floor. */
export async function nextVersionCode(
  serviceAccountJson: string,
  packageName: string,
  floor: number,
  isDryRun: boolean,
): Promise<number> {
  if (isDryRun) {
    return nextCodeAboveFloor(floor);
  }

  const hasServiceAccount = serviceAccountJson != '';

  if (hasServiceAccount == false) {
    return nextCodeAboveFloor(floor);
  }

  const playStoreClient = GoogleStoreClientService.createEffectClient(serviceAccountJson);
  const latest = await playStoreClient.getLatestVersionCode(packageName);

  return Math.max(latest, floor) + 1;
}

/** Stamp `versionCode` into android/app/build.gradle. Returns whether a line changed. */
export async function setAndroidVersionCode(appDir: string, versionCode: number): Promise<boolean> {
  const gradlePath = join(appDir, 'android', 'app', 'build.gradle');
  const gradleExists = await pathExists(gradlePath);

  if (gradleExists == false) {
    return false;
  }

  const originalGradle = await readFile(gradlePath, 'utf8');
  // Replaces the first `versionCode <number>` assignment in the Gradle file.
  const updatedGradle = originalGradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  const isUnchanged = updatedGradle == originalGradle;

  if (isUnchanged) {
    return false;
  }

  await writeFile(gradlePath, updatedGradle);

  return true;
}
