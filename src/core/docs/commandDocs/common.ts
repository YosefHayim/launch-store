/**
 * Small leaf helpers shared across the docs renderers: markdown table-cell escaping (also used by the
 * sibling config-reference renderer) and the two repo counters that feed {@link DocStats}. No imports,
 * no rendering — just the utilities the other modules lean on.
 */

/**
 * Escape a markdown table cell's structural characters — backslash and pipe — in one pass. Escaping
 * both together (rather than only `|`) means a literal backslash in the text can't combine with a
 * following pipe to slip an unescaped delimiter through and split the cell; prettier handles the rest.
 * Shared with the config reference renderer ({@link import("./configDocs.js")}) — table-cell escaping
 * is one concern, so both generated docs escape identically.
 */
export function escapeCell(text: string): string {
  return text.replace(/[\\|]/g, (ch) => `\\${ch}`);
}

/** Count public async methods (`  async name(`) in one API-client source — the {@link DocStats.operations} unit. */
export function countAsyncMethods(source: string): number {
  return (source.match(/^[ \t]*async\s+[A-Za-z_$]/gm) ?? []).length;
}

/** Count test cases (`it(` / `test(` calls, including `.each` / `.skip`) across the given test sources. */
export function countTestCases(sources: string[]): number {
  return sources.reduce(
    (total, source) => total + (source.match(/^[ \t]*(?:it|test)(?:\.[a-z]+)?\(/gm) ?? []).length,
    0,
  );
}
