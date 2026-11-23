import { describe, expect, it } from 'vitest';
import { Command, type CommandOption } from '../../command.ts';
import { registerConfigCommand } from './config.ts';
/** Find the `config` group's named subcommand, asserting the group exists. */
function subcommand(name: string) {
  const program = new Command();

  registerConfigCommand(program);

  function findCommand(command: Command) {
    return command.name() == 'config';
  }

  const config = program.commands.find(findCommand);

  expect(config).toBeDefined();

  function findCommand2(command: Command) {
    return command.name() == name;
  }

  return config?.commands.find(findCommand2);
}
function describeRegisterPieceCommand() {
  function attachesAPieceGroupWithSchemaValidateAndDocsSubcommands() {
    const program = new Command();

    registerConfigCommand(program);

    function findCommand3(command: Command) {
      return command.name() == 'config';
    }

    const config = program.commands.find(findCommand3);

    function mapCommand(command: Command) {
      return command.name();
    }

    expect(config?.commands.map(mapCommand)).toEqual(['schema', 'validate', 'docs']);
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
