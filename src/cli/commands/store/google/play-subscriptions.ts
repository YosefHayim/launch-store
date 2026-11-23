import type { Command } from '../../../command.ts';
import {
  type PlaySubscriptionsCommandInput,
  playSubscriptionsCommandProgram,
} from './play-subscriptions-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type PlaySubscriptionsOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Attach the `play-subscriptions` command to the program. */
export function registerPlaySubscriptionsCommand(program: Command): void {
  function runPlaySubscriptions(commandOptions: PlaySubscriptionsOptions) {
    let playSubscriptionsInput: PlaySubscriptionsCommandInput = {
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
    };
    if (commandOptions.app != null) {
      playSubscriptionsInput = { ...playSubscriptionsInput, app: commandOptions.app };
    }
    const playSubscriptionsProgram = playSubscriptionsCommandProgram(playSubscriptionsInput);
    return runCliProgram(playSubscriptionsProgram);
  }

  program
    .command('play-subscriptions')
    .description(
      'reconcile Google Play subscriptions (base plans + offers) from the launch.config.ts catalog',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runPlaySubscriptions);
}
