import type { Command } from 'commander';
import { demoCommandProgram } from '@core/terminal/demoCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `demo` command to the program. */
export const registerDemoCommand = (program: Command): void => {
  program
    .command('demo')
    .description('replay the simulated walkthrough of the build -> sign -> submit pipeline')
    .argument(
      '[platform]',
      'ios, android, tvos, macos, or visionos (prompts if omitted, defaults to ios)',
    )
    .action((platform?: string) => runCliProgram(demoCommandProgram({ platform })));
};
