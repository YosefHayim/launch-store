import type { Command } from '../../command.ts';
import { releaseConfigCommandProgram } from '../../../release/release-config-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type ReleaseConfigOptions = Readonly<{
  app?: string;
  config: string;
  dryRun?: boolean;
  yes?: boolean;
}>;

/** Attach the App Store release-attribute reconciliation command. */
export function registerReleaseConfigCommand(program: Command): void {
  function runReleasePiece(commandOptions: ReleaseConfigOptions, command: Command) {
    const requiredCommandInput = {
      configPath: commandOptions.config,
      explicitConfigPath: command.getOptionValueSource('config') == 'cli',
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
      'reconcile App Store release attributes (age rating, categories, price, review details) from release.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the release config file', 'release.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runReleasePiece);
}
