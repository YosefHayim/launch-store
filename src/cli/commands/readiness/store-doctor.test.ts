import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import { registerStoreCommand } from './store-doctor.ts';
function describeRegisterStoreCommand() {
  function attachesAStoreGroupWithADoctorSubcommandAndItsPiece() {
    const program = new Command();
    registerStoreCommand(program);
    function findCommand(command: Command) {
      return command.name() == 'store';
    }

    const store = program.commands.find(findCommand);
    expect(store).toBeDefined();
    function findCommand2(command: Command) {
      return command.name() == 'doctor';
    }

    const doctor = store?.commands.find(findCommand2);
    expect(doctor).toBeDefined();
    function readLong(option: CommandOption) {
      return option.long;
    }

    const options = doctor?.options.map(readLong);
    expect(options).toContain('--app');
    expect(options).toContain('--json');
  }

  it(
    'attaches a `store` group with a `doctor` subcommand and its options',
    attachesAStoreGroupWithADoctorSubcommandAndItsPiece,
  );
}

describe('registerStoreCommand', describeRegisterStoreCommand);
