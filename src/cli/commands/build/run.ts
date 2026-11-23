import type { Command } from '@/cli/command.js';
import { runCommandProgram } from '@/build/run-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type RunOptions = Readonly<{ device?: string }>;

/** Attach the device-install command to Commander. */
export function registerRunCommand(program: Command): void {
  function runRun(reference: string, commandOptions: RunOptions) {
    const runProgram = runCommandProgram({ reference, device: commandOptions.device });
    return runCliProgram(runProgram);
  }

  program
    .command('run')
    .description(
      'install a built artifact on a connected device (iOS device or Android device/emulator)',
    )
    .argument(
      '[reference]',
      'a build id from `launch-store builds list`, a build number, or `latest`',
      'latest',
    )
    .option('-d, --device <id>', 'Android serial or Apple devicectl device identifier')
    .action(runRun);
}
