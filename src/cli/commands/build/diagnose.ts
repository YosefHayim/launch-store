import type { Command } from '@/cli/command.js';
import { diagnoseCommandProgram } from '@/build/diagnose-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

/** Attach the native-build log diagnosis command to Commander. */
export function registerDiagnoseCommand(program: Command): void {
  function runDiagnose(logfile: string | undefined) {
    const diagnoseProgram = diagnoseCommandProgram({ logfile });
    return runCliProgram(diagnoseProgram);
  }

  program
    .command('diagnose')
    .description('explain a failed native build - parse the cause and fix from a build log')
    .argument('[logfile]', 'path to a build log (default: the most recent ~/.launch/logs entry)')
    .action(runDiagnose);
}
