import type { Command } from 'commander';
import { initCommandProgram } from '@core/config/initCommand.js';
import { runCliProgram } from '../runCliProgram.js';

/** Run the scaffold inside the guided setup without standalone framing. */
export const runInit = (workingDirectory: string) =>
  runCliProgram(initCommandProgram({ workingDirectory, framed: false }));

/** Attach the init command. */
export const registerInitCommand = (program: Command): void => {
  program
    .command('init')
    .description('scaffold launch.config.ts (and .env.example) into the current repo')
    .action(() => runCliProgram(initCommandProgram({ framed: true })));
};
