import { Command, type CommandOption } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerFingerprintCommand } from './fingerprint.ts';
function describeRegisterFingerprintCommand() {
  function registersTheFingerprintCommandAndItsSelectors() {
    const program = new Command();

    registerFingerprintCommand(program);

    function findRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'fingerprint';
    }

    const fingerprintCommand = program.commands.find(findRegisteredCommand);

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
