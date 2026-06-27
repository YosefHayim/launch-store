import { describe, expect, it } from 'vitest';
import { buildProgram } from '../../cli/program.js';
import { CONSUMER_SKILLS, CONTRIBUTOR_RULES } from './registry.js';
import { findUnknownCommands } from './validate.js';

describe('the agent skill registry stays in sync with the CLI', () => {
  it('names only commands that exist in the live program', () => {
    expect(findUnknownCommands(buildProgram())).toEqual([]);
  });

  it('ships the task skills, in pipeline order, with unique ids', () => {
    const ids = CONSUMER_SKILLS.map((skill) => skill.id);
    expect(ids).toEqual([
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
    expect(new Set(ids).size).toBe(ids.length);
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
    const [base, ...scoped] = CONTRIBUTOR_RULES;
    expect(base!.alwaysApply).toBe(true);
    expect(base!.globs).toEqual([]);
    for (const rule of scoped) {
      expect(rule.alwaysApply, `${rule.file} alwaysApply`).toBe(false);
      expect(rule.globs.length, `${rule.file} globs`).toBeGreaterThan(0);
    }
  });

  it('flags a renamed or removed command instead of silently passing', () => {
    const broken = [
      { ...CONSUMER_SKILLS[0]!, steps: [{ path: ['not-a-real-command'], note: 'x' }] },
    ];
    expect(findUnknownCommands(buildProgram(), broken)).toHaveLength(1);
  });
});
