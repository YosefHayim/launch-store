export function expectDefined<T>(candidate: T | null | undefined, label: string = 'candidate'): T {
  if (candidate == null) {
    throw new Error(`expected ${label} to be defined`);
  }

  if (candidate == null) {
    throw new Error(`expected ${label} to be defined`);
  }

  return candidate;
}

export function expectArrayElement<T>(
  values: readonly T[],
  index: number,
  label: string = 'array element',
): T {
  return expectDefined(values[index], `${label}[${index}]`);
}
