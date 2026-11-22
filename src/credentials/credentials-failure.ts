import { errorMessage } from '../services/platform/error-message.ts';

export type CredentialsCommandFailure = Readonly<{
  readonly _tag: 'CredentialsCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeCredentialsCommandFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): CredentialsCommandFailure {
  if (fields.cause != null) {
    return {
      _tag: 'CredentialsCommandFailure',
      operation: fields.operation,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'CredentialsCommandFailure',
    operation: fields.operation,
    message: fields.message,
  };
}

export function commandFailure(operation: string, cause: unknown): CredentialsCommandFailure {
  return makeCredentialsCommandFailure({ operation, message: errorMessage(cause), cause });
}

export function failCommand(operation: string, message: string): never {
  throw makeCredentialsCommandFailure({ operation, message });
}
