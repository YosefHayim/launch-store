// Registers the command that syncs App Clip card text and actions from launch.config.ts.

import type { Command } from '@/cli/command.js';
import { type AppClipsCommandInput, appClipsCommandProgram } from './app-clips-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

type AppClipsOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function readAppClipsCommand(commandOptions: AppClipsOptions): AppClipsCommandInput {
  let appClipsInput: AppClipsCommandInput = {
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    appClipsInput = { ...appClipsInput, app: commandOptions.app };
  }

  return appClipsInput;
}

/** Attach the app-clips command. */
export function registerAppClipsCommand(program: Command): void {
  function runAppClips(commandOptions: AppClipsOptions) {
    const appClips = readAppClipsCommand(commandOptions);
    const appClipsProgram = appClipsCommandProgram(appClips);
    return runCliProgram(appClipsProgram);
  }

  program
    .command('app-clips')
    .description(
      'reconcile App Clip card metadata (action, per-locale subtitle) from launch.config.ts',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runAppClips);
}
