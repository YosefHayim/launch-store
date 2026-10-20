import {
  Command,
  FileSystem,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  Path,
} from '@effect/platform';
import * as CommandExecutor from '@effect/platform/CommandExecutor';
import { Effect, Option, type ParseResult, Schema } from 'effect';
import { LaunchEnvironment } from '../services/environment.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { captureCommandOutput, type CommandFailed } from '../services/exec.js';
import {
  LaunchPaths,
  resolveUpdateStateFilePath,
  type LaunchPathsService,
} from '../services/paths.js';
import { mergeChildEnv } from '../terminal/locale.js';
import { makeCommandExit, type CommandExit } from '../terminal/commandExit.js';
/** The published package name (the `launch` bin's npm package). */
const PACKAGE_NAME = 'launch-store';
const CLI_ENTRY_PATH = 'dist/cli/index.js';
/** Poll the registry at most this often. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Cap the registry request so a slow/offline network never delays the CLI. */
const FETCH_TIMEOUT_MS = 1500;
/** Throttle state persisted to `~/.launch/update.json`. */
export type UpdateState = {
  lastCheckedAt: number;
  latestSeen?: string;
};
/** Outcome of attempting the global upgrade. */
export type UpgradeResult = 'upgraded' | 'eacces' | 'failed';
export type GlobalInstaller = 'npm' | 'pnpm';
const INSTALL_VERBS: Record<GlobalInstaller, readonly string[]> = {
  npm: ['install', '-g'],
  pnpm: ['add', '-g'],
};
const GLOBAL_INSTALLERS: readonly GlobalInstaller[] = ['npm', 'pnpm'];
const UpdateStateSchema = Schema.Struct({
  lastCheckedAt: Schema.Number,
  latestSeen: Schema.optional(Schema.String),
});
const UpdateStateJsonSchema = Schema.parseJson(UpdateStateSchema);
const RegistryMetadataSchema = Schema.Struct({ version: Schema.String });
const PnpmGlobalListingSchema = Schema.parseJson(
  Schema.Array(
    Schema.Struct({
      dependencies: Schema.Struct({ [PACKAGE_NAME]: Schema.Struct({ path: Schema.String }) }),
    }),
  ),
);

const versionPart = (versionToken: string | undefined): number => {
  if (versionToken === undefined) return 0;
  const parsedPart = Number(versionToken);
  if (Number.isNaN(parsedPart)) return 0;
  return parsedPart;
};
/** Parse a dotted version into a `[major, minor, patch]` tuple, ignoring any pre-release/build suffix. */
const versionParts = (version: string): [number, number, number] => {
  const versionTokens = version.replace(/^v/, '').split(/[.+-]/);
  return [
    versionPart(versionTokens[0]),
    versionPart(versionTokens[1]),
    versionPart(versionTokens[2]),
  ];
};
/** True when `latest` is a strictly higher version than `current`. */
export const isNewer = (latest: string, current: string): boolean => {
  const [a0, a1, a2] = versionParts(latest);
  const [b0, b1, b2] = versionParts(current);
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
};
/** Whether enough time has passed (or there's no prior state) to poll the registry again. */
export const shouldCheck = (
  now: number,
  state: UpdateState | null,
  intervalMs: number = CHECK_INTERVAL_MS,
): boolean => {
  if (state === null) return true;
  return now - state.lastCheckedAt >= intervalMs;
};
/**
 * Why an auto-upgrade is suppressed, or null to proceed. Pure so every guard is unit-tested.
 * Order matters: the loop guard and explicit opt-out come before the environment heuristics.
 */
export const autoUpgradeBlockedReason = (input: {
  environmentVariables: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  scriptPath: string;
}): string | null => {
  if (input.environmentVariables['LAUNCH_UPGRADED'] === '1')
    return 'already re-executed after an upgrade (loop guard)';
  if (input.environmentVariables['LAUNCH_NO_UPGRADE']) return 'LAUNCH_NO_UPGRADE is set';
  if (input.environmentVariables['CI']) return 'running in CI';
  if (!input.isTTY) return 'not an interactive terminal (piped, agent, or background)';
  if (input.scriptPath.endsWith('.ts')) return 'running from source (dev)';
  return null;
};
const installArguments = (installer: GlobalInstaller, version: string): readonly string[] => [
  ...INSTALL_VERBS[installer],
  `${PACKAGE_NAME}@${version}`,
];
const installCommandText = (installer: GlobalInstaller, version: string): string =>
  [installer, ...installArguments(installer, version)].join(' ');
