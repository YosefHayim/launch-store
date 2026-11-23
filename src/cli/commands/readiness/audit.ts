import type { Command } from '@/cli/command.js';
import { readinessCommandProgram } from '@/readiness/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** CLI options for `launch-store audit`. */
type AuditOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the read-only pre-submit audit command. */
export function registerAuditCommand(program: Command): void {
  function runAudit(commandOptions: AuditOptions) {
    const readinessProgram = readinessCommandProgram({
      category: 'submit',
      labels: {
        summary: 'Pre-submit audit',
        empty: 'No audit checks ran - no apps with a bundle id or package name were found.',
      },
      ...commandOptions,
    });

    return runCliProgram(readinessProgram);
  }

  program
    .command('audit')
    .description(
      'pre-submit readiness sweep: would a submission be rejected right now? (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runAudit);
}
