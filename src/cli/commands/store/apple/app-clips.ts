import type { Command } from '../../../command.ts';
import { type AppClipsCommandInput, appClipsCommandProgram } from './app-clips-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type AppClipsOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
const toAppClipsInput = (
  commandOptions: AppClipsOptions,
  explicitConfig: boolean,
): AppClipsCommandInput => {
  let appClipsInput: AppClipsCommandInput = {
    config: commandOptions.config,
    explicitConfig,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };
  if (commandOptions.app != null) {
    appClipsInput = { ...appClipsInput, app: commandOptions.app };
  }
  return appClipsInput;
};

/** Attach the app-clips command. */
export const registerAppClipsCommand = (program: Command): void => {
  program
    .command('app-clips')
    .description(
      'reconcile App Clip card metadata (action, per-locale subtitle) from appclips.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the App Clips config file', 'appclips.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: AppClipsOptions, registeredCommand: Command) => {
      const explicitConfig = registeredCommand.getOptionValueSource('config') == 'cli';
      const appClips = toAppClipsInput(commandOptions, explicitConfig);
      const appClipsProgram = appClipsCommandProgram(appClips);
      return runCliProgram(appClipsProgram);
    });
};
