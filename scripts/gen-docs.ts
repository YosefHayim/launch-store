/**
 * `npm run docs:gen` — regenerate the committed, generated docs from the live CLI definition:
 * `docs/commands.md` and `llms.txt`. `npm run docs:check` runs the same generation
 * and fails if any committed file is stale (the per-PR freshness gate in ci.yml), mirroring how
 * `scripts/gen-asc-types.ts` + the schema-drift workflow keep the ASC types honest.
 *
 * This file is just I/O orchestration (not built or linted): it introspects the commander tree from
 * `src/cli/program.ts`, counts the headline stats from source, then hands the pure rendering to
 * `src/core/docs/commandDocs.ts` and prettier-formats the result so `format:check` stays green.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import prettier from "prettier";
import { buildProgram } from "../src/cli/program.js";
import {
  type CommandSpec,
  type DocStats,
  type GeneratedDoc,
  countAsyncMethods,
  countTestCases,
  renderAgentSkillsRegion,
  renderCommandReference,
  renderFaqRegion,
  renderLlmsTxt,
  renderStatsBadges,
  spliceReadmeAgentSkills,
  spliceReadmeBadges,
  spliceReadmeFaq,
} from "../src/core/docs/commandDocs.js";
import { renderContributorRules } from "../src/core/agents/render.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Flatten one commander command (and its subcommands) into the {@link CommandSpec} the docs render. */
function toSpec(command: Command, parentPath: string): CommandSpec {
  const path = parentPath ? `${parentPath} ${command.name()}` : command.name();
  const args = command.registeredArguments
    .map((argument) => {
      const inner = argument.variadic ? `${argument.name()}...` : argument.name();
      return argument.required ? `<${inner}>` : `[${inner}]`;
    })
    .join(" ");
  const options = command.options
    .filter((option) => !option.flags.includes("--help") && !option.flags.includes("--version"))
    .map((option) => ({ flags: option.flags, description: option.description }));
  const subcommands = command.commands.map((sub) => toSpec(sub, path));
  return { path, args, description: command.description(), options, subcommands };
}

/** Read every `*.test.ts` under `src/` so the test-case count reflects the real suite. */
function readTestSources(): string[] {
  return readdirSync(join(ROOT, "src"), { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".test.ts"))
    .map((entry) => readFileSync(join(ROOT, "src", entry), "utf8"));
}

/** Compute the live headline stats: command count, store-API operations, and test cases. */
function computeStats(commands: CommandSpec[]): DocStats {
  const operations =
    countAsyncMethods(readFileSync(join(ROOT, "src/apple/ascClient.ts"), "utf8")) +
    countAsyncMethods(readFileSync(join(ROOT, "src/google/playClient.ts"), "utf8"));
  return { commands: commands.length, operations, tests: countTestCases(readTestSources()) };
}

/** Render both docs from the live program, prettier-formatted and ready to write or diff. */
async function generateDocs(): Promise<GeneratedDoc[]> {
  const commands = buildProgram().commands.map((command) => toSpec(command, ""));
  const stats = computeStats(commands);
  const badges = renderStatsBadges(stats);
  const agentSkills = renderAgentSkillsRegion();
  const faq = renderFaqRegion();
  const readmes = readdirSync(ROOT)
    .filter((file) => /^README.*\.md$/.test(file))
    .sort();
  const raw: GeneratedDoc[] = [
    ...readmes.map((path) => {
      // The live-stats badge row and the agent-skills callout are language-neutral, so both blocks are
      // spliced into every README; the FAQ source is English, so only README.md gets the generated FAQ
      // region — the translated READMEs keep a hand-translated FAQ the structural-parity test holds in sync.
      let body = spliceReadmeBadges(readFileSync(join(ROOT, path), "utf8"), badges);
      body = spliceReadmeAgentSkills(body, agentSkills);
      if (path === "README.md") body = spliceReadmeFaq(body, faq);
      return { path, body };
    }),
    { path: "docs/commands.md", body: renderCommandReference(commands, stats) },
    { path: "llms.txt", body: renderLlmsTxt(commands, stats) },
    // Contributor-facing Cursor rules (`.cursor/rules/*.mdc`) for working ON launch-store — generated
    // from the same agent registry as the consumer skills and gated here so they can't drift.
    ...renderContributorRules().map((rule) => ({ path: rule.path, body: rule.body })),
  ];
  return Promise.all(
    raw.map(async ({ path, body }) => {
      const config = await prettier.resolveConfig(join(ROOT, path));
      return { path, body: await prettier.format(body, { ...config, parser: "markdown" }) };
    }),
  );
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const docs = await generateDocs();
  const stale: string[] = [];
  for (const { path, body } of docs) {
    const absolute = join(ROOT, path);
    if (check) {
      const current = readFileSync(absolute, "utf8");
      if (current !== body) stale.push(path);
    } else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, body);
      process.stdout.write(`Wrote ${path}\n`);
    }
  }
  if (check && stale.length > 0) {
    process.stderr.write(
      `Generated docs are stale: ${stale.join(", ")}. Run \`npm run docs:gen\` and commit the result.\n`,
    );
    process.exit(1);
  }
  if (check) process.stdout.write("Docs are in sync with the CLI.\n");
}

await main();
