// Reports whether a thrown value is a failure that carries one named tag.

function isFailureTag(cause: unknown, tagName: string): boolean {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  const hasTag = '_tag' in cause;

  if (hasTag == false) {
    return false;
  }

  return cause._tag == tagName;
}

export { isFailureTag };
