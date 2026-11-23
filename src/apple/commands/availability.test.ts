import { Command, type CommandOption } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerAvailabilityCommand } from './availability.ts';

function describeRegisterAvailabilityCommand() {
  function preservesThePublicAvailabilityPieceAndPieceDefault() {
    const program = new Command();

    registerAvailabilityCommand(program);

    function isAvailabilityCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'availability';
    }

    const availabilityCommand = program.commands.find(isAvailabilityCommand);

    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(availabilityCommand?.options.map(readLong)).toEqual(['--app', '--dry-run', '--yes']);
  }

  it('lists the app, dry-run, and yes options', preservesThePublicAvailabilityPieceAndPieceDefault);
}

describe('registerAvailabilityCommand', describeRegisterAvailabilityCommand);
