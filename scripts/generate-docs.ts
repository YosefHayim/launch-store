import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Argument, Command, Option } from 'commander';
import { Effect, JSONSchema, Schema } from 'effect';
import { buildProgram } from '@cli/program.ts';
import { renderContributorSkills } from '@core/agents/render.ts';
import { type JsonSchema, JsonSchemaNode } from '@core/config/jsonSchema.ts';
import { LaunchConfigEffectSchema } from '@core/config/schema.ts';
import { countAsyncMethods, countTestCases } from '@core/docs/commandDocs/common.ts';
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
import type { CommandSpec, DocStats, GeneratedDoc } from '@core/types/commandDocs.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function commandWords(command: Command, parentWords: string): string {
  const isTopLevel = parentWords == '';

  if (isTopLevel) {
    return command.name();
  }

  return `${parentWords} ${command.name()}`;
}

function argumentWord(argument: Argument): string {
  const isVariadic = argument.variadic;

  if (isVariadic) {
    return `${argument.name()}...`;
  }

  return argument.name();
}

function argumentLabel(argument: Argument): string {
  const word = argumentWord(argument);
  const isRequired = argument.required;

  if (isRequired) {
    return `<${word}>`;
  }

  return `[${word}]`;
}

// Commander's own -V/--version, not a domain flag such as --version <value>.
function isPackageVersionFlag(flags: string): boolean {
  return /(?:^|[\s,])--version$/.test(flags.trim());
}

function keepDomainOption(option: Option): boolean {
  const isHelp = option.flags.includes('--help');

  if (isHelp) {
    return false;
  }

  const isPackageVersion = isPackageVersionFlag(option.flags);

  if (isPackageVersion) {
    return false;
  }

  return true;
}

function readOption(option: Option): { flags: string; description: string } {
  return { flags: option.flags, description: option.description };
}

function readCommand(command: Command, parentWords: string): CommandSpec {
  const words = commandWords(command, parentWords);
  const usageArguments = command.registeredArguments.map(argumentLabel).join(' ');
  const options = command.options.filter(keepDomainOption).map(readOption);

  function readChild(child: Command): CommandSpec {
    return readCommand(child, words);
  }

  const visibleCommands = command.createHelp().visibleCommands(command);
  const subcommands = visibleCommands.map(readChild);

  return {
    path: words,
    args: usageArguments,
    description: command.description(),
    options,
    subcommands,
  };
}

function readTestSources(): string[] {
  const sourceNames = readdirSync(join(repoRoot, 'src'), { recursive: true, encoding: 'utf8' });

  function isTestFile(sourceName: string): boolean {
    return sourceName.endsWith('.test.ts');
  }

  function readTestFile(sourceName: string): string {
    return readFileSync(join(repoRoot, 'src', sourceName), 'utf8');
  }

  return sourceNames.filter(isTestFile).map(readTestFile);
}

function countCommands(commands: readonly CommandSpec[]): DocStats {
  const appleClient = readFileSync(join(repoRoot, 'src/apple/ascClient.ts'), 'utf8');
  const playClient = readFileSync(join(repoRoot, 'src/google/playClient.ts'), 'utf8');
  const operations = countAsyncMethods(appleClient) + countAsyncMethods(playClient);

  return {
    commands: commands.length,
    operations,
    tests: countTestCases(readTestSources()),
  };
}

function readConfigSchema(): JsonSchema {
  const effectSchema = JSONSchema.make(LaunchConfigEffectSchema);
  const schemaText = JSON.stringify(effectSchema);
  const withDefinitionsKey = schemaText
    .replaceAll('"$defs"', '"definitions"')
    .replaceAll('#/$defs/', '#/definitions/');

  return Schema.decodeUnknownSync(Schema.parseJson(JsonSchemaNode))(withDefinitionsKey);
}

function refreshReadme(stats: DocStats): string {
  const currentReadme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
  const withBadges = Effect.runSync(spliceReadmeBadges(currentReadme, renderStatsBadges(stats)));
  const withSkills = Effect.runSync(spliceReadmeAgentSkills(withBadges, renderAgentSkillsRegion()));
  const faqRegion = Effect.runSync(renderFaqRegion());
  const withFaq = Effect.runSync(spliceReadmeFaq(withSkills, faqRegion));

  return Effect.runSync(spliceReadmeFeatures(withFaq, renderFeaturesRegion()));
}

function readTopLevel(command: Command): CommandSpec {
  return readCommand(command, '');
}

function readSkill(skill: { path: string; body: string }): GeneratedDoc {
  return { path: skill.path, body: skill.body };
}

function collectDocuments(): GeneratedDoc[] {
  const commands = buildProgram().commands.map(readTopLevel);
  const stats = countCommands(commands);
  const skillDocuments = renderContributorSkills().map(readSkill);

  return [
    { path: 'README.md', body: refreshReadme(stats) },
    {
      path: 'schema/launch.config.schema.json',
      body: `${JSON.stringify(readConfigSchema(), null, 2)}\n`,
    },
    ...skillDocuments,
  ];
}

function writeOrCheck(documents: readonly GeneratedDoc[], checkOnly: boolean): void {
  const stalePaths: string[] = [];

  for (const document of documents) {
    const absolutePath = join(repoRoot, document.path);
    const isWriting = checkOnly == false;

    if (isWriting) {
      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, document.body);
      process.stdout.write(`Wrote ${document.path}\n`);
      continue;
    }

    const currentText = readFileSync(absolutePath, 'utf8');
    const isStale = currentText != document.body;

    if (isStale) {
      stalePaths.push(document.path);
    }
  }

  const hasStaleDocuments = stalePaths.length > 0;

  if (hasStaleDocuments) {
    process.stderr.write(
      `Generated docs are stale: ${stalePaths.join(', ')}. Run \`pnpm docs:gen\` and commit the result.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    process.stdout.write('Docs are in sync with the CLI.\n');
  }
}

const checkOnly = process.argv.includes('--check');
writeOrCheck(collectDocuments(), checkOnly);
