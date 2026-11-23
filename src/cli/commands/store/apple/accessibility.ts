import type { Command } from '../../../command.ts';
import { accessibilityCommandProgram } from './accessibility-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type AccessibilityOptions = Readonly<{
  app?: string;
  config: string;
  dryRun?: boolean;
  yes?: boolean;
}>;

/** Attach the accessibility reconciliation command. */
export function registerAccessibilityCommand(program: Command): void {
  function runAccessibility(commandOptions: AccessibilityOptions) {
    const requiredInput = {
      configPath: commandOptions.config,
      dryRun: commandOptions.dryRun == true,
      yes: commandOptions.yes == true,
    };

    if (commandOptions.app == null) {
      const accessibilityProgram = accessibilityCommandProgram(requiredInput);
      return runCliProgram(accessibilityProgram);
    }

    const accessibilityProgram = accessibilityCommandProgram({
      ...requiredInput,
      app: commandOptions.app,
    });

    return runCliProgram(accessibilityProgram);
  }

  program
    .command('accessibility')
    .description(
      'reconcile accessibility declarations (nutrition labels) from accessibility.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the accessibility config file', 'accessibility.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAccessibility);
}
