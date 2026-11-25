// Escape backslashes first so they cannot hide a following markdown table delimiter.
export const escapeCell = (text: string): string => {
  return text.replace(/[\\|]/g, (ch) => `\\${ch}`);
};
/** App Store Connect transport helpers. They are not store operations. */
export const APP_STORE_CONNECT_TRANSPORT_METHODS = ['sendJson', 'sendText', 'sendBytes'] as const;

/** Count public async methods (`  async name(`) in one API-client source - the {@link DocStats.operations} unit. */
export const countAsyncMethods = (
  source: string,
  skippedMethodNames: readonly string[] = [],
): number => {
  const methodMatches = source.match(/^[ \t]*async\s+[A-Za-z_$][A-Za-z0-9_$]*/gm);
  if (methodMatches === null) return 0;
  const countedMethods = methodMatches.filter((line) => {
    const methodName = line.trim().replace(/^async\s+/, '');
    return !skippedMethodNames.includes(methodName);
  });
  return countedMethods.length;
};
/** Count test cases (`it(` / `test(` calls, including `.each` / `.skip`) across the given test sources. */
export const countTestCases = (sources: readonly string[]): number => {
  let testCount = 0;
  for (const source of sources) {
    const testMatches = source.match(/^[ \t]*(?:it|test)(?:\.[a-z]+)?\(/gm);
    if (testMatches !== null) testCount += testMatches.length;
  }
  return testCount;
};
