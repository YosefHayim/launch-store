import type { Command } from 'commander';
import {
  type PlaySubscriptionsCommandInput,
  playSubscriptionsCommandProgram,
} from '@core/store/playSubscriptionsCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type PlaySubscriptionsOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Attach the `play-subscriptions` command to the program. */
export const registerPlaySubscriptionsCommand = (program: Command): void => {
  program
    .command('play-subscriptions')
    .description(
      'reconcile Google Play subscriptions (base plans + offers) from the launch.config.ts catalog',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: PlaySubscriptionsOptions) => {
      let playSubscriptionsInput: PlaySubscriptionsCommandInput = {
        dryRun: commandOptions.dryRun,
        yes: commandOptions.yes,
      };
      if (commandOptions.app !== undefined) {
        playSubscriptionsInput = { ...playSubscriptionsInput, app: commandOptions.app };
      }
      return runCliProgram(playSubscriptionsCommandProgram(playSubscriptionsInput));
    });
};
