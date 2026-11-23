// Prints the Launch config schema, checks a config file, or prints the field guide.

import { readFile, writeFile } from 'node:fs/promises';
import { renderConfigDocs } from '../docs/config-docs.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type { LaunchConfig } from '../types/config.ts';
import { findLaunchConfig } from './config.ts';
import { loadConfigSchema, validateConfig } from './config-schema.ts';
import { checkConfigSemantics } from './config-semantics.ts';
import type { SchemaViolation } from './json-schema.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type SchemaCommandInput = Readonly<{ operation: 'schema'; out?: string }>;

type ValidateCommandInput = Readonly<{ operation: 'validate'; file?: string }>;

type DocsCommandInput = Readonly<{ operation: 'docs' }>;

type ConfigCommandInput = SchemaCommandInput | ValidateCommandInput | DocsCommandInput;

type ConfigCommandFailure = Readonly<{
  _tag: 'ConfigCommandFailure';
  operation: string;
  message: string;
  cause?: unknown;
}>;

function optionalString(record: Record<string, unknown>, fieldName: string): string | undefined {
  if (fieldName in record == false) {
    return undefined;
  }

  const field = record[fieldName];
  const isMissing = field == null;

  if (isMissing) {
    return undefined;
  }

  if (typeof field != 'string') {
    throw new Error(`config command ${fieldName} must be a string`);
  }

  return field;
}

function decodeSchemaCommand(record: Record<string, unknown>): SchemaCommandInput {
  const out = optionalString(record, 'out');

  if (out == null) {
    return { operation: 'schema' };
  }

  return { operation: 'schema', out };
}

function decodeValidateCommand(record: Record<string, unknown>): ValidateCommandInput {
  const file = optionalString(record, 'file');

  if (file == null) {
    return { operation: 'validate' };
  }

  return { operation: 'validate', file };
}

export function ConfigCommandInputSchema(rawCommandInput: unknown): ConfigCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject != null) {
    return decodeConfigCommandInput(rawCommandInputObject);
  }

  throw new Error('config command input must be an object');
}

function decodeConfigCommandInput(rawCommandInput: Record<string, unknown>): ConfigCommandInput {
  const operation = rawCommandInput['operation'];

  if (operation == 'schema') {
    return decodeSchemaCommand(rawCommandInput);
  }

  if (operation == 'validate') {
    return decodeValidateCommand(rawCommandInput);
  }

  if (operation == 'docs') {
    return { operation: 'docs' };
  }

  throw new Error('Unknown config command operation.');
}

function reportViolations(violations: SchemaViolation[], source: string): boolean {
  const logger = createLogger(false);

  const isValid = violations.length == 0;

  if (isValid) {
    logger.box('Config valid', [`[OK] ${source} matches the schema`]);

    return true;
  }

  for (const violation of violations) {
    let violationPath = violation.path;

    const pathIsEmpty = violationPath.length == 0;

    if (pathIsEmpty) {
      violationPath = '(root)';
    }

    logger.warn(`${violationPath}: ${violation.message}`);
  }

  logger.gap();

  let problemSuffix = 's';

  const isOneProblem = violations.length == 1;

  if (isOneProblem) {
    problemSuffix = '';
  }

  logger.error(`${violations.length} problem${problemSuffix} in ${source}.`);

  return false;
}

function reportSemantics(config: LaunchConfig): void {
  const semanticIssues = checkConfigSemantics(config);

  const hasNoIssues = semanticIssues.length == 0;

  if (hasNoIssues) {
    return;
  }

  const logger = createLogger(false);

  logger.gap();

  for (const semanticIssue of semanticIssues) {
    logger.warn(`${semanticIssue.path}: ${semanticIssue.message}`);
  }

  logger.gap();

  let warningSuffix = 's';

  const isOneWarning = semanticIssues.length == 1;

  if (isOneWarning) {
    warningSuffix = '';
  }

  logger.tip(
    `${semanticIssues.length} semantic warning${warningSuffix} (not schema errors - exit 0).`,
  );
}

async function showSchema(commandInput: SchemaCommandInput): Promise<void> {
  const configSchema = loadConfigSchema();
  const schemaJson = JSON.stringify(configSchema, null, 2);
  const logger = createLogger(false);

  if (commandInput.out == null) {
    logger.line(schemaJson);

    return;
  }

  await writeFile(commandInput.out, `${schemaJson}\n`);
  logger.box('Schema written', [
    `[OK] wrote ${commandInput.out}`,
    'Reference it via a `$schema` key or editor setting for autocomplete and validation.',
  ]);
}

async function validateConfiguration(commandInput: ValidateCommandInput): Promise<void> {
  if (commandInput.file == null) {
    const launchDirectories = readLaunchDirectories();
    const foundConfig = await findLaunchConfig(launchDirectories.workingDirectory);

    if (foundConfig == null) {
      throw {
        _tag: 'ConfigCommandFailure',
        operation: 'find Launch config',
        message:
          'No launch.config.{ts,mjs,js} in this directory. Pass a .json file, or run `launch-store init` first.',
      } satisfies ConfigCommandFailure;
    }

    const violations = validateConfig(foundConfig.config);

    const configIsValid = reportViolations(violations, foundConfig.path);

    if (configIsValid) {
      reportSemantics(foundConfig.config);
    }

    if (configIsValid == false) {
      completeCommand(1);
    }

    return;
  }

  const isJsonFile = commandInput.file.endsWith('.json');

  if (isJsonFile == false) {
    throw {
      _tag: 'ConfigCommandFailure',
      operation: 'validate Launch config',
      message:
        '`launch-store config validate` takes a .json file, or no argument to validate launch.config.ts.',
    } satisfies ConfigCommandFailure;
  }

  const configText = await readFile(commandInput.file, 'utf8');
  const parsedConfig: unknown = JSON.parse(configText);
  const validate = validateConfig(parsedConfig);
  const configIsValid = reportViolations(validate, commandInput.file);

  if (configIsValid == false) {
    completeCommand(1);
  }
}

function configCommandFailure(cause: unknown): ConfigCommandFailure {
  return {
    _tag: 'ConfigCommandFailure',
    operation: 'run config command',
    message: errorMessage(cause),
    cause,
  };
}

export async function configCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = ConfigCommandInputSchema(rawCommandInput);

    switch (commandInput.operation) {
      case 'schema':
        await showSchema(commandInput);
        return;
      case 'validate':
        await validateConfiguration(commandInput);
        return;
      case 'docs': {
        const loadSchema = loadConfigSchema();
        createLogger(false).line(renderConfigDocs(loadSchema).trimEnd());
        return;
      }
    }
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    throw configCommandFailure(cause);
  }
}