/** Everything {@link maybeAutoUpgrade} touches, injected so the orchestration is testable. */
export type UpdateCheckDeps = {
  now(): number;
  currentVersion: string;
  environmentVariables: Readonly<Record<string, string | undefined>>;
  isTTY: boolean;
  scriptPath: string;
  resolveInstaller(): Effect.Effect<GlobalInstaller | null>;
  readState(): UpdateState | null;
  writeState(state: UpdateState): Effect.Effect<void>;
  fetchLatest(): Effect.Effect<string | null>;
  upgrade(
    installer: GlobalInstaller,
    current: string,
    latest: string,
  ): Effect.Effect<UpgradeResult>;
  reexec(installer: GlobalInstaller): Effect.Effect<void, CommandExit>;
  notify(message: string): Effect.Effect<void>;
};
/**
 * Decide and (silently) perform a self-upgrade. Returns without effect when guarded, throttled, or
 * already up to date; on a newer version it upgrades and re-execs, falling back to a printed notice
 * when the global install isn't writable.
 */
export const maybeAutoUpgrade = (deps: UpdateCheckDeps): Effect.Effect<void, CommandExit> =>
  Effect.gen(function* () {
    if (
      autoUpgradeBlockedReason({
        environmentVariables: deps.environmentVariables,
        isTTY: deps.isTTY,
        scriptPath: deps.scriptPath,
      })
    )
      return;
    if (!shouldCheck(deps.now(), deps.readState())) return;
    const latest = yield* deps.fetchLatest();
    const nextState: UpdateState = { lastCheckedAt: deps.now() };
    if (latest !== null) nextState.latestSeen = latest;
    yield* deps.writeState(nextState);
    if (latest === null) return;
    if (!isNewer(latest, deps.currentVersion)) return;
    const installer = yield* deps.resolveInstaller();
    if (installer === null) {
      yield* deps.notify(`launch ${latest} is available - you have ${deps.currentVersion}`);
      return;
    }
    const installCommand = installCommandText(installer, latest);
    const upgradeOutcome = yield* deps.upgrade(installer, deps.currentVersion, latest);
    switch (upgradeOutcome) {
      case 'upgraded':
        yield* deps.reexec(installer);
        return;
      case 'eacces':
        yield* deps.notify(
          `launch ${latest} is available but the global install isn't writable - sudo ${installCommand}`,
        );
        return;
      case 'failed':
        yield* deps.notify(`launch ${latest} is available - ${installCommand}`);
        return;
    }
  });
/** Read the throttle state, or null if absent/corrupt. */
const readState = (
  stateFilePath: string,
): Effect.Effect<UpdateState | null, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const stateText = yield* fileSystem
      .readFileString(stateFilePath)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (stateText === null) return null;
    return yield* Effect.sync(() => {
      const decodedState = Option.getOrNull(
        Schema.decodeUnknownOption(UpdateStateJsonSchema)(stateText),
      );
      if (decodedState === null) return null;
      if (decodedState.latestSeen === undefined)
        return { lastCheckedAt: decodedState.lastCheckedAt };
      return {
        lastCheckedAt: decodedState.lastCheckedAt,
        latestSeen: decodedState.latestSeen,
      };
    }).pipe(Effect.catchAll(() => Effect.succeed(null)));
  });
/** Persist the throttle state; a cache-write failure must never break the CLI. */
const writeState = (
  stateFilePath: string,
  stateDirectory: string,
  state: UpdateState,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.makeDirectory(stateDirectory, { recursive: true });
    yield* fileSystem.writeFileString(stateFilePath, JSON.stringify(state));
  }).pipe(Effect.catchAll(() => Effect.void));
/** Fetch the latest published version from the npm registry, or null on any error/timeout. */
const fetchLatestVersion = (
  packageName: string,
): Effect.Effect<string | null, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const registryRequest = HttpClientRequest.get(
      `https://registry.npmjs.org/${packageName}/latest`,
    );
    const registryReply = yield* httpClient.execute(registryRequest);
    if (registryReply.status < 200) return null;
    if (registryReply.status >= 300) return null;
    const registryMetadata =
      yield* HttpClientResponse.schemaBodyJson(RegistryMetadataSchema)(registryReply);
    return registryMetadata.version;
  }).pipe(
    Effect.timeout(`${FETCH_TIMEOUT_MS} millis`),
    Effect.catchAll(() => Effect.succeed(null)),
  );
