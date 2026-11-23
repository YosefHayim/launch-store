import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '@/cli/command.js';
import { registerGameCenterCommand } from './game-center.ts';

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
