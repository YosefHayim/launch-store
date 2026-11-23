import { Command, type CommandOption } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerSnapshotCommand } from './snapshot.ts';

/** Find one registered snapshot subcommand. */
function snapshotSubcommand(commandName: string) {
  const program = new Command();

  registerSnapshotCommand(program);

  function findRegisteredCommand(registeredCommand: Command) {
    return registeredCommand.name() == 'snapshot';
  }

  const snapshotCommand = program.commands.find(findRegisteredCommand);

  expect(snapshotCommand).toBeDefined();

  function findRegisteredCommand2(registeredCommand: Command) {
    return registeredCommand.name() == commandName;
  }

  return snapshotCommand?.commands.find(findRegisteredCommand2);
}
function describeRegisterSnapshotCommand() {
  function registersEverySnapshotOperation() {
    const program = new Command();

    registerSnapshotCommand(program);

    function findRegisteredCommand3(registeredCommand: Command) {
      return registeredCommand.name() == 'snapshot';
    }

    const snapshotCommand = program.commands.find(findRegisteredCommand3);

    function mapRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name();
    }

    const operationNames = snapshotCommand?.commands.map(mapRegisteredCommand).sort();

    expect(operationNames).toEqual([
      'create',
      'delete',
      'diff',
      'export',
      'list',
      'prune',
      'restore',
    ]);
  }

  it('registers every snapshot operation', registersEverySnapshotOperation);

  function keepsCaptureAndRestoreSelectorsOnTheirOwningOperations() {
    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(snapshotSubcommand('create')?.options.map(readLong)).toEqual(
      expect.arrayContaining(['--app', '--json']),
    );

    function readLong2(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(snapshotSubcommand('diff')?.options.map(readLong2)).toEqual(
      expect.arrayContaining(['--app', '--json']),
    );

    function readLong3(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(snapshotSubcommand('restore')?.options.map(readLong3)).toEqual(
      expect.arrayContaining(['--app', '--source', '--yes', '--json']),
    );
  }

  it(
    'keeps capture and restore selectors on their owning operations',
    keepsCaptureAndRestoreSelectorsOnTheirOwningOperations,
  );

  function keepsPersistenceFlagsOnTheirOwningOperations() {
    function readLong4(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(snapshotSubcommand('export')?.options.map(readLong4)).toContain('--out');

    function readLong5(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(snapshotSubcommand('delete')?.options.map(readLong5)).toContain('--json');

    function readLong6(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(snapshotSubcommand('prune')?.options.map(readLong6)).toEqual(
      expect.arrayContaining(['--keep', '--older-than', '--yes', '--json']),
    );
  }

  it(
    'keeps persistence flags on their owning operations',
    keepsPersistenceFlagsOnTheirOwningOperations,
  );
}

describe('registerSnapshotCommand', describeRegisterSnapshotCommand);
