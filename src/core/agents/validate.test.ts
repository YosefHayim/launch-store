import { describe, expect, it } from 'vitest';
import type { ConsumerSkill } from '../types/agents.js';
import {
  commandPathIsRegistered,
  findUnknownCommands,
  formatUnknownSkillCommand,
  skillReferencedCommands,
  type RegisteredCommand,
} from './validate.js';

const leaf = (name: string, aliases: readonly string[] = []): RegisteredCommand => ({
  name,
  aliases,
  commands: [],
});

const branch = (
  name: string,
  commands: readonly RegisteredCommand[],
  aliases: readonly string[] = [],
): RegisteredCommand => ({
  name,
  aliases,
  commands,
});

/** Minimal CLI tree covering paths and aliases exercised by the pure validator. */
const sampleCli: RegisteredCommand = branch('launch', [
  leaf('build'),
  branch('metadata', [leaf('pull'), leaf('push')]),
  branch('creds', [leaf('status')], ['credentials']),
  leaf('sync'),
]);

const skill = (partial: {
  id: string;
  steps: ConsumerSkill['steps'];
  reference?: ConsumerSkill['reference'];
}): ConsumerSkill => {
  if (partial.reference === undefined) {
    return {
      id: partial.id,
      title: partial.id,
      description: partial.id,
      triggers: ['test'],
      steps: partial.steps,
      body: '',
    };
  }
  return {
    id: partial.id,
    title: partial.id,
    description: partial.id,
    triggers: ['test'],
    steps: partial.steps,
    body: '',
    reference: partial.reference,
  };
};

describe('commandPathIsRegistered', () => {
  it('rejects an empty path', () => {
    expect(commandPathIsRegistered(sampleCli, [])).toBe(false);
  });

  it('accepts a top-level command by name', () => {
    expect(commandPathIsRegistered(sampleCli, ['build'])).toBe(true);
  });

  it('accepts a nested command path', () => {
    expect(commandPathIsRegistered(sampleCli, ['metadata', 'pull'])).toBe(true);
  });

  it('accepts a top-level alias', () => {
    expect(commandPathIsRegistered(sampleCli, ['credentials'])).toBe(true);
  });

  it('rejects a missing top-level command', () => {
    expect(commandPathIsRegistered(sampleCli, ['release'])).toBe(false);
  });

  it('rejects a missing nested command', () => {
    expect(commandPathIsRegistered(sampleCli, ['metadata', 'diff'])).toBe(false);
  });

  it('rejects a path that walks past a leaf', () => {
    expect(commandPathIsRegistered(sampleCli, ['build', 'ios'])).toBe(false);
  });
});

describe('skillReferencedCommands', () => {
  it('returns only recipe steps when a skill has no reference catalog', () => {
    const consumerSkill = skill({
      id: 'launch-ship',
      steps: [{ path: ['build'], note: 'build' }],
    });
    expect(skillReferencedCommands(consumerSkill)).toEqual([{ path: ['build'], note: 'build' }]);
  });

  it('appends reference catalog commands after recipe steps', () => {
    const consumerSkill = skill({
      id: 'launch-store-config',
      steps: [{ path: ['sync'], note: 'sync' }],
      reference: {
        intro: 'catalog',
        commands: [{ path: ['metadata', 'pull'], note: 'pull' }],
      },
    });
    expect(skillReferencedCommands(consumerSkill)).toEqual([
      { path: ['sync'], note: 'sync' },
      { path: ['metadata', 'pull'], note: 'pull' },
    ]);
  });
});

describe('formatUnknownSkillCommand', () => {
  it('formats the skill id and full launch path', () => {
    expect(formatUnknownSkillCommand('launch-ship', ['metadata', 'pull'])).toBe(
      'launch-ship: launch metadata pull',
    );
  });
});

describe('findUnknownCommands', () => {
  it('returns an empty list when every skill path exists', () => {
    const skills = [
      skill({
        id: 'launch-ship',
        steps: [
          { path: ['build'], note: 'build only; ios is an arg' },
          { path: ['creds'], note: 'parent command only' },
        ],
      }),
      skill({
        id: 'launch-store-config',
        steps: [{ path: ['sync'], note: 'sync' }],
        reference: {
          intro: 'catalog',
          commands: [{ path: ['metadata', 'push'], note: 'push' }],
        },
      }),
    ];
    expect(findUnknownCommands(sampleCli, skills)).toEqual([]);
  });

  it('reports each unknown path with its skill id', () => {
    const skills = [
      skill({
        id: 'launch-ship',
        steps: [
          { path: ['build'], note: 'ok' },
          { path: ['not-real'], note: 'missing' },
        ],
      }),
      skill({
        id: 'launch-store-config',
        steps: [{ path: ['sync'], note: 'ok' }],
        reference: {
          intro: 'catalog',
          commands: [{ path: ['metadata', 'diff'], note: 'missing nested' }],
        },
      }),
    ];
    expect(findUnknownCommands(sampleCli, skills)).toEqual([
      'launch-ship: launch not-real',
      'launch-store-config: launch metadata diff',
    ]);
  });

  it('does not treat skill args as command path segments', () => {
    const skills = [
      skill({
        id: 'launch-ship',
        steps: [{ path: ['build'], args: ['ios'], note: 'platform is an arg' }],
      }),
    ];
    expect(findUnknownCommands(sampleCli, skills)).toEqual([]);
  });
});
