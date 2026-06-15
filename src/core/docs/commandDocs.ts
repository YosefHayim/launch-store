/**
 * Pure rendering + counting behind `npm run docs:gen`.
 *
 * The I/O half lives in `scripts/gen-docs.ts` — mirroring how `scripts/gen-asc-types.ts` keeps its
 * tested logic in `src/core/asc/specPatch.ts`. This module turns a plain description of the `launch`
 * command tree ({@link CommandSpec}) plus a few repo-wide counts ({@link DocStats}) into the three
 * committed, generated docs: `docs/commands.md`, `llms.txt`, and `llms-full.txt`. Keeping the command
 * surface defined in `src/cli` as the single source those docs derive from is what stops the
 * AI-facing and human-facing markdown from drifting out of sync with the real CLI.
 *
 * It is deliberately free of commander, prettier, and `fs` so it stays trivially unit-testable: the
 * script adapts commander's tree into {@link CommandSpec}, supplies the counts, prettier-formats the
 * returned markdown, and writes (or, under `--check`, diffs) the files.
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
 * The single canonical category sentence. Kept byte-identical in `package.json` `description`, the
 * README hero, and the `llms.txt` summary blockquote so an LLM sees one consistent sentence to lift —
 * the GEO goal of issue #89. The consistency test asserts all three still match this constant.
 */
export const CANONICAL_SENTENCE =
  "Open-source, self-hosted alternative to Expo EAS — build, sign & ship your Expo / React Native apps to TestFlight & Google Play from your own machine, with your own keys. No per-build bill.";

/**
 * The "what Launch is / is NOT" disambiguation, shared by the README and `llms-full.txt`. AI engines
 * currently conflate Launch with thin App Store Connect SDK/MCP wrappers; this block states the
 * category difference in lines a model can lift verbatim. The consistency test asserts both surfaces
 * still contain {@link IS_NOT_SIGNATURE}.
 */
export const WHAT_LAUNCH_IS_BLOCK = `**Launch is** an end-to-end release tool: it owns the whole path from source to store — build, code-sign, size-check, store-config-as-code, upload, public release, and over-the-air updates — for both iOS and Android, on hardware you own.

**Launch is not** just an App Store Connect SDK or an ASC MCP server. Those wrap a slice of Apple's API; Launch drives the entire release across Apple **and** Google, with signing, building, and OTA updates that an API wrapper doesn't touch. If you want a self-hosted Expo EAS — not just an API client — that's Launch.`;

/** A stable sentence from {@link WHAT_LAUNCH_IS_BLOCK} the consistency test greps for on both surfaces. */
export const IS_NOT_SIGNATURE = "**Launch is not** just an App Store Connect SDK";

/**
 * The HTML-comment fences around the README's live-stats badge row. `npm run docs:gen` rewrites only
 * the text between these markers (via {@link spliceReadmeBadges}); everything else in the curated
 * README is left byte-for-byte untouched. Kept here — beside the other generated-doc constants — so the
 * one place that owns "what the docs say" also owns where in the README they go.
 */
export const STATS_BADGES_START =
  "<!-- stats-badges:start — generated by `npm run docs:gen`; edit the source, then regenerate. -->";

/** Closing fence for the README badge region; see {@link STATS_BADGES_START}. */
export const STATS_BADGES_END = "<!-- stats-badges:end -->";

/** Curated prose describing the EAS-parity pipeline, lifted verbatim into both llms files. */
const PIPELINE_PROSE = `Launch runs the EAS pipeline locally: prebuild → resolve credentials → compile & sign → size-check → store → submit to the testing track (TestFlight / Play internal); \`launch release\` is the separate, confirmed public release. EAS → Launch mapping: \`eas build\` → \`launch build\`, \`eas submit\` → \`launch release\`, \`eas update\` → \`launch update\` (Expo Updates protocol, hosted on your own S3/R2/Supabase bucket, with \`launch updates rollback\`), \`eas metadata\` → \`launch metadata\` (iOS _and_ Android), \`eas credentials\` → \`launch creds\` (multi-account, keychain-stored, with an APNs push-key vault). Beyond parity it adds store config as code (\`launch sync\` reconciles IAPs, subscriptions, and capabilities onto App Store Connect), keychain-backed build secrets with a documented env-precedence ladder (\`launch secret\`), internal/ad-hoc distribution, build history and re-signing (\`launch builds\`, \`launch build:resign\`), native-failure diagnosis (\`launch diagnose\`), and no-Mac builds on your own AWS EC2 Mac or any Mac over SSH. Signing keys stay in the OS keychain (macOS Keychain, or the platform secret store elsewhere); storage, credentials, build engine, and submission are pluggable behind small interfaces. App facts come from each \`app.json\`, so nothing is duplicated. \`launch demo\` walks the whole flow as a zero-setup simulation.`;

