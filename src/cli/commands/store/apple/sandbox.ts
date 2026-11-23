import type { Command } from '@/cli/command.js';
import { sandboxCommandProgram } from './sandbox-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the `sandbox` command (with `list` / `clear` subcommands) to the program. */
export function registerSandboxCommand(program: Command): void {
  const sandbox = program
    .command('sandbox')
    .description('list StoreKit sandbox testers and clear their purchase history');

  function runList(options: { json?: boolean }) {
    const sandboxProgram = sandboxCommandProgram({
      operation: 'list',
      json: options.json == true,
    });

    return runCliProgram(sandboxProgram);
  }

  sandbox
    .command('list')
    .description("list the account's sandbox testers")
    .option('--json', 'output machine-readable JSON', false)
    .action(runList);

  function runClear(
    emails: string[],
    options: {
      all?: boolean;
      yes?: boolean;
    },
  ) {
    const sandboxProgram = sandboxCommandProgram({
      operation: 'clear',
      emails,
      all: options.all == true,
      yes: options.yes == true,
    });

    return runCliProgram(sandboxProgram);
  }

  sandbox
    .command('clear')
    .description("clear sandbox testers' StoreKit purchase history (for re-testing purchases)")
    .argument('[emails...]', 'sandbox tester emails to clear (omit when using --all)')
    .option('--all', "clear every sandbox tester's purchase history", false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runClear);
}
