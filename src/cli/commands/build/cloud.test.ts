import { Command, type CommandOption } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerCloudCommand } from './cloud.ts';
function describeRegisterCloudCommand() {
  function keepsTheCloudActionArgumentAndExplicitTeardownConfirmationFlag() {
    const program = new Command();

    registerCloudCommand(program);

    function findRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'cloud';
    }

    const cloudCommand = program.commands.find(findRegisteredCommand);

    expect(cloudCommand).toBeDefined();
    expect(cloudCommand?.registeredArguments[0]?.defaultValue).toBe('status');

    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(cloudCommand?.options.map(readLong)).toContain('--yes');
  }

  it(
    'keeps the cloud action argument and explicit teardown confirmation flag',
    keepsTheCloudActionArgumentAndExplicitTeardownConfirmationFlag,
  );
}

describe('registerCloudCommand', describeRegisterCloudCommand);
