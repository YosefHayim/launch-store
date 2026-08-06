import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerGameCenterCommand } from './gameCenter.js';

describe('registerGameCenterCommand', () => {
  it('attaches a `game-center` command with app, config, dry-run, and yes options', () => {
    const program = new Command();
    registerGameCenterCommand(program);
    const gameCenterCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'game-center',
    );
    expect(gameCenterCommand).toBeDefined();
    if (gameCenterCommand === undefined) return;
    const optionFlags = gameCenterCommand.options.map((option) => option.long);
    expect(optionFlags).toContain('--app');
    expect(optionFlags).toContain('--config');
    expect(optionFlags).toContain('--dry-run');
    expect(optionFlags).toContain('--yes');
  });
});
