import type { Command } from '../../command.ts';
import { cloudCommandProgram } from '../../../distribution/cloud-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type CloudOptions = Readonly<{ yes: boolean }>;

export function registerCloudCommand(program: Command): void {
  function runCloud(action: string, commandOptions: CloudOptions) {
    const cloudProgram = cloudCommandProgram({ operation: action, yes: commandOptions.yes });
    return runCliProgram(cloudProgram);
  }

  program
    .command('cloud')
    .description('manage the remote AWS EC2 Mac build host (setup | status | teardown | doctor)')
    .argument('[action]', 'setup | status | teardown | doctor', 'status')
    .option('-y, --yes', 'confirm teardown without prompting', false)
    .action(runCloud);
}
