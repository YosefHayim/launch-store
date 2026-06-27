import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerCompletionCommand } from './completion.js';

/** The `completion` group from a fresh program, asserting it registered. */
function completionGroup(): Command {
  const program = new Command();
  registerCompletionCommand(program);
  const completion = program.commands.find((command) => command.name() === 'completion');
  expect(completion).toBeDefined();
  if (!completion) throw new Error('completion group missing');
  return completion;
}

describe('registerCompletionCommand', () => {
  it('attaches a `completion` group with install and the hidden __complete subcommand', () => {
    const names = completionGroup()
      .commands.map((command) => command.name())
      .sort();
    expect(names).toEqual(['__complete', 'install']);
  });

  it('takes an optional [shell] argument for printing the script', () => {
    const args = completionGroup().registeredArguments.map((argument) => argument.name());
    expect(args).toEqual(['shell']);
  });

  it('install takes -s/--shell', () => {
    const install = completionGroup().commands.find((command) => command.name() === 'install');
    const flags = install?.options.map((option) => option.long);
    expect(flags).toContain('--shell');
  });

  it('keeps the __complete subcommand out of help while still registering it', () => {
    const group = completionGroup();
    expect(group.commands.some((command) => command.name() === '__complete')).toBe(true);
    const visible = group.createHelp().visibleCommands(group);
    expect(visible.some((command) => command.name() === '__complete')).toBe(false);
  });
});
