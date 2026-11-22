import type { Command } from '../../command.ts';
import { ciCommandProgram } from '../../../config/ci-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type CiOptions = Readonly<{
  android: boolean;
  force: boolean;
}>;

/** Attach the GitHub Actions workflow scaffolder to Commander. */
export const registerCiCommand = (program: Command): void => {
  program
    .command('ci')
    .description('scaffold CI workflows for building and shipping Launch apps')
    .command('init')
    .description('write a GitHub Actions workflow that builds and ships on a hosted runner')
    .option('--android', 'also emit an Android job (Ubuntu runner)', false)
    .option('--force', 'overwrite an existing .github/workflows/launch.yml', false)
    .action((commandOptions: CiOptions) => runCliProgram(ciCommandProgram(commandOptions)));
};
