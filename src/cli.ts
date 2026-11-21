import { CommanderError } from 'commander';
import { Program } from '@/program.js';
import { DRIFT_MESSAGE } from '@/store/plan-store.js';

export class Cli {
  start = async (launchVersion: string): Promise<void> => {
    try {
      await new Program().parse(launchVersion);
    } catch (error) {
      const isUsage = error instanceof CommanderError;

      if (isUsage) {
        const isFailure = error.exitCode != 0;

        if (isFailure) {
          console.error({ message: error.message });
        }

        process.exitCode = error.exitCode;
        return;
      }

      const isError = error instanceof Error;

      if (isError) {
        const isDrift = error.message == DRIFT_MESSAGE;

        if (isDrift) {
          console.error({ message: error.message });
          process.exitCode = 2;
          return;
        }
      }

      throw error;
    }
  };
}
