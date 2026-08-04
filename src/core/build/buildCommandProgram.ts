import { Data, Effect } from 'effect';
import { runBuild } from './pipeline.js';
import { setVerboseOutput } from '../services/progress.js';
import { type BuildCommandOptions, parseBuildCommandInput } from './buildCommandInput.js';
/** The build pipeline failed while executing a decoded build command. */
export type BuildCommandExecutionError = Readonly<{
  readonly _tag: 'BuildCommandExecutionError';
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeBuildCommandExecutionError = Data.tagged<BuildCommandExecutionError>(
  'BuildCommandExecutionError',
);
export const buildCommandProgram = (
  platformArgument: string,
  commandOptions: BuildCommandOptions,
) =>
  Effect.gen(function* () {
    const buildRunOptions = yield* parseBuildCommandInput(platformArgument, commandOptions);
    yield* Effect.sync(() => setVerboseOutput(commandOptions.verbose));
    return yield* runBuild(buildRunOptions).pipe(
      Effect.mapError((cause) => {
        let failureMessage = 'Build command failed.';
        if (cause instanceof Error) failureMessage = cause.message;
        return makeBuildCommandExecutionError({ message: failureMessage, cause });
      }),
    );
  });
