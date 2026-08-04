import type { Command } from 'commander';
import { explainCommandProgram } from '@core/terminal/explainCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `explain` command to the program. */
export const registerExplainCommand = (program: Command): void => {
  program
    .command('explain')
    .description(
      'plain-English glossary for an Apple/iOS term (csr, app-record, provisioning-profile, ...)',
    )
    .argument('[topic]', 'a term to explain, e.g. provisioning-profile')
    .action((topic?: string) => runCliProgram(explainCommandProgram({ topic })));
};
