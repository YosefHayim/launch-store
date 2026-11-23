import { Command, type CommandOption } from '@/cli/command.js';
import { describe, expect, it } from 'vitest';
import { registerTestflightCommand } from './testflight.ts';

function registeredTestflight(): Command {
  const program = new Command();

  registerTestflightCommand(program);

  function isTestflightCommand(registeredCommand: Command) {
    return registeredCommand.name() == 'testflight';
  }

  const testflightCommand = program.commands.find(isTestflightCommand);

  if (testflightCommand == null) {
    throw new Error('expected testflight command to be registered');
  }

  return testflightCommand;
}

function describeRegisterTestflightCommand() {
  function attachesTheTestFlightSubcommandTree() {
    const testflightCommand = registeredTestflight();

    function copyRegisteredCommand(registeredCommand: Command) {
      return registeredCommand.name();
    }

    const subcommandNames = testflightCommand.commands.map(copyRegisteredCommand);

    expect(subcommandNames).toEqual([
      'groups',
      'create-group',
      'testers',
      'add',
      'rm',
      'release',
      'feedback',
    ]);
  }

  it('attaches the TestFlight subcommand tree', attachesTheTestFlightSubcommandTree);

  function wiresMutationFlagsForAddRemoveAndRelease() {
    const testflightCommand = registeredTestflight();

    function isAddCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'add';
    }

    const addCommand = testflightCommand.commands.find(isAddCommand);

    function isRemoveCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'rm';
    }

    const removeCommand = testflightCommand.commands.find(isRemoveCommand);

    function isReleaseCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'release';
    }

    const releaseCommand = testflightCommand.commands.find(isReleaseCommand);

    function readLong(option: CommandOption) {
      return option.long;
    }

    expect(addCommand?.options.map(readLong)).toEqual(
      expect.arrayContaining([
        '--app',
        '--group',
        '--first',
        '--last',
        '--csv',
        '--dry-run',
        '--yes',
      ]),
    );

    function readLong2(option: CommandOption) {
      return option.long;
    }

    expect(removeCommand?.options.map(readLong2)).toEqual(
      expect.arrayContaining(['--app', '--group', '--dry-run', '--yes']),
    );

    function readLong3(option: CommandOption) {
      return option.long;
    }

    expect(releaseCommand?.options.map(readLong3)).toEqual(
      expect.arrayContaining([
        '--app',
        '--build',
        '--whats-new',
        '--locale',
        '--config',
        '--dry-run',
        '--yes',
      ]),
    );
  }

  it('wires mutation flags for add, remove, and release', wiresMutationFlagsForAddRemoveAndRelease);

  function wiresFeedbackFiltersWithoutWriteFlags() {
    const testflightCommand = registeredTestflight();

    function isFeedbackCommand(registeredCommand: Command) {
      return registeredCommand.name() == 'feedback';
    }

    const feedbackCommand = testflightCommand.commands.find(isFeedbackCommand);

    function readLong4(option: CommandOption) {
      return option.long;
    }

    expect(feedbackCommand?.options.map(readLong4)).toEqual(
      expect.arrayContaining(['--app', '--build', '--type', '--out', '--json']),
    );

    function readLong5(option: CommandOption) {
      return option.long;
    }

    expect(feedbackCommand?.options.map(readLong5)).not.toContain('--yes');
  }

  it('wires feedback filters without write flags', wiresFeedbackFiltersWithoutWriteFlags);
}

describe('registerTestflightCommand', describeRegisterTestflightCommand);
