// Registers the command that syncs App Store age rating, categories, price, and review info.

import type { Command } from '@/cli/command.js';
import { releaseConfigCommandProgram } from '@/release/release-config-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type ReleaseConfigOptions = Readonly<{
  app?: string;
  dryRun?: boolean;
  yes?: boolean;
}>;

/** Attach the App Store release-attribute reconciliation command. */
export function registerReleaseConfigCommand(program: Command): void {
  function runReleasePiece(commandOptions: ReleaseConfigOptions) {
    const requiredCommandInput = {
      dryRun: commandOptions.dryRun == true,
      yes: commandOptions.yes == true,
    };
    const commandInput: typeof requiredCommandInput & { app?: string } = {
      ...requiredCommandInput,
    };

    if (commandOptions.app != null) commandInput.app = commandOptions.app;

    const releaseCommandProgram = releaseConfigCommandProgram(commandInput);

    return runCliProgram(releaseCommandProgram);
  }

  program
    .command('release-config')
    .description(
      'reconcile App Store release attributes (age rating, categories, price, review details) from launch.config.ts',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runReleasePiece);
}
