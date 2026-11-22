import type { Command } from '../../command.ts';
import { explainCommandProgram } from '../../../terminal/explainCommand.ts';
import { runCliProgram } from '../../runCliProgram.ts';

/** Attach the `explain` command to the program. */
export function registerExplainCommand(program: Command): void {
  function explainTopic(topic?: string): Promise<void> {
    async function startExplain(): Promise<void> {
      explainCommandProgram({ topic });
    }

    return runCliProgram(startExplain());
  }

  program
    .command('explain')
    .description(
      'plain-English glossary for an Apple/iOS term (csr, app-record, provisioning-profile, ...)',
    )
    .argument('[topic]', 'a term to explain, e.g. provisioning-profile')
    .action(explainTopic);
}
