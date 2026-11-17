// Escape backslashes first so they cannot hide a following markdown table delimiter.
export const escapeCell = (text: string): string => {
  return text.replace(/[\\|]/g, (ch) => `\\${ch}`);
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
