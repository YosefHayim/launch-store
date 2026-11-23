import { Command, type CommandOption } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerFingerprintCommand } from './fingerprint.ts';

function describeRegisterFingerprintCommand() {
  function registersTheFingerprintCommandAndItsSelectors() {
    const program = new Command();

    registerFingerprintCommand(program);

    function isFingerprintCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'fingerprint';
    }

    const fingerprintCommand = program.commands.find(isFingerprintCommand);

    expect(fingerprintCommand).toBeDefined();

    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(fingerprintCommand?.options.map(readLong)).toEqual(
      expect.arrayContaining(['--app', '--json']),
    );
  }

  it(
    'registers the fingerprint command and its selectors',
    registersTheFingerprintCommandAndItsSelectors,
  );
}

describe('registerFingerprintCommand', describeRegisterFingerprintCommand);
