export type OptionSpec = {
  flags: string;
  description: string;
};
/**
 * A `launch` (sub)command flattened to exactly what the reference needs, recursive via
 * {@link subcommands}. `path` is the command words after `launch` (e.g. `metadata pull`) so a heading
 * can be rendered without threading parent state through the walk.
 */
export type CommandSpec = {
  path: string;
  args: string;
  description: string;
  options: OptionSpec[];
  subcommands: CommandSpec[];
};
/**
 * The live numbers in the reference's headline blockquote - computed at generation time so they can
 * never go stale. `operations` is the public async-method count across the two store API clients
 * (`ascClient` + `playClient`), i.e. the store operations Launch wraps.
 */
export type DocStats = {
  commands: number;
  operations: number;
  tests: number;
};
/** A generated file the script writes (or diffs under `--check`): repo-relative path + full contents. */
export type GeneratedDoc = {
  path: string;
  body: string;
};
/**
 * One titled group in the {@link FEATURE_SECTIONS} capability map: a bold section label, an optional
 * one-line lead, and the single-line capability statements under it. Kept as data (not prose) so
 * {@link renderFeaturesList} can number every item continuously (1..N) across sections and the README +
 * `llms.txt` feature lists render from one source instead of two hand-maintained copies.
 */
export type FeatureSection = {
  title: string;
  intro?: string;
  features: string[];
};
