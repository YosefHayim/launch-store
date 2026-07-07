/**
 * Effect program for `launch build`.
 *
 * This is the migration seam between thin Commander wiring and the older Promise-based pipeline. New
 * command orchestration lives here; the pipeline stays behind a single temporary `Effect.tryPromise`
 * wrapper until it is migrated.
 */

import { Data, Effect } from 'effect';
import { runBuild } from './pipeline.js';
import { setVerboseOutput } from '../services/progress.js';
import {
  type BuildCommandInputError,
  type BuildCommandOptions,
  parseBuildCommandInput,
} from './buildCommandInput.js';

/** The existing Promise pipeline failed while executing a decoded build command. */
export class BuildCommandExecutionError extends Data.TaggedError('BuildCommandExecutionError')<{
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * Run one `launch build` invocation as an Effect.
 *
 * @param platformArgument - Raw `<platform>` argument from Commander.
 * @param commandOptions - Raw options object from Commander.
 * @returns An Effect that succeeds after the build path finishes or fails with typed command errors.
 */
export const buildCommandProgram = (
  platformArgument: string,
  commandOptions: BuildCommandOptions,
): Effect.Effect<void, BuildCommandInputError | BuildCommandExecutionError> =>
  Effect.gen(function* () {
    const buildRunOptions = yield* parseBuildCommandInput(platformArgument, commandOptions);

    yield* Effect.sync(() => setVerboseOutput(commandOptions.verbose));

    return yield* Effect.tryPromise({
      try: () => runBuild(buildRunOptions),
      catch: (cause) =>
        new BuildCommandExecutionError({
          message: cause instanceof Error ? cause.message : 'Build command failed.',
          cause,
        }),
    });
  });
