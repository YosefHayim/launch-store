import type { Command } from '../../command.ts';
import { diagnoseCommandProgram } from '../../../build/diagnose-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

/** Attach the native-build log diagnosis command to Commander. */
export const registerDiagnoseCommand = (program: Command): void => {
  program
    .command('diagnose')
    .description('explain a failed native build - parse the cause and fix from a build log')
    .argument('[logfile]', 'path to a build log (default: the most recent ~/.launch/logs entry)')
    .action((logfile: string | undefined) => {
      const diagnoseProgram = diagnoseCommandProgram({ logfile });
      return runCliProgram(diagnoseProgram);
    });
};
