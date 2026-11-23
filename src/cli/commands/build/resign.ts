// Registers the command that signs a stored build again with different credentials.

import type { Command } from '@/cli/command.js';
import { resignCommandProgram, type ResignCommandInput } from '@/build/resign-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the stored-build re-sign command to Commander. */
export function registerResignCommand(program: Command): void {
  function runBuildResign(commandOptions: ResignCommandInput) {
    const resignProgram = resignCommandProgram(commandOptions);
    return runCliProgram(resignProgram);
  }

  program
    .command('build:resign')
    .description('re-sign a stored build with different credentials, without rebuilding')
    .option('--id <id>', 'a build id from `launch-store builds list` (defaults to latest)')
    .option('--latest', 're-sign the most recent build')
    .option('-a, --app <name>', 'only consider builds for this app')
    .option('--account <keyId|label>', 'Apple account whose signing assets should be used')
    .option('-o, --output <path>', 'output file or directory')
    .option('--dry-run', 'print the re-sign plan and change nothing', false)
    .action(runBuildResign);
}
