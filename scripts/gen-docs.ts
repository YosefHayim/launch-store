/**
 * `npm run docs:gen` — regenerate the committed, generated docs from the live CLI definition:
 * `docs/commands.md` and `llms.txt`. `npm run docs:check` runs the same generation
 * and fails if any committed file is stale (the per-PR freshness gate in ci.yml), mirroring how
 * `scripts/gen-asc-types.ts` + the schema-drift workflow keep the ASC types honest.
 *
 * This file is just I/O orchestration (not built or linted): it introspects the commander tree from
 * `src/cli/program.ts`, counts the headline stats from source, then hands the pure rendering to
 * `src/core/docs/commandDocs.ts`. The renderers emit canonical output, so the docs are written and
 * diffed verbatim — Biome owns source formatting and never touches these generated files.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { z } from 'zod';
import { buildProgram } from '../src/cli/program.ts';
import { renderContributorRules, renderContributorSkills } from '../src/core/agents/render.ts';
import {
  type CommandSpec,
  countAsyncMethods,
  countTestCases,
  type DocStats,
  type GeneratedDoc,
  renderAgentSkillsRegion,
  renderCommandReference,
  renderFaqRegion,
  renderFeaturesRegion,
  renderLlmsTxt,
  renderStatsBadges,
  spliceReadmeAgentSkills,
  spliceReadmeBadges,
  spliceReadmeFaq,
  spliceReadmeFeatures,
} from '../src/core/docs/commandDocs.ts';
import { renderConfigDocs } from '../src/core/docs/configDocs.ts';
import type { JsonSchema } from '../src/core/jsonSchema.ts';
import { LaunchConfigSchema } from '../src/core/types/config.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Flatten one commander command (and its subcommands) into the {@link CommandSpec} the docs render.
 * Hidden subcommands (e.g. the `completion __complete` shell callback) are skipped via commander's own
 * `visibleCommands`, so an internal-only command never leaks into the public reference or `llms.txt`.
 */
function toSpec(command: Command, parentPath: string): CommandSpec {
  const path = parentPath ? `${parentPath} ${command.name()}` : command.name();
  const args = command.registeredArguments
    .map((argument) => {
      const inner = argument.variadic ? `${argument.name()}...` : argument.name();
      return argument.required ? `<${inner}>` : `[${inner}]`;
    })
    .join(' ');
  const options = command.options
    .filter((option) => !(option.flags.includes('--help') || option.flags.includes('--version')))
    .map((option) => ({ flags: option.flags, description: option.description }));
  const subcommands = command
    .createHelp()
    .visibleCommands(command)
    .map((sub) => toSpec(sub, path));
  return { path, args, description: command.description(), options, subcommands };
}

/** Read every `*.test.ts` under `src/` so the test-case count reflects the real suite. */
function readTestSources(): string[] {
  return readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => readFileSync(join(ROOT, 'src', entry), 'utf8'));
}

/** Compute the live headline stats: command count, store-API operations, and test cases. */
function computeStats(commands: CommandSpec[]): DocStats {
  const operations =
    countAsyncMethods(readFileSync(join(ROOT, 'src/apple/ascClient.ts'), 'utf8')) +
    countAsyncMethods(readFileSync(join(ROOT, 'src/google/playClient.ts'), 'utf8'));
  return { commands: commands.length, operations, tests: countTestCases(readTestSources()) };
}

/**
 * Generate the JSON Schema for `launch.config.ts` straight from the config SSOT — the zod
 * {@link LaunchConfigSchema} (ADR 0008). `io: 'input'` emits the authoring shape (provider names optional,
 * so only `profiles` is required, matching what `defineConfig` accepts); `target: 'draft-7'` keeps the
 * committed schema in the dialect it has always shipped, so editors and the `configDocs` renderer are
 * unaffected. Every `.meta({ id })` on a nested object becomes a named `definitions` entry the reference
 * tables, and every `.describe(...)` becomes a `description` — so the schema, the field reference, and
 * runtime validation are one source `docs:check` keeps honest.
 */
function generateConfigSchema(): JsonSchema {
  return z.toJSONSchema(LaunchConfigSchema, { target: 'draft-7', io: 'input' }) as JsonSchema;
}

/** Render every generated doc from the live program, ready to write or diff verbatim. */
function generateDocs(): GeneratedDoc[] {
  const commands = buildProgram().commands.map((command) => toSpec(command, ''));
  const configSchema = generateConfigSchema();
  const stats = computeStats(commands);
  const badges = renderStatsBadges(stats);
  const agentSkills = renderAgentSkillsRegion();
  const faq = renderFaqRegion();
  const features = renderFeaturesRegion();
  const readmes = readdirSync(ROOT)
    .filter((file) => /^README.*\.md$/.test(file))
    .sort();
  const raw: GeneratedDoc[] = [
    ...readmes.map((path) => {
      // The live-stats badge row and the agent-skills callout are language-neutral, so both blocks are
      // spliced into every README; the FAQ and numbered Features list are English sources, so only
      // README.md gets those generated regions — the translated READMEs keep hand-translated FAQ and
      // Features sections that the structural-parity test holds in sync.
      let body = spliceReadmeBadges(readFileSync(join(ROOT, path), 'utf8'), badges);
      body = spliceReadmeAgentSkills(body, agentSkills);
      if (path === 'README.md') {
        body = spliceReadmeFaq(body, faq);
        body = spliceReadmeFeatures(body, features);
      }
      return { path, body };
    }),
    { path: 'docs/commands.md', body: renderCommandReference(commands, stats) },
    { path: 'llms.txt', body: renderLlmsTxt(commands, stats) },
    // The JSON Schema for `launch.config.ts` and its rendered field reference — both generated from the
    // config types so `config schema`/`config validate`/`config docs` and editor autocomplete share one
    // source the types can't drift from.
    {
      path: 'schema/launch.config.schema.json',
      body: `${JSON.stringify(configSchema, null, 2)}\n`,
    },
    { path: 'docs/config.md', body: renderConfigDocs(configSchema) },
    // Contributor-facing Cursor rules (`.cursor/rules/*.mdc`) and Claude skills (`.claude/skills/*`) for
    // working ON launch-store — generated from the same agent registry as the consumer skills and gated
    // here so they can't drift.
    ...renderContributorRules().map((rule) => ({ path: rule.path, body: rule.body })),
    ...renderContributorSkills().map((skill) => ({ path: skill.path, body: skill.body })),
  ];
  return raw;
}

function main(): void {
  const check = process.argv.includes('--check');
  const docs = generateDocs();
  const stale: string[] = [];
  for (const { path, body } of docs) {
    const absolute = join(ROOT, path);
    if (check) {
      const current = readFileSync(absolute, 'utf8');
      if (current !== body) {
        stale.push(path);
      }
    } else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body);
      process.stdout.write(`Wrote ${path}\n`);
    }
  }
  if (check && stale.length > 0) {
    process.stderr.write(
      `Generated docs are stale: ${stale.join(', ')}. Run \`npm run docs:gen\` and commit the result.\n`,
    );
    process.exit(1);
  }
  if (check) {
    process.stdout.write('Docs are in sync with the CLI.\n');
  }
}

main();
