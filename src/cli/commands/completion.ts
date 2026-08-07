import type { Command } from 'commander';
import { COMPLETE_SUBCOMMAND, SHELLS } from '@core/terminal/completion.js';
import { completionCommandProgram } from '@core/terminal/completionCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `completion` command group (print, install, and the hidden `__complete` callback) to the program. */
export const registerCompletionCommand = (program: Command): void => {
  const completion = program
    .command('completion')
    .description(
      'shell tab-completion for commands, flags, app handles, profiles, surfaces, and snapshots',
    );
  completion
    .command('install')
    .description("wire completion into your shell's rc file (idempotent), or print the manual step")
    .option('-s, --shell <shell>', `shell to wire up: ${SHELLS.join(' | ')} (default: $SHELL)`)
    .action((options: { shell?: string }) => {
      return runCliProgram(
        completionCommandProgram({ operation: 'install', shell: options.shell }),
      );
    });
  completion
    .argument('[shell]', `print the completion script: ${SHELLS.join(' | ')} (default: $SHELL)`)
    .action((shell: string | undefined) => {
      return runCliProgram(completionCommandProgram({ operation: 'script', shell }));
    });
  completion
    .command(`${COMPLETE_SUBCOMMAND} [words...]`, { hidden: true })
    .description('internal: emit completion candidates for the words typed so far')
    .action((words: readonly string[]) => {
      return runCliProgram(
        completionCommandProgram({ operation: 'complete', words, commandTree: program }),
      );
    });
};
