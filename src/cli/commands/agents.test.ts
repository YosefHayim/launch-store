import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { CONSUMER_SKILLS, CONTRIBUTOR_RULES } from '@core/agents/registry.js';
import { findUnknownCommands } from '@core/agents/validate.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { buildProgram } from '../program.js';
import * as agentsModule from './agents.js';
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

describe('registerAgentsCommand - thin CLI boundary', () => {
  it('exports registration and the registered-command tree adapter', () => {
    expect(Object.keys(agentsModule).sort()).toEqual([
      'registerAgentsCommand',
      'registeredCommandTree',
    ]);
  });

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
  it('ships the task skills, in pipeline order, with unique ids', () => {
    const skillIds = CONSUMER_SKILLS.map((skill) => skill.id);
    expect(skillIds).toEqual([
      'launch-ship',
      'launch-release',
      'launch-store-config',
      'launch-ota',
      'launch-ci',
      'launch-doctor',
      'launch-verify',
      'launch-plan',
      'launch-snapshot',
      'launch-migrate',
      'launch-insights',
      'launch-ai-listing',
      'launch-agent-access',
    ]);
    expect(new Set(skillIds).size).toBe(skillIds.length);
  });
  it('gives every skill a triggering description, triggers, and at least one step', () => {
    for (const skill of CONSUMER_SKILLS) {
      expect(skill.description.length, `${skill.id} description`).toBeGreaterThan(0);
      expect(skill.triggers.length, `${skill.id} triggers`).toBeGreaterThan(0);
      expect(skill.steps.length, `${skill.id} steps`).toBeGreaterThan(0);
    }
  });
  it('bundles a reference only for the large store-config skill (progressive disclosure)', () => {
    const withReference = CONSUMER_SKILLS.filter((skill) => skill.reference).map(
      (skill) => skill.id,
    );
    expect(withReference).toEqual(['launch-store-config']);
  });
  it('starts the contributor rules with an always-on base rule and then glob-scoped rules', () => {
    const base = expectArrayElement(CONTRIBUTOR_RULES, 0, 'CONTRIBUTOR_RULES');
    const scoped = CONTRIBUTOR_RULES.slice(1);
    expect(base.alwaysApply).toBe(true);
    expect(base.globs).toEqual([]);
    for (const rule of scoped) {
      expect(rule.alwaysApply, `${rule.file} alwaysApply`).toBe(false);
      expect(rule.globs.length, `${rule.file} globs`).toBeGreaterThan(0);
    }
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
