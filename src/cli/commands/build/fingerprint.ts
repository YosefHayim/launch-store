import type { Command } from '@/cli/command.js';
import { fingerprintCommandProgram } from '@/build/fingerprint-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the fingerprint command to the program. */
export function registerFingerprintCommand(program: Command): void {
  function runFingerprint(commandOptions: { app?: string; json: boolean }) {
    const fingerprintProgram = fingerprintCommandProgram(commandOptions);
    return runCliProgram(fingerprintProgram);
  }

  program
    .command('fingerprint')
    .description('show the native fingerprint and why the next build is clean or incremental (iOS)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action(runFingerprint);
}