/** Curated "Source" link list, shared by both llms files; every link is asserted to resolve on disk. */
const SOURCE_LINKS = `- [Domain types & provider interfaces](./src/core/types.ts): the single source of truth for Launch's vocabulary (incl. SecretStore, ComputeHost).
- [Pipeline](./src/core/pipeline.ts): the build → submit spine, the shared \`prepareBuild\` front half, and the \`--dry-run\` rehearsal.
- [Remote pipeline](./src/core/remotePipeline.ts): the C1–C7 host lifecycle for off-Mac builds; [EAS pipeline](./src/core/easPipeline.ts): the Expo handoff.
- [AWS EC2 Mac host](./src/providers/compute/awsEc2Mac.ts): allocate/status/teardown + golden-AMI + \`cloud doctor\`; [SSH transport](./src/core/ssh.ts) and [remote build ops](./src/core/remoteBuild.ts).
- [Glossary](./src/core/glossary.ts): plain-English term definitions shared by \`launch explain\` and the docs.
- [App Store Connect client](./src/apple/ascClient.ts): the Apple API integration (JWT auth, bundle ids, certs, profiles, builds).
- [ASC product sync](./src/core/ascSync.ts): the declarative reconciler behind \`launch sync\` (capabilities, IAPs, subscriptions, pricing).
- [Config preflight](./src/core/configCheck.ts): the app-config footgun validator run by \`launch doctor\` and at the head of \`launch build\`.
- [Build secrets](./src/core/buildSecrets.ts): keychain-backed \`launch secret\` storage, injected through the [env-precedence ladder](./src/core/env.ts) shared by \`build\`, \`release\`, and \`update\`.
- [Completion notifications](./src/core/notify.ts): the \`notify\` webhook + shell hook fired on build/submit completion.
- [Public API](./src/index.ts): what a user's \`launch.config.ts\` imports (\`defineConfig\`, the \`products\` catalog, the \`notify\` config).`;

/** Escape a markdown table cell: only the pipe needs escaping; prettier handles the rest on format. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/** Render a command's flag table, or `""` when it has no options. */
function renderOptionsTable(options: OptionSpec[]): string {
  if (options.length === 0) return "";
  const rows = options.map((o) => `| \`${escapeCell(o.flags)}\` | ${escapeCell(o.description)} |`);
  return ["", "| Flag | Description |", "| --- | --- |", ...rows].join("\n");
}

/** Render one command (heading + description + flag table) and, recursively, its subcommands. */
function renderCommand(command: CommandSpec, level: number): string {
  const usage = command.args ? `launch ${command.path} ${command.args}` : `launch ${command.path}`;
  const parts = [`${"#".repeat(level)} \`${usage}\``, "", command.description];
  const table = renderOptionsTable(command.options);
  if (table) parts.push(table);
  for (const sub of command.subcommands) parts.push("", renderCommand(sub, level + 1));
  return parts.join("\n");
}

/** Render `docs/commands.md`: the generated header, the live-stats blockquote, and every command. */
export function renderCommandReference(commands: CommandSpec[], stats: DocStats): string {
  const header =
    "<!-- AUTOGENERATED by `npm run docs:gen` — do not edit by hand; edit the commands, then regenerate. -->";
  const blockquote = `> Launch wraps **${stats.operations} App Store Connect & Google Play API operations** across **${stats.commands} commands**, guarded by **${stats.tests} tests**.`;
  const intro =
    "Generated from the `commander` definitions in `src/cli/` by `npm run docs:gen` — edit the commands, then regenerate. For the curated overview, install, and configuration, see the [README](../README.md).";
  const body = commands.map((command) => renderCommand(command, 2)).join("\n\n");
  return `${header}\n\n# Launch command reference\n\n${blockquote}\n\n${intro}\n\n${body}\n`;
}

