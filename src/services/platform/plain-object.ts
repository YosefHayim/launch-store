// Returns an unknown value when it is a plain object, and null when it is not.

function readPlainObject(candidate: unknown): Record<string, unknown> | null {
  const isMissing = candidate == null;

  if (isMissing) {
    return null;
  }

  const isObject = typeof candidate == 'object';

  if (isObject == false) {
    return null;
  }

  const isArray = Array.isArray(candidate);

  if (isArray) {
    return null;
  }

  return candidate as Record<string, unknown>;
}

export { readPlainObject };
