import type { Command } from '../../command.ts';
import { privacyCommandProgram } from '../../../privacy/command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

/** CLI options for `launch-store privacy scan`. */
type PrivacyScanOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the read-only privacy scan command group. */
export function registerPrivacyCommand(program: Command): void {
  const privacyCommand = program
    .command('privacy')
    .description('reconcile your permission/data surface against your privacy declarations');
  function runScan(commandOptions: PrivacyScanOptions) {
    const privacyProgram = privacyCommandProgram(commandOptions);
    return runCliProgram(privacyProgram);
  }

  privacyCommand
    .command('scan')
    .description(
      'check permissions/manifests against the privacy declarations; flags undeclared collection (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(runScan);
}
