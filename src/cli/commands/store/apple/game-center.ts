import type { Command } from '../../../command.ts';
import { type GameCenterCommandInput, gameCenterCommandProgram } from './game-center-command.ts';
import { runCliProgram } from '../../../run-cli-program.ts';

type GameCenterOptions = Readonly<{
  readonly app?: string;
  readonly config: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function gameCenterInputFromOptions(
  commandOptions: GameCenterOptions,
  explicitConfig: boolean,
): GameCenterCommandInput {
  let gameCenterInput: GameCenterCommandInput = {
    config: commandOptions.config,
    explicitConfig,
    dryRun: commandOptions.dryRun,
    yes: commandOptions.yes,
  };

  if (commandOptions.app != null) {
    gameCenterInput = { ...gameCenterInput, app: commandOptions.app };
  }

  return gameCenterInput;
}

/** Attach the game-center command. */
export function registerGameCenterCommand(program: Command): void {
  function runGameCenter(commandOptions: GameCenterOptions, registeredCommand: Command) {
    const explicitConfig = registeredCommand.getOptionValueSource('config') == 'cli';
    const gameCenterFrom = gameCenterInputFromOptions(commandOptions, explicitConfig);
    const gameCenterProgram = gameCenterCommandProgram(gameCenterFrom);
    return runCliProgram(gameCenterProgram);
  }

  program
    .command('game-center')
    .description('reconcile Game Center achievements & leaderboards from gamecenter.config.json')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the Game Center config file', 'gamecenter.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runGameCenter);
}
