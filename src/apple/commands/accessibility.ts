// Registers the command that syncs accessibility nutrition labels from launch.config.ts.

import type { Command } from '@/cli/command.js';
import { accessibilityCommandProgram } from './accessibility-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

type AccessibilityOptions = Readonly<{
  app?: string;
  dryRun: boolean;
  yes: boolean;
}>;

/** Attach the accessibility reconciliation command. */
export function registerAccessibilityCommand(program: Command): void {
  function runAccessibility(commandOptions: AccessibilityOptions) {
    const requiredInput = {
      dryRun: commandOptions.dryRun,
      yes: commandOptions.yes,
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
    .description('reconcile accessibility declarations (nutrition labels) from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAccessibility);
}
