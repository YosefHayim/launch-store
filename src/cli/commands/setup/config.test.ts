import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '@/cli/command.js';
import { registerConfigCommand } from './config.ts';

/** Find the `config` group's named subcommand, asserting the group exists. */
function subcommand(name: string) {
  const program = new Command();

  registerConfigCommand(program);

  function isLaunchFileCommand(command: Command) {
    return command.name() == 'config';
  }

  const config = program.commands.find(isLaunchFileCommand);

  expect(config).toBeDefined();

  function hasSubcommandName(command: Command) {
    return command.name() == name;
  }

  return config?.commands.find(hasSubcommandName);
}

function describeRegisterPieceCommand() {
  function attachesAPieceGroupWithSchemaValidateAndDocsSubcommands() {
    const program = new Command();

    registerConfigCommand(program);

    function isLaunchFileCommand(command: Command) {
      return command.name() == 'config';
    }

    const config = program.commands.find(isLaunchFileCommand);

    function readCommandName(command: Command) {
      return command.name();
    }

    expect(config?.commands.map(readCommandName)).toEqual(['schema', 'validate', 'docs']);
  }

  it(
    'attaches a `config` group with `schema`, `validate`, and `docs` subcommands',
    attachesAPieceGroupWithSchemaValidateAndDocsSubcommands,
  );

  function schemaTakesOut() {
    function readLong(option: CommandOption) {
      return option.long;
    }

    expect(subcommand('schema')?.options.map(readLong)).toContain('--out');
  }

  it('schema takes --out', schemaTakesOut);

  function validateTakesAnOptionalFileArgument() {
    const validate = subcommand('validate');
    expect(validate?.registeredArguments).toHaveLength(1);
    expect(validate?.registeredArguments[0]?.required).toBe(false);
  }

  it('validate takes an optional [file] argument', validateTakesAnOptionalFileArgument);
}

describe('registerConfigCommand', describeRegisterPieceCommand);
