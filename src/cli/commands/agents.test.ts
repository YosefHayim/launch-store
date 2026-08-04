import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseAgentFlag as parseAgentFlagEffect,
  planAgentArtifacts,
  type AgentArtifact,
  detectAgentTargets,
  findStaleAgentArtifacts,
  writeAgentArtifacts,
} from '@core/agents/command.js';
import { CONSUMER_SKILLS, CONTRIBUTOR_RULES } from '@core/agents/registry.js';
import { findUnknownCommands } from '@core/agents/validate.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { buildProgram } from '../program.js';
import { registeredCommandTree } from './agents.js';

const parseAgentFlag = (agentFlag: string) => Effect.runSync(parseAgentFlagEffect(agentFlag));
const planArtifacts = planAgentArtifacts;
const detectTargets = (repositoryPath: string) =>
  Effect.runPromise(detectAgentTargets(repositoryPath).pipe(Effect.provide(NodeContext.layer)));
const writeArtifacts = (repositoryPath: string, artifacts: readonly AgentArtifact[]) =>
  Effect.runPromise(
    writeAgentArtifacts(repositoryPath, artifacts).pipe(Effect.provide(NodeContext.layer)),
  );
const findStaleArtifacts = (repositoryPath: string, artifacts: readonly AgentArtifact[]) =>
  Effect.runPromise(
    findStaleAgentArtifacts(repositoryPath, artifacts).pipe(Effect.provide(NodeContext.layer)),
  );

let temporaryRepositoryPath: string;

beforeEach(() => {
  temporaryRepositoryPath = mkdtempSync(join(tmpdir(), 'launch-agents-'));
});

afterEach(() => {
  rmSync(temporaryRepositoryPath, { recursive: true, force: true });
});

describe('parseAgentFlag', () => {
  it('expands `all` and dedupes an explicit subset', () => {
    expect(parseAgentFlag('all')).toEqual([
      'claude',
      'cursor',
      'codex',
      'windsurf',
      'copilot',
      'kiro',
      'cline',
      'amazonq',
    ]);
    expect(parseAgentFlag('cursor, claude ,cursor')).toEqual(['cursor', 'claude']);
  });

  it('parses the new agents correctly', () => {
    expect(parseAgentFlag('windsurf,copilot,kiro')).toEqual(['windsurf', 'copilot', 'kiro']);
    expect(parseAgentFlag('cline,amazonq')).toEqual(['cline', 'amazonq']);
  });

  it('rejects an unknown agent', () => {
    expect(() => parseAgentFlag('emacs')).toThrow(/Unknown agent/);
  });
});

describe('detectTargets', () => {
  it('finds nothing in an empty repo', async () => {
    expect(await detectTargets(temporaryRepositoryPath)).toEqual([]);
  });

  it("maps each agent's footprint to its target", async () => {
    writeFileSync(join(temporaryRepositoryPath, 'CLAUDE.md'), '# notes\n');
    mkdirSync(join(temporaryRepositoryPath, '.cursor'));
    writeFileSync(join(temporaryRepositoryPath, 'AGENTS.md'), '# rules\n');
    expect(await detectTargets(temporaryRepositoryPath)).toEqual(['claude', 'cursor', 'codex']);
  });

  it('detects windsurf from .windsurf directory', async () => {
    mkdirSync(join(temporaryRepositoryPath, '.windsurf'));
    expect(await detectTargets(temporaryRepositoryPath)).toContain('windsurf');
  });

  it('detects copilot from .github/copilot-instructions.md', async () => {
    mkdirSync(join(temporaryRepositoryPath, '.github'));
    writeFileSync(join(temporaryRepositoryPath, '.github/copilot-instructions.md'), '# copilot\n');
    expect(await detectTargets(temporaryRepositoryPath)).toContain('copilot');
  });

  it('detects kiro from .kiro directory', async () => {
    mkdirSync(join(temporaryRepositoryPath, '.kiro'));
    expect(await detectTargets(temporaryRepositoryPath)).toContain('kiro');
  });

  it('detects cline from .cline directory', async () => {
    mkdirSync(join(temporaryRepositoryPath, '.cline'));
    expect(await detectTargets(temporaryRepositoryPath)).toContain('cline');
  });

  it('detects cline from .clinerules file', async () => {
    writeFileSync(join(temporaryRepositoryPath, '.clinerules'), '# rules\n');
    expect(await detectTargets(temporaryRepositoryPath)).toContain('cline');
  });

  it('detects amazonq from .amazonq directory', async () => {
    mkdirSync(join(temporaryRepositoryPath, '.amazonq'));
    expect(await detectTargets(temporaryRepositoryPath)).toContain('amazonq');
  });
});

