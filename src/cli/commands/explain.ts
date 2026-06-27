/**
 * `launch explain [topic]` — the on-demand glossary.
 *
 * With no argument it lists known topics; with one it prints that term's plain-English explanation.
 * Reads the same {@link glossary} the inline `--explain` output uses, so there's one source of truth.
 */

import type { Command } from 'commander';
import { explainTopic, isGlossaryTopic, listTopics } from '../../core/glossary.js';

/** Attach the `explain` command to the program. */
export function registerExplainCommand(program: Command): void {
  program
    .command('explain')
    .description(
      'plain-English glossary for an Apple/iOS term (csr, app-record, provisioning-profile, …)',
    )
    .argument('[topic]', 'a term to explain, e.g. provisioning-profile')
    .action((topic?: string) => {
      if (!topic) {
        console.log(`Topics: ${listTopics().join(', ')}`);
        return;
      }
      if (!isGlossaryTopic(topic)) {
        throw new Error(`Unknown topic "${topic}". Known topics: ${listTopics().join(', ')}`);
      }
      console.log(explainTopic(topic));
    });
}
