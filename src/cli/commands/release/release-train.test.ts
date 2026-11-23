import { Command, type CommandOption, type CommandArgument } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerReleaseTrainCommand } from './release-train.ts';
function describeRegisterReleaseTrainCommand() {
  function registersTheReleaseTrainActionsAndSelectors() {
    const program = new Command();
    registerReleaseTrainCommand(program);
    function findRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'release-train';
    }

    const releaseTrainCommand = program.commands.find(findRegisteredCommand);
    expect(releaseTrainCommand).toBeDefined();
    function mapArgument(argument: CommandArgument) {
      return argument.name();
    }

    expect(releaseTrainCommand?.registeredArguments.map(mapArgument)).toEqual(['action', 'id']);
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
