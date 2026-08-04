import type { Command } from 'commander';
import { syncCommandProgram } from '@core/store/syncCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type SyncOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  allowDestructive: boolean;
  yes: boolean;
  snapshot: boolean;
}>;

/** Attach the store reconciliation command to Commander. */
export const registerSyncCommand = (program: Command): void => {
  program
    .command('sync')
    .description(
      'reconcile App Store Connect products, listing copy, screenshots, and previews from config',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: every applicable app)')
    .option('--dry-run', 'print the plan and make no changes', false)
    .option('--allow-destructive', 'permit destructive actions', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .option('--no-snapshot', 'skip the automatic pre-sync baseline')
    .action((commandOptions: SyncOptions) => runCliProgram(syncCommandProgram(commandOptions)));
};
