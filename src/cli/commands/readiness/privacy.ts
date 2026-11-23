// Registers the read-only scan of app permissions against the declared privacy answers.

import type { Command } from '@/cli/command.js';
import { privacyCommandProgram } from '@/privacy/command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

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
