/**
 * The input contract for the docs renderers: the flattened `launch` command tree
 * ({@link CommandSpec} / {@link OptionSpec}), the live repo counts ({@link DocStats}), one
 * {@link GeneratedDoc} the script writes, and the {@link FeatureSection} capability-map shape.
 * `scripts/gen-docs.ts` adapts commander's tree into these; the renderers below consume them.
 */

/** One option/flag on a command, reduced to what the reference renders. */
export interface OptionSpec {
  /** commander's raw flags string, e.g. `-p, --profile <name>` or `--no-submit`. */
  flags: string;
  /** the one-line help shown beside the flag. */
  description: string;
}

/**
 * A `launch` (sub)command flattened to exactly what the reference needs, recursive via
 * {@link subcommands}. `path` is the command words after `launch` (e.g. `metadata pull`) so a heading
 * can be rendered without threading parent state through the walk.
 */
export interface CommandSpec {
  /** the command words after `launch`, e.g. `build` or `metadata pull`. */
  path: string;
  /** positional-argument usage, pre-formatted, e.g. `<platform>` or `[id|latest]` (empty when none). */
  args: string;
  /** the command's one-line description. */
  description: string;
  /** declared flags in registration order (commander's implicit help/version already stripped). */
  options: OptionSpec[];
  /** nested subcommands, e.g. `metadata` → [`pull`, `push`]. */
  subcommands: CommandSpec[];
}

/**
 * The live numbers in the reference's headline blockquote — computed at generation time so they can
 * never go stale. `operations` is the public async-method count across the two store API clients
 * (`ascClient` + `playClient`), i.e. the store operations Launch wraps.
 */
export interface DocStats {
  /** top-level `launch` commands. */
  commands: number;
  /** public async methods across the App Store Connect + Google Play API clients. */
  operations: number;
  /** test cases (`it`/`test` calls) guarding the codebase. */
  tests: number;
}

/** A generated file the script writes (or diffs under `--check`): repo-relative path + full contents. */
export interface GeneratedDoc {
  /** path relative to the repo root, e.g. `docs/commands.md`. */
  path: string;
  /** the rendered markdown, before prettier formatting. */
  body: string;
}

/**
 * One titled group in the {@link FEATURE_SECTIONS} capability map: a bold section label, an optional
 * one-line lead, and the single-line capability statements under it. Kept as data (not prose) so
 * {@link renderFeaturesList} can number every item continuously (1..N) across sections and the README +
 * `llms.txt` feature lists render from one source instead of two hand-maintained copies.
 */
export interface FeatureSection {
  /** the bold section label, e.g. `Build & ship — iOS and Android`. */
  title: string;
  /** an optional one-line lead rendered under the title, before the numbered items (e.g. the reconcile model). */
  intro?: string;
  /** the section's capabilities, each a single-line markdown statement of the form `**Name.** summary`. */
  features: string[];
}
