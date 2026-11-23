import { Command, type CommandOption, type CommandArgument } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerReleaseTrainCommand } from './release-train.ts';

function describeRegisterReleaseTrainCommand() {
  function registersTheReleaseTrainActionsAndSelectors() {
    const program = new Command();

    registerReleaseTrainCommand(program);

    function isReleaseTrainCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'release-train';
    }

    const releaseTrainCommand = program.commands.find(isReleaseTrainCommand);

    expect(releaseTrainCommand).toBeDefined();

    function readArgumentName(argument: CommandArgument) {
      return argument.name();
    }

    expect(releaseTrainCommand?.registeredArguments.map(readArgumentName)).toEqual([
      'action',
      'id',
    ]);

    function readLong(commandOption: CommandOption) {
      return commandOption.long;
    }

    expect(releaseTrainCommand?.options.map(readLong)).toEqual(
      expect.arrayContaining([
        '--app',
        '--profile',
        '--platform',
        '--no-ota',
        '--hold',
        '--channel',
        '--runtime-version',
        '--watch',
        '--json',
        '--env',
        '--include-local',
      ]),
    );
  }

  it(
    'registers the release-train actions and selectors',
    registersTheReleaseTrainActionsAndSelectors,
  );
}

describe('registerReleaseTrainCommand', describeRegisterReleaseTrainCommand);
