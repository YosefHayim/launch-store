// Escape backslashes first so they cannot hide a following markdown table delimiter.
export const escapeCell = (text: string): string => {
  return text.replace(/[\\|]/g, (ch) => `\\${ch}`);
};
/** Count public async methods (`  async name(`) in one API-client source - the {@link DocStats.operations} unit. */
export const countAsyncMethods = (source: string): number => {
  const methodMatches = source.match(/^[ \t]*async\s+[A-Za-z_$]/gm);
  if (methodMatches === null) return 0;
  return methodMatches.length;
};
/** Count test cases (`it(` / `test(` calls, including `.each` / `.skip`) across the given test sources. */
export const countTestCases = (sources: string[]): number => {
  let testCount = 0;
  for (const source of sources) {
    const testMatches = source.match(/^[ \t]*(?:it|test)(?:\.[a-z]+)?\(/gm);
    if (testMatches !== null) testCount += testMatches.length;
  }
  return testCount;
};
