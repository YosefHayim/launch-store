// Starts Launch and maps a usage failure onto an exit code.

import { isUsageError } from './cli/command.ts';
import { Program } from './program.ts';

export class Cli {
  async start(launchVersion: string): Promise<void> {
    try {
      await new Program().parse(launchVersion);
    } catch (error) {
      const isUsage = isUsageError(error);

      if (isUsage) {
        const isFailure = error.exitCode != 0;

        if (isFailure) {
          console.error({ message: error.message });
        }

        process.exitCode = error.exitCode;

        return;
      }

      throw error;
    }
  }
}
