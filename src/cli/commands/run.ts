import type { Command } from 'commander';
import { runCommandProgram } from '@core/build/runCommand.js';
import { runCliProgram } from '../runCliProgram.js';

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
    .action((reference: string, commandOptions: RunOptions) =>
      runCliProgram(runCommandProgram({ reference, device: commandOptions.device })),
    );
};
