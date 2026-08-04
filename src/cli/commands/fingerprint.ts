import type { Command } from 'commander';
import { fingerprintCommandProgram } from '@core/build/fingerprintCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the fingerprint command to the program. */
export const registerFingerprintCommand = (program: Command): void => {
  program
    .command('fingerprint')
    .description('show the native fingerprint and why the next build is clean or incremental (iOS)')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--json', 'output machine-readable JSON', false)
    .action((commandOptions: { app?: string; json: boolean }) =>
      runCliProgram(fingerprintCommandProgram(commandOptions)),
    );
};
