import { readPlainObject } from './plain-object.ts';

function hasMessage(failure: unknown): failure is Readonly<{ message: string }> {
  const failureRecord = readPlainObject(failure);

  if (failureRecord == null) {
    return false;
  }

  const message = failureRecord['message'];

  if (typeof message != 'string') {
    return false;
  }

  return true;
}

function errorMessage(failure: unknown): string {
  if (hasMessage(failure)) {
    return failure.message;
  }

  return String(failure);
}

export { errorMessage, hasMessage };
