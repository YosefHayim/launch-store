export const expectDefined = <T>(candidate: T | null | undefined, label = 'candidate'): T => {
  if (candidate === null) {
    throw new Error(`expected ${label} to be defined`);
  }
  if (candidate === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return candidate;
};
export const expectArrayElement = <T>(
  values: readonly T[],
  index: number,
  label = 'array element',
): T => {
  return expectDefined(values[index], `${label}[${index}]`);
};
