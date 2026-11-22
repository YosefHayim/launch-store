import type { Command } from '../../command.ts';
import { COMPLETE_SUBCOMMAND, SHELLS } from '../../../terminal/completion.ts';
import { completionCommandProgram } from '../../../terminal/completion-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

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
      const completionProgram = completionCommandProgram({
        operation: 'install',
        shell: options.shell,
      });
      return runCliProgram(completionProgram);
    });
  completion
    .argument('[shell]', `print the completion script: ${SHELLS.join(' | ')} (default: $SHELL)`)
    .action((shell: string | undefined) => {
      const completionProgram = completionCommandProgram({ operation: 'script', shell });
      return runCliProgram(completionProgram);
    });
  completion
    .command(`${COMPLETE_SUBCOMMAND} [words...]`, { hidden: true })
    .description('internal: emit completion candidates for the words typed so far')
    .action((words: readonly string[]) => {
      const completionProgram = completionCommandProgram({
        operation: 'complete',
        words,
        commandTree: program,
      });
      return runCliProgram(completionProgram);
    });
};
