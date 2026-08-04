export type OptionSpec = Readonly<{
  flags: string;
  description: string;
}>;
/**
 * A `launch` (sub)command flattened to exactly what the reference needs, recursive via
 * {@link subcommands}. `path` is the command words after `launch` (e.g. `metadata pull`) so a heading
 * can be rendered without threading parent state through the walk.
 */
export type CommandSpec = Readonly<{
  path: string;
  args: string;
  description: string;
  options: readonly OptionSpec[];
  subcommands: readonly CommandSpec[];
}>;
/**
 * The live numbers in the reference's headline blockquote - computed at generation time so they can
 * never go stale. `operations` is the public async-method count across the two store API clients
 * (`ascClient` + `playClient`), i.e. the store operations Launch wraps.
 */
export type DocStats = Readonly<{
  commands: number;
  operations: number;
  tests: number;
}>;
/** A generated file the script writes (or diffs under `--check`): repo-relative path + full contents. */
export type GeneratedDoc = Readonly<{
  path: string;
  body: string;
}>;
/**
 * One titled group in the {@link FEATURE_SECTIONS} capability map: a bold section label, an optional
 * one-line lead, and the single-line capability statements under it. Kept as data (not prose) so
 * {@link renderFeaturesList} can number every item continuously (1..N) across sections and the README +
 * `llms.txt` feature lists render from one source instead of two hand-maintained copies.
 */
export type FeatureSection = Readonly<{
  title: string;
  intro?: string;
  features: readonly string[];
}>;
