// Registers the commands that print, check, and explain the Launch config schema.

import type { Command } from '../../command.ts';
import { configCommandProgram } from '../../../config/config-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type SchemaOptions = Readonly<{ out?: string }>;

/** Attach config schema, validation, and reference commands to Commander. */
export function registerConfigCommand(program: Command): void {
  const configCommand = program
    .command('config')
    .description(
      'work with launch.config.ts - emit JSON Schema, validate a config, or print the field reference',
    );

  function runSchema(commandOptions: SchemaOptions) {
    const commandProgram = configCommandProgram({ operation: 'schema', out: commandOptions.out });
    return runCliProgram(commandProgram);
  }

  configCommand
    .command('schema')
    .description('print the JSON Schema for launch.config.ts')
    .option('--out <file>', 'write the schema to this file instead of stdout')
    .action(runSchema);

  function runValidate(file: string | undefined) {
    const commandProgram = configCommandProgram({ operation: 'validate', file });
    return runCliProgram(commandProgram);
  }

  configCommand
    .command('validate')
    .argument(
      '[file]',
      'a .json config to validate (default: launch.config.ts in the current directory)',
    )
    .description('validate a config and report each problem with its field path')
    .action(runValidate);

  function runDocs() {
    const commandProgram = configCommandProgram({ operation: 'docs' });
    return runCliProgram(commandProgram);
  }

  configCommand
    .command('docs')
    .description('print the launch.config.ts field reference')
    .action(runDocs);
}
