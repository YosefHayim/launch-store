// Stops a failed Launch command and carries the exit code the process should use.

import { isFailureTag } from '../services/platform/tagged-failure.ts';

export type CommandExit = Readonly<{
  _tag: 'CommandExit';
  exitCode: number;
  message?: string;
}>;

export function makeCommandExit(fields: { exitCode: number; message?: string }): CommandExit {
  if (fields.message == null) {
    return { _tag: 'CommandExit', exitCode: fields.exitCode };
  }

  return { _tag: 'CommandExit', exitCode: fields.exitCode, message: fields.message };
}

export function isCommandExit(cause: unknown): cause is CommandExit {
  return isFailureTag(cause, 'CommandExit');
}

export function completeCommand(exitCode: number, message?: string): void {
  const isSuccess = exitCode == 0;

  if (isSuccess) {
    return;
  }

  if (message == null) {
    throw makeCommandExit({ exitCode });
  }

  throw makeCommandExit({ exitCode, message });
}
