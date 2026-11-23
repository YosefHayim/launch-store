import type { Command } from '@/cli/command.js';
import { rolloutCommandProgram } from '@/release/rollout-command.js';
import { runCliProgram } from '@/cli/run-cli-program.js';

type RolloutCommandOptions = Readonly<{ app?: string }>;

/** Attach phased-release steering to Commander. */
export function registerRolloutCommand(program: Command): void {
  function runRollout(action: string, commandOptions: RolloutCommandOptions) {
    const rolloutProgram = rolloutCommandProgram({ action, ...commandOptions });
    return runCliProgram(rolloutProgram);
  }

  program
    .command('rollout')
    .description('steer an iOS phased release: pause | resume | complete')
    .argument('<action>', 'pause | resume | complete')
    .option('-a, --app <names>', 'comma-separated app handles (default: all iOS apps)')
    .action(runRollout);
}
