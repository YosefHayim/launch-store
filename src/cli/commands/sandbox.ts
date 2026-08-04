import type { Command } from 'commander';
import { sandboxCommandProgram } from '@core/store/sandboxCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `sandbox` command (with `list` / `clear` subcommands) to the program. */
export const registerSandboxCommand = (program: Command): void => {
  const sandbox = program
    .command('sandbox')
    .description('list StoreKit sandbox testers and clear their purchase history');
  sandbox
    .command('list')
    .description("list the account's sandbox testers")
    .option('--json', 'output machine-readable JSON', false)
    .action((options: { json?: boolean }) => {
      return runCliProgram(
        sandboxCommandProgram({ operation: 'list', json: options.json === true }),
      );
    });
  sandbox
    .command('clear')
    .description("clear sandbox testers' StoreKit purchase history (for re-testing purchases)")
    .argument('[emails...]', 'sandbox tester emails to clear (omit when using --all)')
    .option('--all', "clear every sandbox tester's purchase history", false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(
      (
        emails: string[],
        options: {
          all?: boolean;
          yes?: boolean;
        },
      ) => {
        return runCliProgram(
          sandboxCommandProgram({
            operation: 'clear',
            emails,
            all: options.all === true,
            yes: options.yes === true,
          }),
        );
      },
    );
};
