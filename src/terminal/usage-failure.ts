// Prints a usage error and stops the command with exit code 2.

import { createLogger } from '../services/platform/logger.ts';
import { makeCommandExit } from './command-exit.ts';

export function endWithUsageFailure(message: string, isJson: boolean): never {
  const logger = createLogger(false);
  const failureLine = JSON.stringify({ ok: false, error: message });

  if (isJson) {
    logger.line(failureLine);
  }

  const isHumanOutput = isJson == false;

  if (isHumanOutput) {
    logger.error(message);
  }

  throw makeCommandExit({ exitCode: 2, message });
}
