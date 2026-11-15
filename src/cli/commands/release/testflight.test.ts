import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerTestflightCommand } from './testflight.js';

const registeredTestflight = (): Command => {
  const program = new Command();
  registerTestflightCommand(program);
  const testflightCommand = program.commands.find(
    (registeredCommand) => registeredCommand.name() === 'testflight',
  );
  if (testflightCommand === undefined) {
    throw new Error('expected testflight command to be registered');
  }
  return testflightCommand;
};

describe('registerTestflightCommand', () => {
  it('attaches the TestFlight subcommand tree', () => {
    const testflightCommand = registeredTestflight();
    const subcommandNames = testflightCommand.commands.map((registeredCommand) =>
      registeredCommand.name(),
    );
    expect(subcommandNames).toEqual([
      'groups',
      'create-group',
      'testers',
      'add',
      'rm',
      'release',
      'feedback',
    ]);
  });

  it('wires mutation flags for add, remove, and release', () => {
    const testflightCommand = registeredTestflight();
    const addCommand = testflightCommand.commands.find(
      (registeredCommand) => registeredCommand.name() === 'add',
    );
    const removeCommand = testflightCommand.commands.find(
      (registeredCommand) => registeredCommand.name() === 'rm',
    );
    const releaseCommand = testflightCommand.commands.find(
      (registeredCommand) => registeredCommand.name() === 'release',
    );
    expect(addCommand?.options.map((option) => option.long)).toEqual(
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
    expect(removeCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--app', '--group', '--dry-run', '--yes']),
    );
    expect(releaseCommand?.options.map((option) => option.long)).toEqual(
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
  });

  it('wires feedback filters without write flags', () => {
    const testflightCommand = registeredTestflight();
    const feedbackCommand = testflightCommand.commands.find(
      (registeredCommand) => registeredCommand.name() === 'feedback',
    );
    expect(feedbackCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--app', '--build', '--type', '--out', '--json']),
    );
    expect(feedbackCommand?.options.map((option) => option.long)).not.toContain('--yes');
  });
});
