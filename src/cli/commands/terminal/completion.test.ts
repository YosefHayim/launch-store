import { describe, expect, it } from 'vitest';
import { Command, type CommandOption, type CommandArgument } from '../../command.ts';
import { registerCompletionCommand } from './completion.ts';
/** The `completion` group from a fresh program, asserting it registered. */
function completionGroup(): Command {
  const program = new Command();

  registerCompletionCommand(program);

  function findCommand(command: Command) {
    return command.name() == 'completion';
  }

  const completion = program.commands.find(findCommand);

  expect(completion).toBeDefined();

  if (!completion) throw new Error('completion group missing');

  return completion;
}
function describeRegisterCompletionCommand() {
  function attachesACompletionGroupWithInstallAndTheHiddenCompleteSubcommand() {
    function mapCommand(command: Command) {
      return command.name();
    }

    const names = completionGroup().commands.map(mapCommand).sort();

    expect(names).toEqual(['__complete', 'install']);
  }

  it(
    'attaches a `completion` group with install and the hidden __complete subcommand',
    attachesACompletionGroupWithInstallAndTheHiddenCompleteSubcommand,
  );

  function takesAnOptionalShellArgumentForPrintingTheScript() {
    function mapArgument(argument: CommandArgument) {
      return argument.name();
    }

    const args = completionGroup().registeredArguments.map(mapArgument);

    expect(args).toEqual(['shell']);
  }

  it(
    'takes an optional [shell] argument for printing the script',
    takesAnOptionalShellArgumentForPrintingTheScript,
  );

  function installTakesSShell() {
    function findCommand2(command: Command) {
      return command.name() == 'install';
    }

    const install = completionGroup().commands.find(findCommand2);

    function readLong(option: CommandOption) {
      return option.long;
    }

    const flags = install?.options.map(readLong);

    expect(flags).toContain('--shell');
  }

  it('install takes -s/--shell', installTakesSShell);

  function keepsTheCompleteSubcommandOutOfHelpWhileStillRegisteringIt() {
    const group = completionGroup();

    function someCommand(command: Command) {
      return command.name() == '__complete';
    }

    expect(group.commands.some(someCommand)).toBe(true);

    const visible = group.createHelp().visibleCommands(group);

    function someCommand2(command: Command) {
      return command.name() == '__complete';
    }

    expect(visible.some(someCommand2)).toBe(false);
  }

  it(
    'keeps the __complete subcommand out of help while still registering it',
    keepsTheCompleteSubcommandOutOfHelpWhileStillRegisteringIt,
  );
}

describe('registerCompletionCommand', describeRegisterCompletionCommand);
