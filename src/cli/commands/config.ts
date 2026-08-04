import type { Command } from 'commander';
import { configCommandProgram } from '@core/config/configCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type SchemaOptions = Readonly<{ out?: string }>;

/** Attach config schema, validation, and reference commands to Commander. */
export const registerConfigCommand = (program: Command): void => {
  const configCommand = program
    .command('config')
    .description(
      'work with launch.config.ts - emit JSON Schema, validate a config, or print the field reference',
    );

  configCommand
    .command('schema')
    .description('print the JSON Schema for launch.config.ts')
    .option('--out <file>', 'write the schema to this file instead of stdout')
    .action((commandOptions: SchemaOptions) =>
      runCliProgram(configCommandProgram({ operation: 'schema', out: commandOptions.out })),
    );

  configCommand
    .command('validate')
    .argument(
      '[file]',
      'a .json config to validate (default: launch.config.ts in the current directory)',
    )
    .description('validate a config and report each problem with its field path')
    .action((file: string | undefined) =>
      runCliProgram(configCommandProgram({ operation: 'validate', file })),
    );

  configCommand
    .command('docs')
    .description('print the launch.config.ts field reference')
    .action(() => runCliProgram(configCommandProgram({ operation: 'docs' })));
};
