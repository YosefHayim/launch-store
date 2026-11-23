import { Command, type CommandOption } from '../../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerAvailabilityCommand } from './availability.ts';
function describeRegisterAvailabilityCommand() {
  function preservesThePublicAvailabilityPieceAndPieceDefault() {
    const program = new Command();
    registerAvailabilityCommand(program);
    function findRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'availability';
    }

    const availabilityCommand = program.commands.find(findRegisteredCommand);
    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(availabilityCommand?.options.map(readLong)).toEqual([
      '--app',
      '--config',
      '--dry-run',
      '--yes',
    ]);
    function findCommandOption(commandOption: CommandOption) {
      return commandOption.long == '--config';
    }

    const configOption = availabilityCommand?.options.find(findCommandOption);
    expect(configOption?.defaultValue).toBe('availability.config.json');
  }

  it(
    'preserves the public availability options and config default',
    preservesThePublicAvailabilityPieceAndPieceDefault,
  );
}

describe('registerAvailabilityCommand', describeRegisterAvailabilityCommand);
