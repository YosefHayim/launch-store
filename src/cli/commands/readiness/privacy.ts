import type { Command } from 'commander';
import { privacyCommandProgram } from '@/privacy/command.js';
import { runCliProgram } from '@cli/runCliProgram.js';

/** CLI options for `launch privacy scan`. */
type PrivacyScanOptions = {
  app?: string;
  json?: boolean;
};

/** Attach the read-only privacy scan command group. */
export const registerPrivacyCommand = (program: Command): void => {
  const privacyCommand = program
    .command('privacy')
    .description('reconcile your permission/data surface against your privacy declarations');
  privacyCommand
    .command('scan')
    .description(
      'check permissions/manifests against the privacy declarations; flags undeclared collection (read-only)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action((commandOptions: PrivacyScanOptions) =>
      runCliProgram(privacyCommandProgram(commandOptions)),
    );
};
