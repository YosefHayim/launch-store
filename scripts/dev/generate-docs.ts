import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { Effect, JSONSchema, Schema } from 'effect';
import { buildProgram } from '@cli/program.ts';
import { renderContributorRules, renderContributorSkills } from '@core/agents/render.ts';
import { LaunchConfigEffectSchema } from '@core/config/schema.ts';
import { renderCommandReference } from '@core/docs/commandDocs/commandReference.ts';
import { countAsyncMethods, countTestCases } from '@core/docs/commandDocs/common.ts';
import { renderLlmsTxt } from '@core/docs/commandDocs/llmsTxt.ts';
import {
  renderAgentSkillsRegion,
  renderFaqRegion,
  renderFeaturesRegion,
  renderStatsBadges,
  spliceReadmeAgentSkills,
  spliceReadmeBadges,
  spliceReadmeFaq,
  spliceReadmeFeatures,
} from '@core/docs/commandDocs/readme.ts';
import { renderConfigDocs } from '@core/docs/configDocs.ts';
import { type JsonSchema, JsonSchemaNode } from '@core/config/jsonSchema.ts';
import type { CommandSpec, DocStats, GeneratedDoc } from '@core/types/commandDocs.ts';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const toSpec = (command: Command, parentPath: string): CommandSpec => {
  let path = command.name();
  if (parentPath) path = `${parentPath} ${command.name()}`;
  const args = command.registeredArguments
    .map((argument) => {
      let argumentName = argument.name();
      if (argument.variadic) argumentName = `${argumentName}...`;
      if (argument.required) return `<${argumentName}>`;
      return `[${argumentName}]`;
    })
    .join(' ');
  const options = command.options
    .filter((option) => {
      if (option.flags.includes('--help')) return false;
      // Drop only Commander's bare package-version option (`-V, --version`), not
      // `--version <value>` or `--version-code <code>` domain flags.
      if (/(?:^|[\s,])--version$/.test(option.flags.trim())) return false;
      return true;
    })
    .map((option) => ({ flags: option.flags, description: option.description }));
  const subcommands = command
    .createHelp()
    .visibleCommands(command)
    .map((sub) => toSpec(sub, path));
  return { path, args, description: command.description(), options, subcommands };
};
const readTestSources = (): string[] => {
  return readdirSync(join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.test.ts'))
    .map((entry) => readFileSync(join(ROOT, 'src', entry), 'utf8'));
};
const computeStats = (commands: CommandSpec[]): DocStats => {
  const operations =
    countAsyncMethods(readFileSync(join(ROOT, 'src/apple/ascClient.ts'), 'utf8')) +
    countAsyncMethods(readFileSync(join(ROOT, 'src/google/playClient.ts'), 'utf8'));
  return { commands: commands.length, operations, tests: countTestCases(readTestSources()) };
};
// Effect emits `$defs`; Launch publishes the equivalent draft-07 `definitions` spelling.
const normalizeEffectJsonSchema = (effectJsonSchema: unknown): JsonSchema => {
  const schemaText = JSON.stringify(effectJsonSchema);
  const withDefinitionsKey = schemaText
    .replaceAll('"$defs"', '"definitions"')
    .replaceAll('#/$defs/', '#/definitions/');
  return Schema.decodeUnknownSync(Schema.parseJson(JsonSchemaNode))(withDefinitionsKey);
};

const generateConfigSchema = (): JsonSchema => {
  return normalizeEffectJsonSchema(JSONSchema.make(LaunchConfigEffectSchema));
};

const generateDocs = (): GeneratedDoc[] => {
  const commands = buildProgram().commands.map((command) => toSpec(command, ''));
  const configSchema = generateConfigSchema();
  const stats = computeStats(commands);
  const badges = renderStatsBadges(stats);
  const agentSkills = renderAgentSkillsRegion();
  const faq = Effect.runSync(renderFaqRegion());
  const features = renderFeaturesRegion();
  const readmes = readdirSync(ROOT)
    .filter((file) => /^README.*\.md$/.test(file))
    .sort();
  const generatedDocuments: GeneratedDoc[] = [
    ...readmes.map((path) => {
      let documentText = Effect.runSync(
        spliceReadmeBadges(readFileSync(join(ROOT, path), 'utf8'), badges),
      );
      documentText = Effect.runSync(spliceReadmeAgentSkills(documentText, agentSkills));
      if (path === 'README.md') {
        documentText = Effect.runSync(spliceReadmeFaq(documentText, faq));
        documentText = Effect.runSync(spliceReadmeFeatures(documentText, features));
      }
      return { path, body: documentText };
    }),
    { path: 'docs/commands.md', body: renderCommandReference(commands, stats) },
    { path: 'llms.txt', body: renderLlmsTxt(commands, stats) },
    {
      path: 'schema/launch.config.schema.json',
      body: `${JSON.stringify(configSchema, null, 2)}\n`,
    },
    { path: 'docs/config.md', body: renderConfigDocs(configSchema) },
    ...renderContributorRules().map((rule) => ({ path: rule.path, body: rule.body })),
    ...renderContributorSkills().map((skill) => ({ path: skill.path, body: skill.body })),
  ];
  return generatedDocuments;
};
const main = (): void => {
  const check = process.argv.includes('--check');
  const docs = generateDocs();
  const stale: string[] = [];
  for (const generatedDocument of docs) {
    const { path } = generatedDocument;
    const documentText = generatedDocument.body;
    const absolute = join(ROOT, path);
    if (check) {
      const current = readFileSync(absolute, 'utf8');
      if (current !== documentText) {
        stale.push(path);
      }
    } else {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, documentText);
      process.stdout.write(`Wrote ${path}\n`);
    }
  }
  if (check && stale.length > 0) {
    process.stderr.write(
      `Generated docs are stale: ${stale.join(', ')}. Run \`pnpm docs:gen\` and commit the result.\n`,
    );
    process.exit(1);
  }
  if (check) {
    process.stdout.write('Docs are in sync with the CLI.\n');
  }
};
main();
