import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerUpdatesCommand } from './updates.js';

describe('registerUpdatesCommand', () => {
  it('registers list, view, and rollback under the updates family', () => {
    const program = new Command();
    registerUpdatesCommand(program);
    const updatesCommand = program.commands.find((command) => command.name() === 'updates');
    expect(updatesCommand).toBeDefined();
    if (updatesCommand === undefined) return;
    const subcommandNames = updatesCommand.commands.map((command) => command.name());
    expect(subcommandNames).toEqual(['list', 'view', 'rollback']);
  });

  it('defaults list to production channel and rollback to interactive confirmation', () => {
    const program = new Command();
    registerUpdatesCommand(program);
    const updatesCommand = program.commands.find((command) => command.name() === 'updates');
    expect(updatesCommand).toBeDefined();
    if (updatesCommand === undefined) return;
    const listCommand = updatesCommand.commands.find((command) => command.name() === 'list');
    const rollbackCommand = updatesCommand.commands.find(
      (command) => command.name() === 'rollback',
    );
    expect(listCommand).toBeDefined();
    expect(rollbackCommand).toBeDefined();
    if (listCommand === undefined) return;
    if (rollbackCommand === undefined) return;
    expect(listCommand.opts()['channel']).toBe('production');
    expect(rollbackCommand.opts()['toEmbedded']).toBe(false);
    expect(rollbackCommand.opts()['yes']).toBe(false);
  });
});
