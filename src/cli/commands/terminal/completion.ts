import type { Command } from '../../command.ts';
import { COMPLETE_SUBCOMMAND, SHELLS } from '../../../terminal/completion.ts';
import { completionCommandProgram } from '../../../terminal/completionCommand.ts';
import { runCliProgram } from '../../runCliProgram.ts';

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