/**
 * Run the global upgrade under a spinner, classifying a permission failure so the caller can degrade
 * to a notice. Uses the same `@clack/prompts` spinner as the rest of the CLI, but is result-driven
 * rather than throw-driven so the EACCES-vs-generic distinction survives in the return value. Always
 * called on an interactive TTY (auto-upgrade is otherwise blocked), so a spinner is the right
 * affordance here.
 */
const performUpgrade = (
  installer: GlobalInstaller,
  current: string,
  latest: string,
  homeDirectory: string,
): Effect.Effect<
  UpgradeResult,
  never,
  CommandExecutor.CommandExecutor | LaunchEnvironmentService
> =>
  Effect.gen(function* () {
    yield* Effect.logInfo(`Upgrading launch ${current} -> ${latest}`);
    const installAttempt = yield* captureCommandOutput(
      installer,
      installArguments(installer, latest),
      { workingDirectory: homeDirectory },
    ).pipe(Effect.either);
    if (installAttempt._tag === 'Right') {
      yield* Effect.logInfo(`launch upgraded to ${latest} - relaunching`);
      return 'upgraded';
    }
    yield* Effect.logWarning(`launch ${latest} available - automatic upgrade failed`);
    const failureMessage = String(installAttempt.left);
    if (/EACCES|permission denied/i.test(failureMessage)) return 'eacces';
    return 'failed';
  });
/** Re-run the original command on the now-upgraded binary, tagging the child to prevent an upgrade loop. */
const reexecLaunch = (
  executablePath: string,
  commandArguments: readonly string[],
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Effect.Effect<never, CommandExit, CommandExecutor.CommandExecutor> =>
  Effect.gen(function* () {
    let reexecCommand = Command.make(executablePath, ...commandArguments);
    reexecCommand = Command.env(
      reexecCommand,
      mergeChildEnv(environmentVariables, { LAUNCH_UPGRADED: '1' }),
    );
    reexecCommand = reexecCommand.pipe(
      Command.stdin('inherit'),
      Command.stdout('inherit'),
      Command.stderr('inherit'),
    );
    const exitCode = yield* Command.exitCode(reexecCommand).pipe(
      Effect.map(Number),
      Effect.orElseSucceed(() => 1),
    );
    return yield* Effect.fail(makeCommandExit({ exitCode }));
  });
const resolveGlobalPackagePath = (
  installer: GlobalInstaller,
  homeDirectory: string,
): Effect.Effect<
  string | null,
  CommandFailed | ParseResult.ParseError,
  CommandExecutor.CommandExecutor | LaunchEnvironmentService | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    if (installer === 'npm') {
      const npmGlobalRoot = yield* captureCommandOutput('npm', ['root', '-g'], {
        workingDirectory: homeDirectory,
      });
      return pathService.join(npmGlobalRoot, PACKAGE_NAME);
    }
    const globalListingText = yield* captureCommandOutput(
      'pnpm',
      ['ls', '-g', '--json', PACKAGE_NAME],
      { workingDirectory: homeDirectory },
    );
    const globalListing = yield* Schema.decodeUnknown(PnpmGlobalListingSchema)(globalListingText);
    const [globalProject] = globalListing;
    if (globalProject === undefined) return null;
    return globalProject.dependencies[PACKAGE_NAME].path;
  });
const resolveGlobalEntryPath = (
  installer: GlobalInstaller,
  homeDirectory: string,
): Effect.Effect<
  string | null,
  never,
  CommandExecutor.CommandExecutor | LaunchEnvironmentService | Path.Path
> =>
  Effect.gen(function* () {
    const globalPackagePath = yield* resolveGlobalPackagePath(installer, homeDirectory);
    if (globalPackagePath === null) return null;
    const pathService = yield* Path.Path;
    return pathService.join(globalPackagePath, CLI_ENTRY_PATH);
  }).pipe(Effect.orElseSucceed(() => null));
const isRunningGlobalInstall = (
  installer: GlobalInstaller,
  realScriptPath: string,
  homeDirectory: string,
): Effect.Effect<
  boolean,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | LaunchEnvironmentService | Path.Path
