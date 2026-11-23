// Registers the command that explains an App Store or iOS term in plain language.

import type { Command } from '@/cli/command.js';
import { explainCommandProgram } from '@/terminal/explain-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the `explain` command to the program. */
export function registerExplainCommand(program: Command): void {
  function explainTopic(topic?: string): Promise<void> {
    async function startExplain(): Promise<void> {
      explainCommandProgram({ topic });
    }

    const explain = startExplain();

    return runCliProgram(explain);
  }

  program
    .command('explain')
    .description(
      'plain-English glossary for an Apple/iOS term (csr, app-record, provisioning-profile, ...)',
    )
    .argument('[topic]', 'a term to explain, e.g. provisioning-profile')
    .action(explainTopic);
}
