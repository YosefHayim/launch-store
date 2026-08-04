import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerSnapshotCommand } from './snapshot.js';

/** Find one registered snapshot subcommand. */
const snapshotSubcommand = (commandName: string) => {
  const program = new Command();
  registerSnapshotCommand(program);
  const snapshotCommand = program.commands.find(
    (registeredCommand) => registeredCommand.name() === 'snapshot',
  );
  expect(snapshotCommand).toBeDefined();
  return snapshotCommand?.commands.find(
    (registeredCommand) => registeredCommand.name() === commandName,
  );
};

describe('registerSnapshotCommand', () => {
  it('registers every snapshot operation', () => {
    const program = new Command();
    registerSnapshotCommand(program);
    const snapshotCommand = program.commands.find(
      (registeredCommand) => registeredCommand.name() === 'snapshot',
    );
    const operationNames = snapshotCommand?.commands
      .map((registeredCommand) => registeredCommand.name())
      .sort();
    expect(operationNames).toEqual([
      'create',
      'delete',
      'diff',
      'export',
      'list',
      'prune',
      'restore',
    ]);
  });

  it('keeps capture and restore selectors on their owning operations', () => {
    expect(
      snapshotSubcommand('create')?.options.map((commandOption) => commandOption.long),
    ).toEqual(expect.arrayContaining(['--app', '--json']));
    expect(snapshotSubcommand('diff')?.options.map((commandOption) => commandOption.long)).toEqual(
      expect.arrayContaining(['--app', '--json']),
    );
    expect(
      snapshotSubcommand('restore')?.options.map((commandOption) => commandOption.long),
    ).toEqual(expect.arrayContaining(['--app', '--source', '--yes', '--json']));
  });

  it('keeps persistence flags on their owning operations', () => {
    expect(
      snapshotSubcommand('export')?.options.map((commandOption) => commandOption.long),
    ).toContain('--out');
    expect(
      snapshotSubcommand('delete')?.options.map((commandOption) => commandOption.long),
    ).toContain('--json');
    expect(snapshotSubcommand('prune')?.options.map((commandOption) => commandOption.long)).toEqual(
      expect.arrayContaining(['--keep', '--older-than', '--yes', '--json']),
    );
  });
});
