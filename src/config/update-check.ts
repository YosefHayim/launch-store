import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { captureCommandOutput, type CommandFailed } from '../services/platform/exec.ts';
import { createLogger } from '../services/platform/logger.ts';
import {
  ensureDirectoryExists,
  readLaunchDirectories,
  resolveUpdateStateFilePath,
} from '../services/platform/paths.ts';
import { mergeChildEnv } from '../terminal/locale.ts';
import { isCommandExit, makeCommandExit } from '../terminal/command-exit.ts';
import { readFile, writeFile } from 'node:fs/promises';

const PACKAGE_NAME = 'launch-store';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type UpdateState = {
  lastCheckedAt: number;
  latestSeen?: string;
};

export type UpgradeResult = 'upgraded' | 'eacces' | 'failed';
export type GlobalInstaller = 'npm' | 'pnpm';

const INSTALL_VERBS: Record<GlobalInstaller, readonly string[]> = {
  npm: ['install', '-g'],
  pnpm: ['add', '-g'],
};

const GLOBAL_INSTALLERS: readonly GlobalInstaller[] = ['npm', 'pnpm'];

function versionPart(versionToken: string | undefined): number {
  if (versionToken == null) {
    return 0;
  }

  const parsedPart = Number(versionToken);

  if (Number.isNaN(parsedPart)) {
    return 0;
  }

  return parsedPart;
}

function versionParts(version: string): [number, number, number] {
  const versionTokens = version.replace(/^v/, '').split(/[.+-]/);

  return [
    versionPart(versionTokens[0]),
    versionPart(versionTokens[1]),
    versionPart(versionTokens[2]),
  ];
}

export function isNewer(latest: string, current: string): boolean {
  const [latestMajor, latestMinor, latestPatch] = versionParts(latest);
  const [currentMajor, currentMinor, currentPatch] = versionParts(current);

  if (latestMajor != currentMajor) {
    return latestMajor > currentMajor;
  }

  if (latestMinor != currentMinor) {
    return latestMinor > currentMinor;
  }

  return latestPatch > currentPatch;
}

export function shouldCheck(
  now: number,
  state: UpdateState | null,
  intervalMs: number = CHECK_INTERVAL_MS,
): boolean {
  if (state == null) {
    return true;
  }

  return now - state.lastCheckedAt >= intervalMs;
}

function environmentFlagIsSet(environmentValue: string | undefined): boolean {
  if (environmentValue == null) {
    return false;
  }

  return environmentValue != '';
}

export function autoUpgradeBlockedReason(input: {
  environmentVariables: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  scriptPath: string;
}): string | null {
  const alreadyUpgraded = input.environmentVariables['LAUNCH_UPGRADED'] == '1';

  if (alreadyUpgraded) {
    return 'already re-executed after an upgrade (loop guard)';
  }

  const optedOut = environmentFlagIsSet(input.environmentVariables['LAUNCH_NO_UPGRADE']);

  if (optedOut) {
    return 'LAUNCH_NO_UPGRADE is set';
  }

  const isCi = environmentFlagIsSet(input.environmentVariables['CI']);

  if (isCi) {
    return 'running in CI';
  }

  if (input.isTTY == false) {
    return 'not an interactive terminal (piped, agent, or background)';
  }

  const isSourceRun = input.scriptPath.endsWith('.ts');

  if (isSourceRun) {
    return 'running from source (dev)';
  }

  return null;
}

function installArguments(installer: GlobalInstaller, version: string): readonly string[] {
  return [...INSTALL_VERBS[installer], `${PACKAGE_NAME}@${version}`];
}

function installCommandText(installer: GlobalInstaller, version: string): string {
  return [installer, ...installArguments(installer, version)].join(' ');
}

export type UpdateCheckDeps = {
  now(): number;
  currentVersion: string;
  environmentVariables: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  scriptPath: string;
  resolveInstaller(): Promise<GlobalInstaller | null>;
  readState(): UpdateState | null;
  writeState(state: UpdateState): Promise<void>;
  fetchLatest(): Promise<string | null>;
  upgrade(installer: GlobalInstaller, current: string, latest: string): Promise<UpgradeResult>;
  reexec(installer: GlobalInstaller): Promise<void>;
  notify(message: string): Promise<void>;
};

