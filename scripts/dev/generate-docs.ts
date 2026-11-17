import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { Effect, JSONSchema, Schema } from 'effect';
import { buildProgram } from '@cli/program.ts';
import { renderContributorSkills } from '@core/agents/render.ts';
import { LaunchConfigEffectSchema } from '@core/config/schema.ts';
import { countTestCases } from '@core/docs/commandDocs/common.ts';
import { makeAppStoreConnectApi } from '@/app-store-connect-api/app-store-connect-api.ts';
import { makePlayConsoleApi } from '@/play-console-api/play-console-api.ts';
import { renderLlmsFullTxt, renderLlmsTxt } from '@core/docs/commandDocs/llmsTxt.ts';
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
const isFunction = (member: unknown): boolean => typeof member === 'function';
const computeStats = (commands: CommandSpec[]): DocStats => {
  const appleOperations = Object.values(
    makeAppStoreConnectApi({ keyId: 'placeholder', issuerId: 'placeholder', p8: 'placeholder' }),
  ).filter(isFunction);
  const playOperations = Object.values(
    makePlayConsoleApi({
      clientEmail: 'placeholder@example.com',
      privateKey: 'placeholder',
      tokenUri: 'https://oauth2.googleapis.com/token',
    }),
  ).filter(isFunction);
  const operations = appleOperations.length + playOperations.length;
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
  let readmeText = Effect.runSync(
    spliceReadmeBadges(readFileSync(join(ROOT, 'README.md'), 'utf8'), badges),
  );
  readmeText = Effect.runSync(spliceReadmeAgentSkills(readmeText, agentSkills));
  readmeText = Effect.runSync(spliceReadmeFaq(readmeText, faq));
  readmeText = Effect.runSync(spliceReadmeFeatures(readmeText, features));
  const generatedDocuments: GeneratedDoc[] = [
    { path: 'README.md', body: readmeText },
    { path: 'llms.txt', body: renderLlmsTxt(commands, stats) },
    { path: 'llms-full.txt', body: renderLlmsFullTxt(commands, stats) },
    {
      path: 'schema/launch.config.schema.json',
      body: `${JSON.stringify(configSchema, null, 2)}\n`,
    },
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
