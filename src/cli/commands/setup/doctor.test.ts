import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '@/cli/command.js';
import { registerDoctorCommand } from './doctor.ts';

function describeRegisterDoctorCommand() {
  function attachesADoctorCommandWithPlatformAppFixYesAndPiecePiece() {
    const program = new Command();

    registerDoctorCommand(program);

    function isDoctorCommand(command: Command) {
      return command.name() == 'doctor';
    }

    const doctor = program.commands.find(isDoctorCommand);

    expect(doctor).toBeDefined();

    function readLong(option: CommandOption) {
      return option.long;
    }

    const options = doctor?.options.map(readLong);

    expect(options).toContain('--platform');
    expect(options).toContain('--app');
    expect(options).toContain('--fix');
    expect(options).toContain('--yes');
    expect(options).toContain('--json');
  }

  it(
    'attaches a `doctor` command with platform, app, fix, yes, and json options',
    attachesADoctorCommandWithPlatformAppFixYesAndPiecePiece,
  );
}

describe('registerDoctorCommand', describeRegisterDoctorCommand);
