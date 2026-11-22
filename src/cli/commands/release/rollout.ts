import type { Command } from '../../command.ts';
import { rolloutCommandProgram } from '../../../release/rollout-command.ts';
import { runCliProgram } from '../../run-cli-program.ts';

type RolloutCommandOptions = Readonly<{ app?: string }>;

/** Attach phased-release steering to Commander. */
export const registerRolloutCommand = (program: Command): void => {
  program
    .command('rollout')
    .description('steer an iOS phased release: pause | resume | complete')
    .argument('<action>', 'pause | resume | complete')
    .option('-a, --app <names>', 'comma-separated app handles (default: all iOS apps)')
    .action((action: string, commandOptions: RolloutCommandOptions) =>
      runCliProgram(rolloutCommandProgram({ action, ...commandOptions })),
    );
};
