import type { Command } from '@/cli/command.js';
import { ciCommandProgram } from '@/config/ci-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type CiOptions = Readonly<{
  android: boolean;
  force: boolean;
}>;

/** Attach the GitHub Actions workflow scaffolder to Commander. */
export function registerCiCommand(program: Command): void {
  function runCi(commandOptions: CiOptions) {
    const ciProgram = ciCommandProgram(commandOptions);
    return runCliProgram(ciProgram);
  }

  program
    .command('ci')
    .description('scaffold CI workflows for building and shipping Launch apps')
    .command('init')
    .description('write a GitHub Actions workflow that builds and ships on a hosted runner')
    .option('--android', 'also emit an Android job (Ubuntu runner)', false)
    .option('--force', 'overwrite an existing .github/workflows/launch.yml', false)
    .action(runCi);
}
