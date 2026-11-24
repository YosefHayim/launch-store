// Shapes a snapshot command error into the error Launch commands throw.

import { hasMessage } from '../services/platform/error-message.ts';

export function snapshotFailure(
  operation: string,
  cause: unknown,
  fallbackMessage?: string,
): never {
  const message = failureMessage(operation, cause, fallbackMessage);

  throw new Error(message, { cause });
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
