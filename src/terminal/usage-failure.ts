import { createLogger } from '../services/platform/logger.ts';
import { makeCommandExit } from './command-exit.ts';

export type UsageFailure = Readonly<{
  readonly _tag: 'UsageFailure';
  readonly message: string;
}>;

export function makeUsageFailure(fields: { message: string }): UsageFailure {
  return { _tag: 'UsageFailure', message: fields.message };
}

export function endWithUsageFailure(usageFailure: UsageFailure, isJson: boolean): never {
  const logger = createLogger(false);
  const failureLine = JSON.stringify({ ok: false, error: usageFailure.message });

  if (isJson) {
    logger.line(failureLine);
  }

  const isHumanOutput = isJson == false;

  if (isHumanOutput) {
    logger.error(usageFailure.message);
  }

  throw makeCommandExit({ exitCode: 2, message: usageFailure.message });
}
