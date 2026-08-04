import * as Command from '@effect/platform/Command';
import type * as PlatformCommandExecutor from '@effect/platform/CommandExecutor';
import * as FileSystem from '@effect/platform/FileSystem';
import { NodeContext } from '@effect/platform-node';
import { Data, Effect, Layer, Stream } from 'effect';
import { mergeChildEnv } from '../terminal/locale.js';
import {
  LaunchEnvironment,
  LaunchEnvironmentLive,
  type LaunchEnvironmentService,
} from './environment.js';
import { redactLine } from './redact.js';
/** A command could not start or completed with a non-zero exit code. */
export type CommandFailed = Readonly<{
  readonly _tag: 'CommandFailed';
  readonly command: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly cause?: unknown;
}>;
/** Construct a readonly tagged command failure. */
export const makeCommandFailed = Data.tagged<CommandFailed>('CommandFailed');
/** Working-directory and environment inputs shared by command programs. */
export type CommandExecutionOptions = Readonly<{
  readonly workingDirectory?: string;
  readonly environmentOverrides?: Record<string, string>;
}>;
/** Output handling for a quiet command program. */
export type QuietCommandExecutionOptions = CommandExecutionOptions &
  Readonly<{
    readonly onLine?: (line: string) => void;
    readonly logFilePath?: string;
    readonly shouldRedactSecrets?: boolean;
  }>;
const makeCommand = (
  executable: string,
  commandArguments: readonly string[],
  commandOptions: CommandExecutionOptions,
): Effect.Effect<Command.Command, never, LaunchEnvironmentService> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    let command = Command.make(executable, ...commandArguments);
    command = Command.env(
      command,
      mergeChildEnv(environment.rawVariables, commandOptions.environmentOverrides),
    );
    if (commandOptions.workingDirectory !== undefined) {
      command = Command.workingDirectory(command, commandOptions.workingDirectory);
    }
    return command;
  });
const commandPlatformFailure = (executable: string, cause: unknown): CommandFailed =>
  makeCommandFailed({ command: executable, exitCode: null, stderr: String(cause), cause });
const checkExitCode = (
  executable: string,
  exitCode: PlatformCommandExecutor.ExitCode,
  standardError: string,
): Effect.Effect<void, CommandFailed> => {
  if (Number(exitCode) === 0) return Effect.void;
  return Effect.fail(
    makeCommandFailed({
      command: executable,
      exitCode: Number(exitCode),
      stderr: standardError,
    }),
  );
};
const collectText = <TError, TRequirements>(
  byteStream: Stream.Stream<Uint8Array, TError, TRequirements>,
): Effect.Effect<string, TError, TRequirements> =>
  byteStream.pipe(
    Stream.decodeText(),
    Stream.runFold('', (collectedText, textChunk) => collectedText + textChunk),
  );
export const executeCommand = (
  executable: string,
  commandArguments: readonly string[],
  commandOptions: CommandExecutionOptions = {},
): Effect.Effect<
  void,
  CommandFailed,
  PlatformCommandExecutor.CommandExecutor | LaunchEnvironmentService
> =>
  Effect.gen(function* () {
    const baseCommand = yield* makeCommand(executable, commandArguments, commandOptions);
    const command = baseCommand.pipe(
      Command.stdin('inherit'),
      Command.stdout('inherit'),
      Command.stderr('inherit'),
    );
    const exitCode = yield* Command.exitCode(command).pipe(
      Effect.mapError((cause) => commandPlatformFailure(executable, cause)),
    );
    yield* checkExitCode(executable, exitCode, '');
  });
export const captureCommandOutput = (
  executable: string,
  commandArguments: readonly string[],
  commandOptions: CommandExecutionOptions = {},
): Effect.Effect<
  string,
  CommandFailed,
  PlatformCommandExecutor.CommandExecutor | LaunchEnvironmentService
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const baseCommand = yield* makeCommand(executable, commandArguments, commandOptions);
      const command = baseCommand.pipe(Command.stdin(Stream.empty));
      const childProcess = yield* Command.start(command).pipe(
        Effect.mapError((cause) => commandPlatformFailure(executable, cause)),
      );
      const [standardOutput, standardError, exitCode] = yield* Effect.all(
        [collectText(childProcess.stdout), collectText(childProcess.stderr), childProcess.exitCode],
        { concurrency: 'unbounded' },
      ).pipe(Effect.mapError((cause) => commandPlatformFailure(executable, cause)));
      yield* checkExitCode(executable, exitCode, standardError.trim());
      return standardOutput.trim();
    }),
  );
export const executeCommandQuietly = (
  executable: string,
  commandArguments: readonly string[],
  commandOptions: QuietCommandExecutionOptions = {},
): Effect.Effect<
  void,
  CommandFailed,
  PlatformCommandExecutor.CommandExecutor | FileSystem.FileSystem | LaunchEnvironmentService
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const baseCommand = yield* makeCommand(executable, commandArguments, commandOptions);
      const command = baseCommand.pipe(Command.stdin(Stream.empty));
      const childProcess = yield* Command.start(command).pipe(
        Effect.mapError((cause) => commandPlatformFailure(executable, cause)),
      );
      const combinedLines = Stream.merge(childProcess.stdout, childProcess.stderr).pipe(
        Stream.decodeText(),
        Stream.splitLines,
      );
      const consumeOutput = combinedLines.pipe(
        Stream.runForEach((outputLine) =>
          Effect.gen(function* () {
            if (commandOptions.onLine !== undefined) {
              yield* Effect.sync(() => commandOptions.onLine?.(outputLine));
            }
            if (commandOptions.logFilePath === undefined) return;
            let persistedLine = outputLine;
            if (commandOptions.shouldRedactSecrets === true) {
              persistedLine = redactLine(outputLine);
            }
            yield* fileSystem.writeFileString(commandOptions.logFilePath, `${persistedLine}\n`, {
              flag: 'a',
            });
          }),
        ),
      );
      const [, exitCode] = yield* Effect.all([consumeOutput, childProcess.exitCode], {
        concurrency: 'unbounded',
      }).pipe(Effect.mapError((cause) => commandPlatformFailure(executable, cause)));
      yield* checkExitCode(executable, exitCode, '');
    }),
  );
export const checkCommandExists = (
  executable: string,
): Effect.Effect<
  boolean,
  never,
  PlatformCommandExecutor.CommandExecutor | LaunchEnvironmentService
> =>
  captureCommandOutput('which', [executable]).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
export const provideNodeCommandServices = <TValue, TError>(
  program: Effect.Effect<
    TValue,
    TError,
    PlatformCommandExecutor.CommandExecutor | FileSystem.FileSystem | LaunchEnvironmentService
  >,
): Effect.Effect<TValue, TError> =>
  program.pipe(
    Effect.provide(NodeContext.layer),
    Effect.provide(LaunchEnvironmentLive.pipe(Layer.orDie)),
  );
