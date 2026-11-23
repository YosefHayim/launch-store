import type { Command } from '../../../command.ts';
import {
  type PlayProductsCommandInput,
  playProductsCommandProgram,
} from './play-products-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type PlayProductsOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Attach the `play-products` command to the program. */
export function registerPlayProductsCommand(program: Command): void {
  function runPlayProducts(commandOptions: PlayProductsOptions) {
    let playProductsInput: PlayProductsCommandInput = {
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    };

    if (commandOptions.app != null) {
      playProductsInput = { ...playProductsInput, app: commandOptions.app };
    }

    const playProductsProgram = playProductsCommandProgram(playProductsInput);

    return runCliProgram(playProductsProgram);
  }

  program
    .command('play-products')
    .description('reconcile Google Play in-app products from the launch.config.ts product catalog')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runPlayProducts);
}
