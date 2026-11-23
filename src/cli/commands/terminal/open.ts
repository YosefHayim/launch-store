import type { Command } from '../../command.ts';
import { OPEN_TARGETS } from '../../../terminal/console-links.ts';
import { type OpenCommandInput, openCommandProgram } from '../../../terminal/open-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type OpenCommandOptions = Readonly<{ platform?: string; app?: string }>;

/** Map open arguments without explicit undefined optionals. */
function readOpenCommand(
  target: string | undefined,
  commandOptions: OpenCommandOptions,
): OpenCommandInput {
  let commandInput: OpenCommandInput = {};

  if (target != null) commandInput = { ...commandInput, target };

  if (commandOptions.platform != null) {
    commandInput = { ...commandInput, platform: commandOptions.platform };
  }

  if (commandOptions.app != null) {
    commandInput = { ...commandInput, app: commandOptions.app };
  }

  return commandInput;
}

/** Attach the top-level `open` command to the program. */
export function registerOpenCommand(program: Command): void {
  function runOpen(target: string | undefined, commandOptions: OpenCommandOptions) {
    const openCommand = readOpenCommand(target, commandOptions);
    const openProgram = openCommandProgram(openCommand);
    return runCliProgram(openProgram);
  }

  program
    .command('open')
    .description("deep-link the app's App Store Connect / Play Console page in your browser")
    .argument('[target]', `what to open: ${OPEN_TARGETS.join(' | ')} (default: asc)`)
    .option(
      '--platform <platform>',
      'ios/tvos/macos/visionos (App Store Connect) or android (Play Console)',
    )
    .option('-a, --app <name>', 'app handle to open (default: the first app for the platform)')
    .action(runOpen);
}
