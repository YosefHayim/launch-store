import { FileSystem, type Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { renderConfigDocs } from '../docs/configDocs.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { LaunchConfig } from '../types/config.js';
import { findLaunchConfig } from './config.js';
import { loadConfigSchema, validateConfig } from './configSchema.js';
import { checkConfigSemantics } from './configSemantics.js';
import type { SchemaViolation } from './jsonSchema.js';

export const ConfigCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('schema'),
    out: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    operation: Schema.Literal('validate'),
    file: Schema.optional(Schema.String),
  }),
  Schema.Struct({ operation: Schema.Literal('docs') }),
);

export type ConfigCommandInput = Schema.Schema.Type<typeof ConfigCommandInputSchema>;

export type ConfigCommandFailure = Readonly<{
  readonly _tag: 'ConfigCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeConfigCommandFailure = Data.tagged<ConfigCommandFailure>('ConfigCommandFailure');

type ConfigCommandRequirements = FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path;

/** Render schema violations and return whether the document is valid. */
const reportViolations = (
  violations: SchemaViolation[],
  source: string,
): Effect.Effect<boolean, unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    if (violations.length === 0) {
      yield* logger.box('Config valid', [`[OK] ${source} matches the schema`]);
      return true;
    }
    for (const violation of violations) {
      let violationPath = violation.path;
      if (violationPath.length === 0) violationPath = '(root)';
      yield* logger.warn(`${violationPath}: ${violation.message}`);
    }
    yield* logger.gap();
    let problemSuffix = 's';
    if (violations.length === 1) problemSuffix = '';
    yield* logger.error(`${violations.length} problem${problemSuffix} in ${source}.`);
    return false;
  });

/** Render non-failing cross-field advisories after shape validation succeeds. */
const reportSemantics = (config: LaunchConfig): Effect.Effect<void, unknown, Logger> =>
  Effect.gen(function* () {
    const semanticIssues = checkConfigSemantics(config);
    if (semanticIssues.length === 0) return;
    const logger = yield* createLogger(false);
    yield* logger.gap();
    for (const semanticIssue of semanticIssues) {
      yield* logger.warn(`${semanticIssue.path}: ${semanticIssue.message}`);
    }
    yield* logger.gap();
    let warningSuffix = 's';
    if (semanticIssues.length === 1) warningSuffix = '';
    yield* logger.tip(
      `${semanticIssues.length} semantic warning${warningSuffix} (not schema errors - exit 0).`,
    );
  });

/** Print or write the generated Launch config JSON Schema. */
const showSchema = (
  commandInput: Extract<ConfigCommandInput, { operation: 'schema' }>,
): Effect.Effect<void, unknown, ConfigCommandRequirements> =>
  Effect.gen(function* () {
    const configSchema = yield* loadConfigSchema();
    const schemaJson = JSON.stringify(configSchema, null, 2);
    const logger = yield* createLogger(false);
    if (commandInput.out === undefined) {
      yield* logger.line(schemaJson);
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(commandInput.out, `${schemaJson}\n`);
    yield* logger.box('Schema written', [
      `[OK] wrote ${commandInput.out}`,
      'Reference it via a `$schema` key or editor setting for autocomplete and validation.',
    ]);
  });

/** Validate a JSON document or the discovered launch.config file. */
const validateConfiguration = (
  commandInput: Extract<ConfigCommandInput, { operation: 'validate' }>,
): Effect.Effect<void, CommandExit | unknown, ConfigCommandRequirements> =>
  Effect.gen(function* () {
    if (commandInput.file === undefined) {
      const launchPaths = yield* LaunchPaths;
      const foundConfig = yield* findLaunchConfig(launchPaths.workingDirectory);
      if (foundConfig === null) {
        return yield* Effect.fail(
          makeConfigCommandFailure({
            operation: 'find Launch config',
            message:
              'No launch.config.{ts,mjs,js} in this directory. Pass a .json file, or run `launch init` first.',
          }),
        );
      }
      const violations = validateConfig(foundConfig.config);
      const configIsValid = yield* reportViolations(violations, foundConfig.path);
      if (configIsValid) yield* reportSemantics(foundConfig.config);
      if (!configIsValid) yield* completeCommand(1);
      return;
    }
    if (!commandInput.file.endsWith('.json')) {
      return yield* Effect.fail(
        makeConfigCommandFailure({
          operation: 'validate Launch config',
          message:
            '`launch config validate` takes a .json file, or no argument to validate launch.config.ts.',
        }),
      );
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const configText = yield* fileSystem.readFileString(commandInput.file);
    const parsedConfig = yield* Schema.decode(Schema.parseJson())(configText);
    const configIsValid = yield* reportViolations(validateConfig(parsedConfig), commandInput.file);
    if (!configIsValid) yield* completeCommand(1);
  });

/** Run one schema-decoded config schema, validation, or docs operation. */
export const configCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | ConfigCommandFailure, ConfigCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(ConfigCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'schema':
        return yield* showSchema(commandInput);
      case 'validate':
        return yield* validateConfiguration(commandInput);
      case 'docs': {
        const logger = yield* createLogger(false);
        const configSchema = yield* loadConfigSchema();
        return yield* logger.line(renderConfigDocs(configSchema).trimEnd());
      }
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      return makeConfigCommandFailure({
        operation: 'run config command',
        message: errorMessage(cause),
        cause,
      });
    }),
  );
