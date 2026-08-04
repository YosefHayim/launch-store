import type { Command } from 'commander';
import { readinessCommandProgram } from '@core/readiness/command.js';
import { runCliProgram } from '../runCliProgram.js';

/** CLI options for `launch audit`. */
type AuditOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the read-only pre-submit audit command. */
export const registerAuditCommand = (program: Command): void => {
  program
    .command('audit')
    .description(
      'pre-submit readiness sweep: would a submission be rejected right now? (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: AuditOptions) =>
      runCliProgram(
        readinessCommandProgram({
          category: 'submit',
          labels: {
            summary: 'Pre-submit audit',
            empty: 'No audit checks ran - no apps with a bundle id or package name were found.',
          },
          ...commandOptions,
        }),
      ),
    );
};
