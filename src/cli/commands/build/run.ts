import type { Command } from '../../command.ts';
import { runCommandProgram } from '../../../build/run-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type RunOptions = Readonly<{ device?: string }>;

/** Attach the device-install command to Commander. */
export const registerRunCommand = (program: Command): void => {
  program
    .command('run')
    .description(
      'install a built artifact on a connected device (iOS device or Android device/emulator)',
    )
    .argument(
      '[reference]',
      'a build id from `launch builds list`, a build number, or `latest`',
      'latest',
    )
    .option('-d, --device <id>', 'Android serial or Apple devicectl device identifier')
    .action((reference: string, commandOptions: RunOptions) => {
      const runProgram = runCommandProgram({ reference, device: commandOptions.device });
      return runCliProgram(runProgram);
    });
};
