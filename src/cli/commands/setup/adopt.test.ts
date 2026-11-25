import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerAdoptCommand } from './adopt.js';

describe('registerAdoptCommand', () => {
  it('registers adopt with dry-run and confirmation flags', () => {
    const program = new Command();
    registerAdoptCommand(program);
    const adoptCommand = program.commands.find((command) => command.name() === 'adopt');
    expect(adoptCommand).toBeDefined();
    if (adoptCommand === undefined) return;
    expect(adoptCommand.opts()['all']).toBe(false);
    expect(adoptCommand.opts()['dryRun']).toBe(false);
    expect(adoptCommand.opts()['yes']).toBe(false);
  });
});