/** Render `llms.txt`: the llmstxt.org index — canonical summary, curated links, and a live Reference. */
export function renderLlmsTxt(stats: DocStats): string {
  return `# Launch

> ${CANONICAL_SENTENCE}

${PIPELINE_PROSE}

## Docs

- [README](./README.md): install, quick start, the command surface, configuration, and how credentials are handled.
- [CONTRIBUTING](./CONTRIBUTING.md): dev setup, the quality gate, adding a provider, tests, and CI.
- [AGENTS](./AGENTS.md): working rules for AI agents and contributors.

## Reference

- [Command reference](./docs/commands.md): all ${stats.commands} \`launch\` commands and every flag, generated from the CLI.

## Source

${SOURCE_LINKS}

## Optional

- [Example app](./examples/hello-world): a worked \`app.json\` + \`launch.config.ts\`.
- [LICENSE](./LICENSE): MIT.
`;
}

/** Render one command as an `llms-full.txt` bullet (and its subcommands as nested bullets). */
function renderCommandBullet(command: CommandSpec, indent: string): string {
  const usage = command.args ? `launch ${command.path} ${command.args}` : `launch ${command.path}`;
  const lines = [`${indent}- \`${usage}\` — ${command.description}`];
  for (const sub of command.subcommands) lines.push(renderCommandBullet(sub, `${indent}  `));
  return lines.join("\n");
}

/** Render `llms-full.txt`: the single-shot ingest — positioning, disambiguation, and every command. */
export function renderLlmsFull(commands: CommandSpec[], stats: DocStats): string {
  const everyCommand = commands.map((command) => renderCommandBullet(command, "")).join("\n");
  return `# Launch — the full map for AI agents

> ${CANONICAL_SENTENCE}

${PIPELINE_PROSE}

## What Launch is — and is not

${WHAT_LAUNCH_IS_BLOCK}

## Every command

All ${stats.commands} \`launch\` commands (${stats.operations} store-API operations underneath, ${stats.tests} tests):

${everyCommand}

## Source map

${SOURCE_LINKS}

## Links

- [README](./README.md): the human-facing overview and Launch-vs-EAS comparison.
- [Command reference](./docs/commands.md): every command and flag.
- [CONTRIBUTING](./CONTRIBUTING.md): dev setup and the quality gate.
- [LICENSE](./LICENSE): MIT.
`;
}

/**
 * Render the README's live-stats badge row from {@link DocStats}: the store-API endpoint count, the
 * full-CRUD lifecycle marker, and the passing-test count, all centered under the hero badges. The
 * numbers are generated (never hand-typed) so they track the real codebase — the endpoint and test
 * badges move with every new API method or test, and `docs:check` fails the build if the committed
 * README drifts, exactly like the generated command reference. The CRUD badge is qualitative (the two
 * clients implement create/read/update/delete across the catalog), so it carries no number to go stale.
 *
 * Returns the block *including* both {@link STATS_BADGES_START} / {@link STATS_BADGES_END} fences so
 * {@link spliceReadmeBadges} can swap the whole region in one slice and the marker text lives in one place.
 */
export function renderStatsBadges(stats: DocStats): string {
  const endpoints = `https://img.shields.io/badge/store%20API-${stats.operations}%20endpoints-8957e5?logo=apple&logoColor=white`;
  const crud = "https://img.shields.io/badge/CRUD-full%20lifecycle-1f6feb";
  const tests = `https://img.shields.io/badge/tests-${stats.tests}%20passing-3fb950?logo=vitest&logoColor=white`;
  return [
    STATS_BADGES_START,
    "",
    '<p align="center">',
    `  <a href="./docs/commands.md"><img src="${endpoints}" alt="${stats.operations} App Store Connect &amp; Google Play API operations" /></a>`,
    `  <img src="${crud}" alt="Full create / read / update / delete coverage across the store APIs" />`,
    `  <a href="https://github.com/YosefHayim/launch-store/actions/workflows/ci.yml"><img src="${tests}" alt="${stats.tests} tests passing" /></a>`,
    "</p>",
    "",
    STATS_BADGES_END,
  ].join("\n");
}

/**
 * Splice a freshly {@link renderStatsBadges rendered} badge row into an existing README, replacing the
 * whole fenced region. Throws if the fences are missing rather than silently appending — a missing
 * marker means the README was edited in a way that would drop the generated badges, and the build
 * should fail loudly so it gets fixed.
 */
export function spliceReadmeBadges(readme: string, badges: string): string {
  const start = readme.indexOf(STATS_BADGES_START);
  const end = readme.indexOf(STATS_BADGES_END);
  if (start === -1 || end === -1) {
    throw new Error(
      "README.md is missing the stats-badges markers — add the <!-- stats-badges:start/end --> fences back so `docs:gen` can regenerate the badge row.",
    );
  }
  return readme.slice(0, start) + badges + readme.slice(end + STATS_BADGES_END.length);
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
