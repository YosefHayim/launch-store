import type { Command } from 'commander';
import { resignCommandProgram, type ResignCommandInput } from '@core/build/resignCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the stored-build re-sign command to Commander. */
export const registerResignCommand = (program: Command): void => {
  program
    .command('build:resign')
    .description('re-sign a stored build with different credentials, without rebuilding')
    .option('--id <id>', 'a build id from `launch builds list` (defaults to latest)')
    .option('--latest', 're-sign the most recent build')
    .option('-a, --app <name>', 'only consider builds for this app')
    .option('--account <keyId|label>', 'Apple account whose signing assets should be used')
    .option('-o, --output <path>', 'output file or directory')
    .option('--dry-run', 'print the re-sign plan and change nothing', false)
    .action((commandOptions: ResignCommandInput) =>
      runCliProgram(resignCommandProgram(commandOptions)),
    );
};
