import { Command } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerUpdatesCommand } from './updates.ts';
function describeRegisterUpdatesCommand() {
  function registersListViewAndRollbackUnderTheUpdatesFamily() {
    const program = new Command();

    registerUpdatesCommand(program);

    function findCommand(command: Command) {
      return command.name() == 'updates';
    }

    const updatesCommand = program.commands.find(findCommand);

    expect(updatesCommand).toBeDefined();

    if (updatesCommand == null) return;

    function mapCommand(command: Command) {
      return command.name();
    }

    const subcommandNames = updatesCommand.commands.map(mapCommand);

    expect(subcommandNames).toEqual(['list', 'view', 'rollback']);
  }

  it(
    'registers list, view, and rollback under the updates family',
    registersListViewAndRollbackUnderTheUpdatesFamily,
  );

  function defaultsListToProductionChannelAndRollbackToInteractiveConfirmation() {
    const program = new Command();

    registerUpdatesCommand(program);

    function findCommand2(command: Command) {
      return command.name() == 'updates';
    }

    const updatesCommand = program.commands.find(findCommand2);

    expect(updatesCommand).toBeDefined();

    if (updatesCommand == null) return;

    function findCommand3(command: Command) {
      return command.name() == 'list';
    }

    const listCommand = updatesCommand.commands.find(findCommand3);

    function findCommand4(command: Command) {
      return command.name() == 'rollback';
    }

    const rollbackCommand = updatesCommand.commands.find(findCommand4);

    expect(listCommand).toBeDefined();
    expect(rollbackCommand).toBeDefined();

    if (listCommand == null) return;

    if (rollbackCommand == null) return;

    expect(listCommand.opts()['channel']).toBe('production');
    expect(rollbackCommand.opts()['toEmbedded']).toBe(false);
    expect(rollbackCommand.opts()['yes']).toBe(false);
  }

  it(
    'defaults list to production channel and rollback to interactive confirmation',
    defaultsListToProductionChannelAndRollbackToInteractiveConfirmation,
  );
}

describe('registerUpdatesCommand', describeRegisterUpdatesCommand);
