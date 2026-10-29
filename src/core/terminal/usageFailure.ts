import { Data, Effect } from 'effect';
import { LaunchLogger, type Logger } from '../services/logger.js';
import { makeCommandExit, type CommandExit } from './commandExit.js';

export type UsageFailure = Readonly<{
  readonly _tag: 'UsageFailure';
  readonly message: string;
}>;

export const makeUsageFailure = Data.tagged<UsageFailure>('UsageFailure');

const USAGE_EXIT_CODE = 2;

export const endWithUsageFailure = (
  usageFailure: UsageFailure,
  isJson: boolean,
): Effect.Effect<never, CommandExit, Logger> =>
  Effect.gen(function* () {
    const logger = yield* LaunchLogger;
    if (isJson) {
      const failureLine = JSON.stringify({ ok: false, error: usageFailure.message });
      yield* logger.line(failureLine).pipe(Effect.orDie);
    }
    const isHumanOutput = !isJson;
    if (isHumanOutput) yield* logger.error(usageFailure.message).pipe(Effect.orDie);
    const usageExit = makeCommandExit({ exitCode: USAGE_EXIT_CODE, message: usageFailure.message });
    return yield* Effect.fail(usageExit);
  });
