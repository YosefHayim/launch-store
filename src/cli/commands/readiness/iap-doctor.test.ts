import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import { registerIapCommand } from './iap-doctor.ts';
function describeRegisterIapCommand() {
  function attachesAnIapGroupWithADoctorSubcommandAndItsPiece() {
    const program = new Command();
    registerIapCommand(program);
    function findCommand(command: Command) {
      return command.name() == 'iap';
    }

    const iap = program.commands.find(findCommand);
    expect(iap).toBeDefined();
    function findCommand2(command: Command) {
      return command.name() == 'doctor';
    }

    const doctor = iap?.commands.find(findCommand2);
    expect(doctor).toBeDefined();
    function readLong(option: CommandOption) {
      return option.long;
    }

    const options = doctor?.options.map(readLong);
    expect(options).toContain('--app');
    expect(options).toContain('--json');
  }

  it(
    'attaches an `iap` group with a `doctor` subcommand and its options',
    attachesAnIapGroupWithADoctorSubcommandAndItsPiece,
  );
}

describe('registerIapCommand', describeRegisterIapCommand);
