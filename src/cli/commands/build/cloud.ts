import type { Command } from '@/cli/command.js';
import { cloudCommandProgram } from '@/distribution/cloud-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

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
