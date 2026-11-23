import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import { registerMigrateCommand } from './migrate.ts';
/** Find the `migrate` group's named subcommand, asserting the group exists. */
function subcommand(name: string) {
  const program = new Command();

  registerMigrateCommand(program);

  function findCommand(command: Command) {
    return command.name() == 'migrate';
  }

  const migrate = program.commands.find(findCommand);

  expect(migrate).toBeDefined();

  function findCommand2(command: Command) {
    return command.name() == name;
  }

  return migrate?.commands.find(findCommand2);
}
function describeRegisterMigrateCommand() {
  function attachesAMigrateGroupWithEasAndFastlaneSubcommands() {
    const program = new Command();

    registerMigrateCommand(program);

    function findCommand3(command: Command) {
      return command.name() == 'migrate';
    }

    const migrate = program.commands.find(findCommand3);

    function mapCommand(command: Command) {
      return command.name();
    }

    expect(migrate?.commands.map(mapCommand)).toEqual(['eas', 'fastlane']);
  }

  it(
    'attaches a `migrate` group with `eas` and `fastlane` subcommands',
    attachesAMigrateGroupWithEasAndFastlaneSubcommands,
  );

  function runName(name: string) {
    function readLong(option: CommandOption) {
      return option.long;
    }

    const options = subcommand(name)?.options.map(readLong);

    expect(options).toContain('--force');
    expect(options).toContain('--dry-run');
    expect(options).toContain('--out');
  }

  it.each(['eas', 'fastlane'])('%s takes --force, --dry-run, and --out', runName);
}

describe('registerMigrateCommand', describeRegisterMigrateCommand);
