import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import { registerIapCommand } from './in-app-purchase-doctor.ts';

function describeRegisterIapCommand() {
  function attachesAnIapGroupWithADoctorSubcommandAndItsPiece() {
    const program = new Command();

    registerIapCommand(program);

    function isIapCommand(command: Command) {
      return command.name() == 'iap';
    }

    const iap = program.commands.find(isIapCommand);

    expect(iap).toBeDefined();

    function isDoctorCommand(command: Command) {
      return command.name() == 'doctor';
    }

    const doctor = iap?.commands.find(isDoctorCommand);

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
