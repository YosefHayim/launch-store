import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import * as resignModule from './resign.js';
import { registerResignCommand } from './resign.js';

describe('registerResignCommand', () => {
  it('attaches build:resign with the documented option surface', () => {
    const program = new Command();
    registerResignCommand(program);
    const resignCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'build:resign',
    );
    expect(resignCommand).toBeDefined();
    if (resignCommand === undefined) return;
    const optionFlags = resignCommand.options.map((option) => option.long);
    expect(optionFlags).toContain('--id');
    expect(optionFlags).toContain('--latest');
    expect(optionFlags).toContain('--app');
    expect(optionFlags).toContain('--account');
    expect(optionFlags).toContain('--output');
    expect(optionFlags).toContain('--dry-run');
  });

  it('exports only registration (thin CLI boundary)', () => {
    expect(Object.keys(resignModule).sort()).toEqual(['registerResignCommand']);
  });
});
