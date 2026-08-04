import type { Command } from 'commander';
import { accessibilityCommandProgram } from '@core/store/accessibilityCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type AccessibilityOptions = Readonly<{
  app?: string;
  config: string;
  dryRun?: boolean;
  yes?: boolean;
}>;

/** Attach the accessibility reconciliation command. */
export const registerAccessibilityCommand = (program: Command): void => {
  program
    .command('accessibility')
    .description(
      'reconcile accessibility declarations (nutrition labels) from accessibility.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the accessibility config file', 'accessibility.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: AccessibilityOptions) => {
      const requiredInput = {
        configPath: commandOptions.config,
        dryRun: commandOptions.dryRun === true,
        yes: commandOptions.yes === true,
      };
      if (commandOptions.app === undefined) {
        return runCliProgram(accessibilityCommandProgram(requiredInput));
      }
      return runCliProgram(
        accessibilityCommandProgram({ ...requiredInput, app: commandOptions.app }),
      );
    });
};
