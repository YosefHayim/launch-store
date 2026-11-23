// Registers shell tab completion for Launch commands, flags, apps, and snapshots.

import type { Command } from '@/cli/command.js';
import { COMPLETE_SUBCOMMAND, SHELLS } from '@/terminal/completion.js';
import { completionCommandProgram } from '@/terminal/completion-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the `completion` command group (print, install, and the hidden `__complete` callback) to the program. */
export function registerCompletionCommand(program: Command): void {
  const completion = program
    .command('completion')
    .description(
      'shell tab-completion for commands, flags, app handles, profiles, surfaces, and snapshots',
    );

  function runInstall(options: { shell?: string }) {
    const completionProgram = completionCommandProgram({
      operation: 'install',
      shell: options.shell,
    });

    return runCliProgram(completionProgram);
  }

  completion
    .command('install')
    .description("wire completion into your shell's rc file (idempotent), or print the manual step")
    .option('-s, --shell <shell>', `shell to wire up: ${SHELLS.join(' | ')} (default: $SHELL)`)
    .action(runInstall);

  function runCommand(shell: string | undefined) {
    const completionProgram = completionCommandProgram({ operation: 'script', shell });
    return runCliProgram(completionProgram);
  }

  completion
    .argument('[shell]', `print the completion script: ${SHELLS.join(' | ')} (default: $SHELL)`)
    .action(runCommand);

  function runCommand2(words: readonly string[]) {
    const completionProgram = completionCommandProgram({
      operation: 'complete',
      words,
      commandTree: program,
    });

    return runCliProgram(completionProgram);
  }

  completion
    .command(`${COMPLETE_SUBCOMMAND} [words...]`, { hidden: true })
    .description('internal: emit completion candidates for the words typed so far')
    .action(runCommand2);
}