describe('planArtifacts', () => {
  it('writes only Cursor files for the cursor target (base rule + one rule per skill)', () => {
    const artifactPaths = planArtifacts(['cursor'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.cursor/rules/launch.mdc');
    expect(artifactPaths).toContain('.cursor/rules/launch-ship.mdc');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });

  it('writes only the AGENTS.md block for the codex target', () => {
    expect(planArtifacts(['codex'], '1.0.0')).toEqual([
      { kind: 'spliced', path: 'AGENTS.md', block: expect.any(String) },
    ]);
  });

  it('writes AGENTS.md + CLAUDE.md + the skills (incl. the bundled reference) for claude', () => {
    const artifactPaths = planArtifacts(['claude'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('AGENTS.md');
    expect(artifactPaths).toContain('CLAUDE.md');
    expect(artifactPaths).toContain('.claude/skills/launch-ship/SKILL.md');
    expect(artifactPaths).toContain('.claude/skills/launch-store-config/reference.md');
  });

  it('writes Windsurf base rule + one task rule per skill for windsurf', () => {
    const artifactPaths = planArtifacts(['windsurf'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.windsurf/rules/launch.md');
    expect(artifactPaths).toContain('.windsurf/rules/launch-ship.md');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });

  it('writes a spliced copilot-instructions block for copilot', () => {
    const plannedArtifacts = planArtifacts(['copilot'], '1.0.0');
    expect(plannedArtifacts).toEqual([
      { kind: 'spliced', path: '.github/copilot-instructions.md', block: expect.any(String) },
    ]);
  });

  it('writes a single Kiro steering hook for kiro', () => {
    const plannedArtifacts = planArtifacts(['kiro'], '1.0.0');
    expect(plannedArtifacts).toEqual([
      { kind: 'owned', path: '.kiro/steering/launch.md', content: expect.any(String) },
    ]);
  });

  it('writes Cline base rule + one task rule per skill for cline', () => {
    const artifactPaths = planArtifacts(['cline'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.cline/rules/launch.md');
    expect(artifactPaths).toContain('.cline/rules/launch-ship.md');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });

  it('writes Amazon Q base rule + one task rule per skill for amazonq', () => {
    const artifactPaths = planArtifacts(['amazonq'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.amazonq/rules/launch.md');
    expect(artifactPaths).toContain('.amazonq/rules/launch-ship.md');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });
});

describe('write to check round-trip', () => {
  it('reports no drift right after writing, drift after an edit, and clean again after rewriting', async () => {
    const plannedArtifacts = planArtifacts(['claude', 'cursor'], '1.0.0');
    await writeArtifacts(temporaryRepositoryPath, plannedArtifacts);
    expect(await findStaleArtifacts(temporaryRepositoryPath, plannedArtifacts)).toEqual([]);

    writeFileSync(join(temporaryRepositoryPath, '.cursor/rules/launch-ship.mdc'), 'tampered\n');
    expect(await findStaleArtifacts(temporaryRepositoryPath, plannedArtifacts)).toContain(
      '.cursor/rules/launch-ship.mdc',
    );

    await writeArtifacts(temporaryRepositoryPath, plannedArtifacts);
    expect(await findStaleArtifacts(temporaryRepositoryPath, plannedArtifacts)).toEqual([]);
  });

  it('flags drift when the installed version moved past what scaffolded the files', async () => {
    await writeArtifacts(temporaryRepositoryPath, planArtifacts(['codex'], '1.0.0'));
    const staleArtifactPaths = await findStaleArtifacts(
      temporaryRepositoryPath,
      planArtifacts(['codex'], '2.0.0'),
    );
    expect(staleArtifactPaths).toContain('AGENTS.md');
  });
});

describe('managed-block splicing into an existing AGENTS.md', () => {
  it("preserves the user's own AGENTS.md content and adds the Launch block", async () => {
    writeFileSync(
      join(temporaryRepositoryPath, 'AGENTS.md'),
      "# My app rules\n\nDon't break the build.\n",
    );
    const plannedArtifacts = planArtifacts(['codex'], '1.0.0');
    await writeArtifacts(temporaryRepositoryPath, plannedArtifacts);

    const agentsInstructions = readFileSync(join(temporaryRepositoryPath, 'AGENTS.md'), 'utf8');
    expect(agentsInstructions).toContain('# My app rules');
    expect(agentsInstructions).toContain("Don't break the build.");
    expect(agentsInstructions).toContain('Shipping this app with Launch');
    expect(await findStaleArtifacts(temporaryRepositoryPath, plannedArtifacts)).toEqual([]);
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
