import type { Command } from 'commander';
import { diagnoseCommandProgram } from '@core/build/diagnoseCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the native-build log diagnosis command to Commander. */
export const registerDiagnoseCommand = (program: Command): void => {
  program
    .command('diagnose')
    .description('explain a failed native build - parse the cause and fix from a build log')
    .argument('[logfile]', 'path to a build log (default: the most recent ~/.launch/logs entry)')
    .action((logfile: string | undefined) => runCliProgram(diagnoseCommandProgram({ logfile })));
};
