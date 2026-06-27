import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerConfigCommand } from './config.js';

/** Find the `config` group's named subcommand, asserting the group exists. */
function subcommand(name: string) {
  const program = new Command();
  registerConfigCommand(program);
  const config = program.commands.find((command) => command.name() === 'config');
  expect(config).toBeDefined();
  return config?.commands.find((command) => command.name() === name);
}

describe('registerConfigCommand', () => {
  it('attaches a `config` group with `schema`, `validate`, and `docs` subcommands', () => {
    const program = new Command();
    registerConfigCommand(program);
    const config = program.commands.find((command) => command.name() === 'config');
    expect(config?.commands.map((command) => command.name())).toEqual([
      'schema',
      'validate',
      'docs',
    ]);
  });

  it('schema takes --out', () => {
    expect(subcommand('schema')?.options.map((option) => option.long)).toContain('--out');
  });

  it('validate takes an optional [file] argument', () => {
    const validate = subcommand('validate');
    expect(validate?.registeredArguments).toHaveLength(1);
    expect(validate?.registeredArguments[0]?.required).toBe(false);
  });
});
