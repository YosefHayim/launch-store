import type { Command } from 'commander';
import {
  type PlayProductsCommandInput,
  playProductsCommandProgram,
} from '@core/store/playProductsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type PlayProductsOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Attach the `play-products` command to the program. */
export const registerPlayProductsCommand = (program: Command): void => {
  program
    .command('play-products')
    .description('reconcile Google Play in-app products from the launch.config.ts product catalog')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: PlayProductsOptions) => {
      let playProductsInput: PlayProductsCommandInput = {
        dryRun: commandOptions.dryRun,
        yes: commandOptions.yes,
      };
      if (commandOptions.app !== undefined) {
        playProductsInput = { ...playProductsInput, app: commandOptions.app };
      }
      return runCliProgram(playProductsCommandProgram(playProductsInput));
    });
};
