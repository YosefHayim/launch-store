import type { Command } from '../../command.ts';
import { cloudCommandProgram } from '../../../distribution/cloud-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type CloudOptions = Readonly<{ yes: boolean }>;

export const registerCloudCommand = (program: Command): void => {
  program
    .command('cloud')
    .description('manage the remote AWS EC2 Mac build host (setup | status | teardown | doctor)')
    .argument('[action]', 'setup | status | teardown | doctor', 'status')
    .option('-y, --yes', 'confirm teardown without prompting', false)
    .action((action: string, commandOptions: CloudOptions) =>
      runCliProgram(cloudCommandProgram({ operation: action, yes: commandOptions.yes })),
    );
};
