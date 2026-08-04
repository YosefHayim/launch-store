import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { resolveLogsDirectory, type LaunchPathsService } from '../services/paths.js';
import { diagnoseBuildLog, formatDiagnoses } from './buildDiagnostics.js';

export const DiagnoseCommandInputSchema = Schema.Struct({
  logfile: Schema.optional(Schema.String),
});

export type DiagnoseCommandInput = Schema.Schema.Type<typeof DiagnoseCommandInputSchema>;

export type DiagnoseCommandFailure = Readonly<{
  readonly _tag: 'DiagnoseCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeDiagnoseCommandFailure =
  Data.tagged<DiagnoseCommandFailure>('DiagnoseCommandFailure');

type DiagnoseCommandRequirements = FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path;

/** Find the newest readable build log in Launch's local log directory. */
export const findMostRecentBuildLog = (): Effect.Effect<
  string | null,
  never,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const logsDirectory = yield* resolveLogsDirectory();
    const directoryExists = yield* fileSystem
      .exists(logsDirectory)
      .pipe(Effect.orElseSucceed(() => false));
    if (!directoryExists) return null;
    const filenames = yield* fileSystem
      .readDirectory(logsDirectory)
      .pipe(Effect.orElseSucceed(() => []));
    let newestLog: Readonly<{ path: string; modifiedAt: number }> | null = null;
    for (const filename of filenames) {
      if (!filename.endsWith('.log')) continue;
      const logPath = pathService.join(logsDirectory, filename);
      const fileMetadata = yield* fileSystem.stat(logPath).pipe(Effect.either);
      if (fileMetadata._tag === 'Left') continue;
      let modifiedAt = 0;
      if (fileMetadata.right.mtime._tag === 'Some') {
        modifiedAt = fileMetadata.right.mtime.value.getTime();
      }
      if (newestLog === null) {
        newestLog = { path: logPath, modifiedAt };
        continue;
      }
      if (modifiedAt > newestLog.modifiedAt) newestLog = { path: logPath, modifiedAt };
    }
    if (newestLog === null) return null;
    return newestLog.path;
  });

/** Read one build log and render any recognized native failure diagnoses. */
export const diagnoseCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, DiagnoseCommandFailure, DiagnoseCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(DiagnoseCommandInputSchema)(rawCommandInput);
    let logPath: string | null | undefined = commandInput.logfile;
    if (logPath === undefined) logPath = yield* findMostRecentBuildLog();
    const logger = yield* createLogger(false);
    if (logPath === null) {
      yield* logger.skip(
        'No build log found. Run a build first, or pass a log path: `launch diagnose <file>`.',
      );
      return;
    }
    if (logPath === undefined) {
      yield* logger.skip(
        'No build log found. Run a build first, or pass a log path: `launch diagnose <file>`.',
      );
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    if (!(yield* fileSystem.exists(logPath))) {
      return yield* Effect.fail(
        makeDiagnoseCommandFailure({
          operation: 'read build log',
          message: `No log file at ${logPath}.`,
        }),
      );
    }
    const logText = yield* fileSystem.readFileString(logPath);
    const diagnoses = diagnoseBuildLog(logText);
    if (diagnoses.length === 0) {
      yield* logger.skip(`No known issues recognized in ${logPath}.`);
      yield* logger.line('Open the log to inspect the failure directly.');
      return;
    }
    yield* logger.line(`Diagnosing ${logPath}\n`);
    yield* logger.line(formatDiagnoses(diagnoses));
  }).pipe(
    Effect.mapError((cause) => {
      if (cause._tag === 'DiagnoseCommandFailure') return cause;
      return makeDiagnoseCommandFailure({
        operation: 'diagnose build log',
        message: errorMessage(cause),
        cause,
      });
    }),
  );
