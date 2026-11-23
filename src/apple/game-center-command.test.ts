import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../cli/command.ts';
import { GameCenterCommandInputSchema, registerGameCenterCommand } from './game-center-command.ts';

function describeGameCenterCommandPieceSchema() {
  function decodesTheCommanderBoundaryWithAnOmittedAppSelector() {
    const gameCenterCommandSchema = GameCenterCommandInputSchema({
      dryRun: true,
      yes: false,
    });

    expect(gameCenterCommandSchema).toEqual({
      dryRun: true,
      yes: false,
    });
  }

  it(
    'decodes the Commander boundary with an omitted app selector',
    decodesTheCommanderBoundaryWithAnOmittedAppSelector,
  );

  function rejectsAnExplicitUndefinedExactOptionalApp() {
    function callGameCenterCommandPieceSchema() {
      return GameCenterCommandInputSchema({
        app: undefined,
        dryRun: false,
        yes: false,
      });
    }

    expect(callGameCenterCommandPieceSchema).toThrow();
  }

  it(
    'rejects an explicit undefined exact optional app',
    rejectsAnExplicitUndefinedExactOptionalApp,
  );
}

describe('GameCenterCommandInputSchema', describeGameCenterCommandPieceSchema);

function describeRegisterGameCenterCommand() {
  function attachesAGameCenterCommandWithAppPieceDryRunAndYesPiece() {
    const program = new Command();

    registerGameCenterCommand(program);

    function isGameCenterCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'game-center';
    }

    const gameCenterCommand = program.commands.find(isGameCenterCommand);

    expect(gameCenterCommand).toBeDefined();

    if (gameCenterCommand == null) return;

    function readLong(option: CommandOption) {
      return option.long;
    }

    const optionFlags = gameCenterCommand.options.map(readLong);

    expect(optionFlags).toContain('--app');
    expect(optionFlags).toContain('--dry-run');
    expect(optionFlags).toContain('--yes');
  }

  it(
    'attaches a `game-center` command with app, dry-run, and yes options',
    attachesAGameCenterCommandWithAppPieceDryRunAndYesPiece,
  );
}

describe('registerGameCenterCommand', describeRegisterGameCenterCommand);
