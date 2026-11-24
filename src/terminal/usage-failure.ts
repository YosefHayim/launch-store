// Prints a usage error and stops the command with exit code 2.

import { makeCommandExit } from './command-exit.ts';
import { redactText } from '../services/platform/redact.ts';

export function endWithUsageFailure(message: string, isJson: boolean): never {
  const failureLine = JSON.stringify({ ok: false, error: message });

  if (isJson) {
    console.log(redactText(failureLine));
  }

  const isHumanOutput = isJson == false;

  if (isHumanOutput) {
    console.log(redactText(message));
  }

  throw makeCommandExit({ exitCode: 2, message });
}