> =>
  Effect.gen(function* () {
    const globalEntryPath = yield* resolveGlobalEntryPath(installer, homeDirectory);
    if (globalEntryPath === null) return false;
    const fileSystem = yield* FileSystem.FileSystem;
    const realGlobalEntryPath = yield* fileSystem
      .realPath(globalEntryPath)
      .pipe(Effect.orElseSucceed(() => null));
    return realGlobalEntryPath === realScriptPath;
  });
const resolveRunningInstaller = (
  realScriptPath: string,
  homeDirectory: string,
): Effect.Effect<
  GlobalInstaller | null,
  never,
  CommandExecutor.CommandExecutor | FileSystem.FileSystem | LaunchEnvironmentService | Path.Path
> =>
  Effect.findFirst(GLOBAL_INSTALLERS, (installer) =>
    isRunningGlobalInstall(installer, realScriptPath, homeDirectory),
  ).pipe(Effect.map(Option.getOrNull));

export type AutoUpgradeRuntime = Readonly<{
  readonly executablePath: string;
  readonly commandArguments: readonly string[];
  readonly terminalIsInteractive: boolean;
  readonly scriptPath: string;
}>;
const relaunchUpgradedLaunch = (
  installer: GlobalInstaller,
  runtime: AutoUpgradeRuntime,
  environmentVariables: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
): Effect.Effect<
  void,
  CommandExit,
  CommandExecutor.CommandExecutor | LaunchEnvironmentService | Path.Path
> =>
  Effect.gen(function* () {
    const relaunchScript = yield* resolveGlobalEntryPath(installer, homeDirectory);
    if (relaunchScript === null) {
      yield* Effect.logWarning('launch was upgraded - the new version runs from your next command');
      return;
    }
    yield* reexecLaunch(
      runtime.executablePath,
      [relaunchScript, ...runtime.commandArguments],
      environmentVariables,
    );
  });
/**
 * Entry point wired into the CLI: run the guarded, throttled self-upgrade. Swallows all errors -
 * update checking is never allowed to break a command.
 */
export const runAutoUpgrade = (
  currentVersion: string,
  runtime: AutoUpgradeRuntime,
): Effect.Effect<
  void,
  CommandExit,
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | LaunchEnvironmentService
  | LaunchPathsService
  | Path.Path
> =>
  Effect.gen(function* () {
    const commandExecutor = yield* CommandExecutor.CommandExecutor;
    const fileSystem = yield* FileSystem.FileSystem;
    const httpClient = yield* HttpClient.HttpClient;
    const pathService = yield* Path.Path;
    const environment = yield* LaunchEnvironment;
    const launchPaths = yield* LaunchPaths;
    const stateFilePath = yield* resolveUpdateStateFilePath();
    const currentState = yield* readState(stateFilePath);
    const realScriptPath = yield* fileSystem
      .realPath(runtime.scriptPath)
      .pipe(Effect.orElseSucceed(() => runtime.scriptPath));
    yield* maybeAutoUpgrade({
      now: () => Date.now(),
      currentVersion,
      environmentVariables: environment.rawVariables,
      isTTY: runtime.terminalIsInteractive,
      scriptPath: runtime.scriptPath,
      resolveInstaller: () =>
        resolveRunningInstaller(realScriptPath, launchPaths.homeDirectory).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, commandExecutor),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(LaunchEnvironment, environment),
          Effect.provideService(Path.Path, pathService),
        ),
      readState: () => currentState,
      writeState: (state) =>
        writeState(stateFilePath, pathService.dirname(stateFilePath), state).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
        ),
      fetchLatest: () =>
        fetchLatestVersion(PACKAGE_NAME).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
        ),
      upgrade: (upgradeInstaller, installedVersion, publishedVersion) =>
        performUpgrade(
          upgradeInstaller,
          installedVersion,
          publishedVersion,
          launchPaths.homeDirectory,
        ).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, commandExecutor),
          Effect.provideService(LaunchEnvironment, environment),
        ),
      reexec: (upgradedInstaller) =>
        relaunchUpgradedLaunch(
          upgradedInstaller,
          runtime,
          environment.rawVariables,
          launchPaths.homeDirectory,
        ).pipe(
          Effect.provideService(CommandExecutor.CommandExecutor, commandExecutor),
          Effect.provideService(LaunchEnvironment, environment),
          Effect.provideService(Path.Path, pathService),
        ),
      notify: (message) => Effect.logWarning(message),
    });
  });
