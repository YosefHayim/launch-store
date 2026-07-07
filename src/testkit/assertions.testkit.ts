/**
 * Assert that a test value is present and return it with `null`/`undefined` removed from the type.
 *
 * @param value - Value the test expects to be present.
 * @param label - Human-readable label included in the failure message.
 * @returns The same value after a runtime presence guard.
 */
export function expectDefined<T>(value: T | null | undefined, label = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`expected ${label} to be defined`);
  }
  return value;
}

/**
 * Assert that an array contains the requested index and return that element.
 *
 * @param values - Array-like collection under test.
 * @param index - Zero-based index expected to be present.
 * @param label - Human-readable collection label included in the failure message.
 * @returns The array element after a runtime presence guard.
 */
export function expectArrayElement<T>(
  values: readonly T[],
  index: number,
  label = 'array element',
): T {
  return expectDefined(values[index], `${label}[${index}]`);
}
