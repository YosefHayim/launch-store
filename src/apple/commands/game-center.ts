// Registers the command that syncs Game Center achievements and leaderboards from launch.config.ts.

import type { Command } from '@/cli/command.js';
import { type GameCenterCommandInput, gameCenterCommandProgram } from './game-center-command.ts';
import { runCliProgram } from '@/cli/run-cli-program.js';

type GameCenterOptions = Readonly<{
  readonly app?: string;
  readonly dryRun: boolean;
  readonly yes: boolean;
}>;

/** Map Commander values without explicit undefined optionals. */
function gameCenterInputFromOptions(commandOptions: GameCenterOptions): GameCenterCommandInput {
  let gameCenterInput: GameCenterCommandInput = {
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
  function runGameCenter(commandOptions: GameCenterOptions) {
    const gameCenterFrom = gameCenterInputFromOptions(commandOptions);
    const gameCenterProgram = gameCenterCommandProgram(gameCenterFrom);
    return runCliProgram(gameCenterProgram);
  }

  program
    .command('game-center')
    .description('reconcile Game Center achievements and leaderboards from launch.config.ts')
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(runGameCenter);
}
