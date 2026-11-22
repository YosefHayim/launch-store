import { hasMessage } from '../services/platform/error-message.ts';

export type SnapshotCommandFailure = {
  readonly _tag: 'SnapshotCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
};

function makeSnapshotCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): SnapshotCommandFailure {
  return {
    _tag: 'SnapshotCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

export function snapshotFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): SnapshotCommandFailure {
  return makeSnapshotCommandFailure({
    operation,
    message: failureMessage(operation, cause, fallbackMessage),
    cause,
  });
}

function failureMessage(operation: string, cause: unknown, fallbackMessage?: string): string {
  if (fallbackMessage != null) {
    return fallbackMessage;
  }

  if (hasMessage(cause)) {
    return cause.message;
  }

  return `${operation} failed.`;
}
