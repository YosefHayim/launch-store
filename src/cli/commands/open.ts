import type { Command } from 'commander';
import { OPEN_TARGETS } from '@core/terminal/consoleLinks.js';
import { type OpenCommandInput, openCommandProgram } from '@core/terminal/openCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type OpenCommandOptions = Readonly<{ platform?: string; app?: string }>;

/** Map open arguments without explicit undefined optionals. */
const toOpenCommandInput = (
  target: string | undefined,
  commandOptions: OpenCommandOptions,
): OpenCommandInput => {
  let commandInput: OpenCommandInput = {};
  if (target !== undefined) commandInput = { ...commandInput, target };
  if (commandOptions.platform !== undefined) {
    commandInput = { ...commandInput, platform: commandOptions.platform };
  }
  if (commandOptions.app !== undefined) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }
  return commandInput;
};

/** Attach the top-level `open` command to the program. */
export const registerOpenCommand = (program: Command): void => {
  program
    .command('open')
    .description("deep-link the app's App Store Connect / Play Console page in your browser")
    .argument('[target]', `what to open: ${OPEN_TARGETS.join(' | ')} (default: asc)`)
    .option(
      '--platform <platform>',
      'ios/tvos/macos/visionos (App Store Connect) or android (Play Console)',
    )
    .option('-a, --app <name>', 'app handle to open (default: the first app for the platform)')
    .action((target: string | undefined, commandOptions: OpenCommandOptions) =>
      runCliProgram(openCommandProgram(toOpenCommandInput(target, commandOptions))),
    );
};
