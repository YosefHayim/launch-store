import { Command } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerAdoptCommand } from './adopt.ts';

describe('registerAdoptCommand', () => {
  it('registers adopt with dry-run and confirmation flags', () => {
    const program = new Command();
    registerAdoptCommand(program);
    const adoptCommand = program.commands.find((command) => command.name() == 'adopt');
    expect(adoptCommand).toBeDefined();
    if (adoptCommand == null) return;
    expect(adoptCommand.opts()['all']).toBe(false);
    expect(adoptCommand.opts()['dryRun']).toBe(false);
    expect(adoptCommand.opts()['yes']).toBe(false);
  });
});
