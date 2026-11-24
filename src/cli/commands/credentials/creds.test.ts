import { Command, type CommandOption } from '../../command.ts';
import { describe, expect, it } from 'vitest';
import { registerCredsCommand } from './creds.ts';

function credsCommand() {
  const program = new Command();

  registerCredsCommand(program);

  function isCredsCommand(command: Command) {
    return command.readName() == 'creds';
  }

  const creds = program.commands.find(isCredsCommand);

  expect(creds).toBeDefined();

  return creds;
}

function describeRegisterCredsCommandNonInteractiveAppSelector261() {
  function definesAppSoCredsSetupAppNameNoLongerErrorsWithUnknownOption() {
    function readLong(option: CommandOption) {
      return option.long;
    }

    const longs = credsCommand()?.options.map(readLong);

    expect(longs).toContain('--app');
  }

  it(
    'defines --app so `creds setup --app <name>` no longer errors with "unknown option"',
    definesAppSoCredsSetupAppNameNoLongerErrorsWithUnknownOption,
  );

  function keepsAccountAndYesAlongsideAppForAFullyNonInteractiveSetup() {
    function readLong2(option: CommandOption) {
      return option.long;
    }

    const longs = credsCommand()?.options.map(readLong2);

    expect(longs).toContain('--account');
    expect(longs).toContain('--yes');
  }

  it(
    'keeps --account and --yes alongside --app for a fully non-interactive setup',
    keepsAccountAndYesAlongsideAppForAFullyNonInteractiveSetup,
  );
}

describe(
  'registerCredsCommand - non-interactive app selector (#261)',
  describeRegisterCredsCommandNonInteractiveAppSelector261,
);