export async function maybeAutoUpgrade(deps: UpdateCheckDeps): Promise<void> {
  const blockedReason = autoUpgradeBlockedReason({
    environmentVariables: deps.environmentVariables,
    isTTY: deps.isTTY,
    scriptPath: deps.scriptPath,
  });

  if (blockedReason != null) {
    return;
  }

  const isDue = shouldCheck(deps.now(), deps.readState());

  if (isDue == false) {
    return;
  }

  const latest = await deps.fetchLatest();
  const nextState: UpdateState = { lastCheckedAt: deps.now() };

  if (latest != null) {
    nextState.latestSeen = latest;
  }

  await deps.writeState(nextState);

  if (latest == null) {
    return;
  }

  const hasNewerRelease = isNewer(latest, deps.currentVersion);

  if (hasNewerRelease == false) {
    return;
  }

  const installer = await deps.resolveInstaller();

  if (installer == null) {
    await deps.notify(`launch ${latest} is available - you have ${deps.currentVersion}`);

    return;
  }

  const installCommand = installCommandText(installer, latest);
  const upgradeOutcome = await deps.upgrade(installer, deps.currentVersion, latest);

  switch (upgradeOutcome) {
    case 'upgraded':
      await deps.reexec(installer);
      return;
    case 'eacces':
      await deps.notify(
        `launch ${latest} is available but the global install isn't writable - sudo ${installCommand}`,
      );
      return;
    case 'failed':
      await deps.notify(`launch ${latest} is available - ${installCommand}`);
      return;
  }
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function readUpdateState(candidate: unknown): UpdateState | null {
  if (isPlainRecord(candidate)) {
    return updateStateFromRecord(candidate);
  }

  return null;
}

function updateStateFromRecord(candidate: Record<string, unknown>): UpdateState | null {
  const lastCheckedAt = candidate['lastCheckedAt'];

  if (typeof lastCheckedAt != 'number') {
    return null;
  }

  const latestSeen = candidate['latestSeen'];

  if (latestSeen == null) {
    return { lastCheckedAt };
  }

  if (typeof latestSeen != 'string') {
    return null;
  }

  return { lastCheckedAt, latestSeen };
}

async function readStoredState(stateFilePath: string): Promise<UpdateState | null> {
  const stateExists = await pathExists(stateFilePath);

  if (stateExists == false) {
    return null;
  }

  try {
    const stateText = await readFile(stateFilePath, 'utf8');
    const parsedState: unknown = JSON.parse(stateText);

    return readUpdateState(parsedState);
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

async function writeStoredState(stateFilePath: string, state: UpdateState): Promise<void> {
  try {
    await ensureDirectoryExists(dirname(stateFilePath));
    await writeFile(stateFilePath, JSON.stringify(state));
  } catch (error) {
    const isUnwritable = error != null;

    if (isUnwritable) {
      return;
    }
  }
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  try {
    const registryReply = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
      signal: AbortSignal.timeout(1500),
    });
    const statusIsLow = registryReply.status < 200;

    if (statusIsLow) {
      return null;
    }

    const statusIsHigh = registryReply.status >= 300;

    if (statusIsHigh) {
      return null;
    }

    const registryMetadata: unknown = await registryReply.json();

    if (isPlainRecord(registryMetadata)) {
      return registryVersion(registryMetadata);
    }

    return null;
  } catch (error) {
    const requestFailed = error != null;

    if (requestFailed) {
      return null;
    }

    return null;
  }
}

function registryVersion(registryMetadata: Record<string, unknown>): string | null {
  const version = registryMetadata['version'];

  if (typeof version == 'string') {
    return version;
  }

  return null;
}

function isCommandFailed(cause: unknown): cause is CommandFailed {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'CommandFailed';
}

function permissionDenied(cause: unknown): boolean {
  if (isCommandFailed(cause) == false) {
    return false;
  }

  return /EACCES|permission denied/i.test(cause.stderr);
}

async function performUpgrade(
  installer: GlobalInstaller,
  current: string,
  latest: string,
  homeDirectory: string,
): Promise<UpgradeResult> {
  const logger = createLogger(false);
  logger.line(`Upgrading launch ${current} -> ${latest}`);

  try {
    await captureCommandOutput(installer, installArguments(installer, latest), {
      workingDirectory: homeDirectory,
    });
    logger.line(`launch upgraded to ${latest} - relaunching`);

    return 'upgraded';
  } catch (cause) {
    logger.warn(`launch ${latest} available - automatic upgrade failed`);
    const isPermissionDenied = permissionDenied(cause);

    if (isPermissionDenied) {
      return 'eacces';
    }

    return 'failed';
  }
}

function reexecLaunch(
  executablePath: string,
  commandArguments: readonly string[],
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Promise<never> {
  const childEnvironment = mergeChildEnv({ ...environmentVariables }, { LAUNCH_UPGRADED: '1' });

  return new Promise((_resolve, reject) => {
    const child = spawn(executablePath, [...commandArguments], {
      stdio: 'inherit',
      env: childEnvironment,
    });

    child.on('error', () => {
      reject(makeCommandExit({ exitCode: 1 }));
    });

    child.on('exit', (exitCode) => {
      let code = 1;

      if (exitCode != null) {
        code = exitCode;
      }

      reject(makeCommandExit({ exitCode: code }));
    });
  });
}

function pnpmGlobalPath(listingText: string): string | null {
  let parsedListing: unknown;

  try {
    parsedListing = JSON.parse(listingText);
  } catch (error) {
    const isInvalid = error != null;

    if (isInvalid) {
      return null;
    }

    return null;
  }

  if (Array.isArray(parsedListing) == false) {
    return null;
  }

  const globalProject = parsedListing[0];

  if (isPlainRecord(globalProject)) {
    return launchStorePath(globalProject);
  }

  return null;
}

function launchStorePath(globalProject: Record<string, unknown>): string | null {
  const dependencies = globalProject['dependencies'];

  if (isPlainRecord(dependencies) == false) {
    return null;
  }

  const launchPackage = dependencies[PACKAGE_NAME];

  if (isPlainRecord(launchPackage) == false) {
    return null;
  }

  const packagePath = launchPackage['path'];

  if (typeof packagePath == 'string') {
    return packagePath;
  }

  return null;
}

async function resolveGlobalPackagePath(
  installer: GlobalInstaller,
  homeDirectory: string,
): Promise<string | null> {
  if (installer == 'npm') {
    const npmGlobalRoot = await captureCommandOutput('npm', ['root', '-g'], {
      workingDirectory: homeDirectory,
    });

    return join(npmGlobalRoot, PACKAGE_NAME);
  }

  const globalListingText = await captureCommandOutput(
    'pnpm',
    ['ls', '-g', '--json', PACKAGE_NAME],
    { workingDirectory: homeDirectory },
  );

  return pnpmGlobalPath(globalListingText);
}

async function resolveGlobalEntryPath(
  installer: GlobalInstaller,
  homeDirectory: string,
): Promise<string | null> {
  try {
    const globalPackagePath = await resolveGlobalPackagePath(installer, homeDirectory);

    if (globalPackagePath == null) {
      return null;
    }

    return join(globalPackagePath, 'dist/cli/index.js');
  } catch (error) {
    const lookupFailed = error != null;

    if (lookupFailed) {
      return null;
    }

    return null;
  }
}

async function realPathOrNull(candidate: string): Promise<string | null> {
  try {
    return await realpath(candidate);
  } catch (error) {
    const isMissing = error != null;

    if (isMissing) {
      return null;
    }

    return null;
  }
}

async function isRunningGlobalInstall(
  installer: GlobalInstaller,
  realScriptPath: string,
  homeDirectory: string,
): Promise<boolean> {
  const globalEntryPath = await resolveGlobalEntryPath(installer, homeDirectory);

  if (globalEntryPath == null) {
    return false;
  }

  const realGlobalEntryPath = await realPathOrNull(globalEntryPath);

  return realGlobalEntryPath == realScriptPath;
}

async function resolveRunningInstaller(
  realScriptPath: string,
  homeDirectory: string,
): Promise<GlobalInstaller | null> {
  for (const installer of GLOBAL_INSTALLERS) {
    const isThisInstaller = await isRunningGlobalInstall(installer, realScriptPath, homeDirectory);

    if (isThisInstaller) {
      return installer;
    }
  }

  return null;
}

type AutoUpgradeRuntime = Readonly<{
  executablePath: string;
  commandArguments: readonly string[];
  terminalIsInteractive: boolean;
  scriptPath: string;
}>;

async function relaunchUpgradedLaunch(
  installer: GlobalInstaller,
  runtime: AutoUpgradeRuntime,
  environmentVariables: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): Promise<void> {
  const relaunchScript = await resolveGlobalEntryPath(installer, homeDirectory);
  const logger = createLogger(false);

  if (relaunchScript == null) {
    logger.warn('launch was upgraded - the new version runs from your next command');

    return;
  }

  await reexecLaunch(
    runtime.executablePath,
    [relaunchScript, ...runtime.commandArguments],
    environmentVariables,
  );
}

async function notifyUpgrade(message: string): Promise<void> {
  createLogger(false).warn(message);
}

export async function runAutoUpgrade(
  currentVersion: string,
  runtime: AutoUpgradeRuntime,
): Promise<void> {
  try {
    const environment = readLaunchEnvironment();
    const directories = readLaunchDirectories();
    const stateFilePath = resolveUpdateStateFilePath();
    const currentState = await readStoredState(stateFilePath);
    let realScriptPath = runtime.scriptPath;
    const resolvedScriptPath = await realPathOrNull(runtime.scriptPath);

    if (resolvedScriptPath != null) {
      realScriptPath = resolvedScriptPath;
    }

    await maybeAutoUpgrade({
      now() {
        return Date.now();
      },
      currentVersion,
      environmentVariables: environment.rawVariables,
      isTTY: runtime.terminalIsInteractive,
      scriptPath: runtime.scriptPath,
      resolveInstaller() {
        return resolveRunningInstaller(realScriptPath, directories.homeDirectory);
      },
      readState() {
        return currentState;
      },
      writeState(state) {
        return writeStoredState(stateFilePath, state);
      },
      fetchLatest() {
        return fetchLatestVersion(PACKAGE_NAME);
      },
      upgrade(upgradeInstaller, installedVersion, publishedVersion) {
        return performUpgrade(
          upgradeInstaller,
          installedVersion,
          publishedVersion,
          directories.homeDirectory,
        );
      },
      reexec(upgradedInstaller) {
        return relaunchUpgradedLaunch(
          upgradedInstaller,
          runtime,
          environment.rawVariables,
          directories.homeDirectory,
        );
      },
      notify: notifyUpgrade,
    });
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }
  }
}
