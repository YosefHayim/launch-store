import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { CONSUMER_SKILLS } from '@/agents/registry.js';
import { findUnknownCommands } from '@/agents/validate.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { buildProgram } from '@cli/program.js';
import { registerAgentsCommand, registeredCommandTree } from './agents.js';

const agentsCommand = () => {
  const program = new Command();
  registerAgentsCommand(program);
  const agents = program.commands.find((command) => command.name() === 'agents');
  expect(agents).toBeDefined();
  if (agents === undefined) {
    throw new Error('expected agents command to be registered');
  }
  return agents;
};

describe('registerAgentsCommand', () => {
  it('wires init and check with a shared --agent option', () => {
    const agents = agentsCommand();
    const subcommandNames = agents.commands.map((command) => command.name());
    expect(subcommandNames).toEqual(expect.arrayContaining(['init', 'check']));
    const initCommand = agents.commands.find((command) => command.name() === 'init');
    const checkCommand = agents.commands.find((command) => command.name() === 'check');
    expect(initCommand).toBeDefined();
    expect(checkCommand).toBeDefined();
    if (initCommand === undefined) {
      throw new Error('expected init subcommand');
    }
    if (checkCommand === undefined) {
      throw new Error('expected check subcommand');
    }
    expect(initCommand.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--agent', '--yes']),
    );
    expect(checkCommand.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--agent']),
    );
  });

  it('flattens Commander names and aliases into the validator tree', () => {
    const program = new Command().name('launch');
    const nested = program.command('parent').alias('p');
    nested.command('child').alias('c');
    expect(registeredCommandTree(program)).toEqual({
      name: 'launch',
      aliases: [],
      commands: [
        {
          name: 'parent',
          aliases: ['p'],
          commands: [{ name: 'child', aliases: ['c'], commands: [] }],
        },
      ],
    });
  });
});

describe('the agent skill registry stays in sync with the CLI', () => {
  it('names only commands that exist in the live program', () => {
    expect(findUnknownCommands(registeredCommandTree(buildProgram()))).toEqual([]);
  });
  it('flags a renamed or removed command instead of silently passing', () => {
    const staleRegistry = [
      {
        ...expectArrayElement(CONSUMER_SKILLS, 0, 'CONSUMER_SKILLS'),
        steps: [{ path: ['not-a-real-command'], note: 'x' }],
      },
    ];
    expect(findUnknownCommands(registeredCommandTree(buildProgram()), staleRegistry)).toHaveLength(
      1,
    );
  });
});
