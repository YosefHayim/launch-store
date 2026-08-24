import { describe, expect, it } from 'vitest';
import {
  BASE_CONTEXT,
  CONSUMER_SKILLS,
  CONTRIBUTOR_RULES,
  CONTRIBUTOR_SKILLS,
} from './registry.js';

describe('BASE_CONTEXT', () => {
  it('ships the EAS command map, rails, guardrails, and bootstrap steps', () => {
    expect(BASE_CONTEXT.intro.length).toBeGreaterThan(0);
    expect(BASE_CONTEXT.commandMap.length).toBeGreaterThan(0);
    expect(BASE_CONTEXT.rails.length).toBeGreaterThan(0);
    expect(BASE_CONTEXT.guardrail.free.length).toBeGreaterThan(0);
    expect(BASE_CONTEXT.guardrail.confirm.length).toBeGreaterThan(0);
    expect(BASE_CONTEXT.bootstrap.length).toBeGreaterThan(0);
  });

  it('maps each EAS command to a launch command', () => {
    for (const commandMapRow of BASE_CONTEXT.commandMap) {
      expect(commandMapRow.eas.startsWith('eas ')).toBe(true);
      expect(commandMapRow.launch.startsWith('launch ')).toBe(true);
      expect(commandMapRow.note.length).toBeGreaterThan(0);
    }
  });
});

describe('CONSUMER_SKILLS', () => {
  it('ships the task skills in pipeline order with unique ids', () => {
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
      'launch-ai-screenshots',
      'launch-agent-access',
    ]);
    expect(new Set(skillIds).size).toBe(skillIds.length);
  });

  it('gives every skill a description, triggers, body, and at least one step', () => {
    for (const skill of CONSUMER_SKILLS) {
      expect(skill.description.length, `${skill.id} description`).toBeGreaterThan(0);
      expect(skill.triggers.length, `${skill.id} triggers`).toBeGreaterThan(0);
      expect(skill.body.length, `${skill.id} body`).toBeGreaterThan(0);
      expect(skill.steps.length, `${skill.id} steps`).toBeGreaterThan(0);
      for (const skillStep of skill.steps) {
        expect(skillStep.path.length, `${skill.id} step path`).toBeGreaterThan(0);
        expect(skillStep.note.length, `${skill.id} step note`).toBeGreaterThan(0);
      }
    }
  });

  it('bundles a reference catalog only for the large store-config skill', () => {
    const skillsWithReference = CONSUMER_SKILLS.filter(
      (skill) => skill.reference !== undefined,
    ).map((skill) => skill.id);
    expect(skillsWithReference).toEqual(['launch-store-config']);
    const storeConfigSkill = CONSUMER_SKILLS.find((skill) => skill.id === 'launch-store-config');
    expect(storeConfigSkill?.reference?.commands.length).toBeGreaterThan(0);
  });
});

describe('CONTRIBUTOR_RULES', () => {
  it('starts with an always-on base rule and then glob-scoped rules', () => {
    expect(CONTRIBUTOR_RULES.length).toBeGreaterThan(1);
    const baseRule = CONTRIBUTOR_RULES[0];
    expect(baseRule).toBeDefined();
    if (baseRule === undefined) return;
    expect(baseRule.alwaysApply).toBe(true);
    expect(baseRule.globs).toEqual([]);
    expect(baseRule.body.length).toBeGreaterThan(0);
    for (const scopedRule of CONTRIBUTOR_RULES.slice(1)) {
      expect(scopedRule.alwaysApply, `${scopedRule.file} alwaysApply`).toBe(false);
      expect(scopedRule.globs.length, `${scopedRule.file} globs`).toBeGreaterThan(0);
      expect(scopedRule.body.length, `${scopedRule.file} body`).toBeGreaterThan(0);
    }
  });
});

describe('CONTRIBUTOR_SKILLS', () => {
  it('ships unique contributor workflow recipes with free-form steps', () => {
    const skillIds = CONTRIBUTOR_SKILLS.map((skill) => skill.id);
    expect(skillIds).toEqual([
      'run-the-gate',
      'add-a-provider',
      'add-a-command',
      'add-a-glossary-topic',
    ]);
    expect(new Set(skillIds).size).toBe(skillIds.length);
    for (const skill of CONTRIBUTOR_SKILLS) {
      expect(skill.description.length, `${skill.id} description`).toBeGreaterThan(0);
      expect(skill.triggers.length, `${skill.id} triggers`).toBeGreaterThan(0);
      expect(skill.steps.length, `${skill.id} steps`).toBeGreaterThan(0);
      expect(skill.body.length, `${skill.id} body`).toBeGreaterThan(0);
    }
  });
});
