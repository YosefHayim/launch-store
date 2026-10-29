import { Data, Effect } from 'effect';
import { LaunchLogger, type Logger } from '../services/logger.js';
import { makeCommandExit, type CommandExit } from './commandExit.js';

/** The command was called with flags that cannot work; the CLI ends it with exit code 2. */
export type UsageFailure = Readonly<{
  readonly _tag: 'UsageFailure';
  readonly message: string;
}>;

export const makeUsageFailure = Data.tagged<UsageFailure>('UsageFailure');

const USAGE_EXIT_CODE = 2;

/** Show the usage problem (one JSON object with `--json`, one error line otherwise) and exit 2. */
export const endWithUsageFailure = (
  usageFailure: UsageFailure,
  isJson: boolean,
): Effect.Effect<never, CommandExit, Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    if (isJson) {
      yield* logger
        .line(JSON.stringify({ ok: false, error: usageFailure.message }))
        .pipe(Effect.orDie);
    }
    if (!isJson) yield* logger.error(usageFailure.message).pipe(Effect.orDie);
    return yield* Effect.fail(
      makeCommandExit({ exitCode: USAGE_EXIT_CODE, message: usageFailure.message }),
    );
  });
