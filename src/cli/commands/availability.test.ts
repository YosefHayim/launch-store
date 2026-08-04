import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerAvailabilityCommand } from './availability.js';

describe('registerAvailabilityCommand', () => {
  it('preserves the public availability options and config default', () => {
    const program = new Command();
    registerAvailabilityCommand(program);
    const availabilityCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'availability',
    );
    expect(availabilityCommand?.options.map((commandOption) => commandOption.long)).toEqual([
      '--app',
      '--config',
      '--dry-run',
      '--yes',
    ]);
    const configOption = availabilityCommand?.options.find(
      (commandOption) => commandOption.long === '--config',
    );
    expect(configOption?.defaultValue).toBe('availability.config.json');
  });
});
