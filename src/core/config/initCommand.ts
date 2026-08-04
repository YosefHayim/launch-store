import { FileSystem, Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { resolveArtifactDir } from '../distribution/storage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { AppDescriptor } from '../types/app.js';
import { loadConfig } from './config.js';
import {
  configTemplate,
  DEFAULT_IN_REPO_ARTIFACT_DIR,
  detectAppRoot,
  ENV_EXAMPLE_TEMPLATE,
} from './configScaffold.js';
import { ensureArtifactDirIgnored } from './gitignore.js';

export const InitCommandInputSchema = Schema.Struct({
  workingDirectory: Schema.optionalWith(Schema.String, { exact: true }),
  framed: Schema.Boolean,
});

export type InitCommandInput = Schema.Schema.Type<typeof InitCommandInputSchema>;

/** An init command step failed. */
export type InitCommandFailure = Readonly<{
  readonly _tag: 'InitCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeInitCommandFailure = Data.tagged<InitCommandFailure>('InitCommandFailure');

type InitCommandRequirements =
  | FileSystem.FileSystem
  | LaunchPromptService
  | LaunchPathsService
  | Logger
  | Path.Path
  | Terminal.Terminal;

/** Convert a dependency failure into the init command channel. */
const initFailure = (operation: string, cause: unknown): InitCommandFailure => {
  let message = `${operation} failed.`;
  if (typeof cause === 'string' && cause.length > 0) message = cause;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeInitCommandFailure({ operation, message, cause });
};

/** Write a file only when it does not exist. */
const writeFileIfAbsent = (
  filePath: string,
  fileContents: string,
): Effect.Effect<boolean, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (yield* fileSystem.exists(filePath)) return false;
    yield* fileSystem.writeFileString(filePath, fileContents);
    return true;
  });

/** Print the discovered-app summary before scaffolding. */
const showDiscoveredApps = (
  discoveredApps: AppDescriptor[],
): Effect.Effect<void, unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    if (discoveredApps.length === 0) {
      yield* logger.notice(
        'Heads up',
        'No app.json found under this folder. Launch will still scaffold a config you can edit.',
      );
      return;
    }
    const appLines = discoveredApps.map((discoveredApp) => {
      let bundleDetails = '';
      if (discoveredApp.bundleId !== undefined) bundleDetails = `  (${discoveredApp.bundleId})`;
      return `- ${discoveredApp.name}${bundleDetails}`;
    });
    let appSuffix = 's';
    if (discoveredApps.length === 1) appSuffix = '';
    yield* logger.notice(`Found ${discoveredApps.length} app${appSuffix}`, ...appLines);
  });

/** Ask for the artifact directory with the established in-repository default. */
const readArtifactDirectory = (): Effect.Effect<
  string | null,
  InitCommandFailure,
  LaunchPromptService | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeInitCommandFailure({
          operation: 'read artifact directory',
          message: '`launch init` requires an interactive terminal.',
          cause: 'interactive-input-required',
        }),
      );
    }
    yield* terminal
      .display(`Where should build artifacts be stored? [${DEFAULT_IN_REPO_ARTIFACT_DIR}] `)
      .pipe(Effect.mapError((cause) => initFailure('show artifact directory prompt', cause)));
    const prompt = yield* LaunchPrompt;
    return yield* terminal.readLine.pipe(
      Effect.map((enteredDirectory) => {
        const trimmedDirectory = enteredDirectory.trim();
        if (trimmedDirectory.length === 0) return DEFAULT_IN_REPO_ARTIFACT_DIR;
        return trimmedDirectory;
      }),
      Effect.catchAll(() =>
        prompt.cancel('Left your launch.config.ts untouched.').pipe(Effect.as(null)),
      ),
    );
  });

/** Render the scaffold receipt and next actions. */
const showInitReceipt = (writtenFiles: string): Effect.Effect<void, unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    yield* logger.notice(
      'Done',
      `Wrote: ${writtenFiles}`,
      '',
      'Next:',
      '  1. launch creds set-key   # import your App Store Connect API key',
      '  2. launch creds setup     # create/reuse your cert + provisioning profile',
      '  3. launch build ios --dry-run   # rehearse the whole flow, no changes',
    );
  });

/** Run the scaffold and report whether it completed or was cancelled. */
export const runInitProgram = (
  rawCommandInput: unknown,
): Effect.Effect<boolean, InitCommandFailure, InitCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(InitCommandInputSchema)(rawCommandInput).pipe(
      Effect.mapError((cause) => initFailure('decode init command input', cause)),
    );
    const logger = yield* createLogger(false);
    if (commandInput.framed) yield* logger.line('launch init');
    const launchPaths = yield* LaunchPaths;
    let workingDirectory = launchPaths.workingDirectory;
    if (commandInput.workingDirectory !== undefined) {
      workingDirectory = commandInput.workingDirectory;
    }
    const loadedConfiguration = yield* loadConfig(workingDirectory);
    yield* showDiscoveredApps(loadedConfiguration.apps);
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const prompt = yield* LaunchPrompt;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeInitCommandFailure({
          operation: 'start init prompt',
          message: '`launch init` requires an interactive terminal.',
          cause: 'interactive-input-required',
        }),
      );
    }
    const configPath = pathService.join(workingDirectory, 'launch.config.ts');
    if (yield* fileSystem.exists(configPath)) {
      const overwriteConfirmed = yield* prompt.confirm(
        'launch.config.ts already exists. Overwrite it?',
      );
      if (!overwriteConfirmed) {
        yield* prompt.cancel('Left your launch.config.ts untouched.');
        return false;
      }
    }
    const artifactDirectory = yield* readArtifactDirectory();
    if (artifactDirectory === null) return false;
    const detectedAppRoot = yield* detectAppRoot(loadedConfiguration.apps, workingDirectory);
    const initialConfig = configTemplate(detectedAppRoot, undefined, undefined, artifactDirectory);
    yield* fileSystem.writeFileString(configPath, initialConfig);
    const environmentExampleWritten = yield* writeFileIfAbsent(
      pathService.join(workingDirectory, '.env.example'),
      ENV_EXAMPLE_TEMPLATE,
    );
    const resolvedArtifactDirectory = yield* resolveArtifactDir(
      artifactDirectory,
      workingDirectory,
    ).pipe(Effect.mapError((cause) => initFailure('resolve artifact directory', cause)));
    const gitignoreChange = yield* ensureArtifactDirIgnored(
      resolvedArtifactDirectory,
      workingDirectory,
    );
    const writtenFiles = ['launch.config.ts'];
    if (environmentExampleWritten) writtenFiles.push('.env.example');
    if (gitignoreChange.added) {
      let ignoreEntry = '';
      if (gitignoreChange.entry !== undefined) ignoreEntry = gitignoreChange.entry;
      writtenFiles.push(`.gitignore (+ ${ignoreEntry})`);
    }
    yield* showInitReceipt(writtenFiles.join(', '));
    if (commandInput.framed) yield* logger.line('Launch is configured.');
    return true;
  }).pipe(Effect.mapError((cause) => initFailure('run init', cause)));

/** Run one schema-decoded init command. */
export const initCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, InitCommandFailure, InitCommandRequirements> =>
  runInitProgram(rawCommandInput).pipe(Effect.asVoid);
