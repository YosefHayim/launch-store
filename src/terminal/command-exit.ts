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
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'CommandExit';
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
