import type { Command } from 'commander';
import {
  type GameCenterCommandInput,
  gameCenterCommandProgram,
} from '@core/store/gameCenterCommand.js';
import { runCliProgram } from '../runCliProgram.js';

type GameCenterOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
const toGameCenterInput = (
  commandOptions: GameCenterOptions,
  explicitConfig: boolean,
): GameCenterCommandInput => {
  let gameCenterInput: GameCenterCommandInput = {
    config: commandOptions.config,
    explicitConfig,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };
  if (commandOptions.app !== undefined) {
    gameCenterInput = { ...gameCenterInput, app: commandOptions.app };
  }
  return gameCenterInput;
};

/** Attach the game-center command. */
export const registerGameCenterCommand = (program: Command): void => {
  program
    .command('game-center')
    .description('reconcile Game Center achievements & leaderboards from gamecenter.config.json')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the Game Center config file', 'gamecenter.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: GameCenterOptions, registeredCommand: Command) => {
      const explicitConfig = registeredCommand.getOptionValueSource('config') === 'cli';
      return runCliProgram(
        gameCenterCommandProgram(toGameCenterInput(commandOptions, explicitConfig)),
      );
    });
};
