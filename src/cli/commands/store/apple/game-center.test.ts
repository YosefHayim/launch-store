import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../../command.ts';
import { registerGameCenterCommand } from './game-center.ts';
function describeRegisterGameCenterCommand() {
  function attachesAGameCenterCommandWithAppPieceDryRunAndYesPiece() {
    const program = new Command();

    registerGameCenterCommand(program);

    function findRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'game-center';
    }

    const gameCenterCommand = program.commands.find(findRegisteredCommand);

    expect(gameCenterCommand).toBeDefined();

    if (gameCenterCommand == null) return;

    function readLong(option: CommandOption) {
      return option.long;
    }

    const optionFlags = gameCenterCommand.options.map(readLong);

    expect(optionFlags).toContain('--app');
    expect(optionFlags).toContain('--config');
    expect(optionFlags).toContain('--dry-run');
    expect(optionFlags).toContain('--yes');
  }

  it(
    'attaches a `game-center` command with app, config, dry-run, and yes options',
    attachesAGameCenterCommandWithAppPieceDryRunAndYesPiece,
  );
}

describe('registerGameCenterCommand', describeRegisterGameCenterCommand);
