import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatAgentsWriteSummary,
  managedBlockIsCurrent,
  normalizeLaunchVersion,
  mcpClientsForTargets,
  ownedAgentArtifact,
  parseAgentFlag as parseAgentFlagEffect,
  planAgentArtifacts,
  planBaseAndTaskArtifacts,
  type AgentArtifact,
  detectAgentTargets,
  findStaleAgentArtifacts,
  writeAgentArtifacts,
} from './command.js';
import { CONSUMER_SKILLS } from './registry.js';
import { renderCursorBaseRule, renderCursorTaskRule } from './render.js';

const parseAgentFlag = (agentFlag: string) => Effect.runSync(parseAgentFlagEffect(agentFlag));
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

  it('parses the multi-target agents correctly', () => {
    expect(parseAgentFlag('windsurf,copilot,kiro')).toEqual(['windsurf', 'copilot', 'kiro']);
    expect(parseAgentFlag('cline,amazonq')).toEqual(['cline', 'amazonq']);
  });

  it('rejects an unknown agent', () => {
    expect(() => parseAgentFlag('emacs')).toThrow(/Unknown agent/);
  });
});

describe('normalizeLaunchVersion / mcpClientsForTargets / formatAgentsWriteSummary', () => {
  it('defaults missing or empty Commander versions to 0.0.0', () => {
    expect(normalizeLaunchVersion(undefined)).toBe('0.0.0');
    expect(normalizeLaunchVersion('')).toBe('0.0.0');
    expect(normalizeLaunchVersion('1.2.3')).toBe('1.2.3');
  });

  it('maps only Claude and Cursor targets to MCP clients', () => {
    expect(mcpClientsForTargets(['codex', 'windsurf'])).toEqual([]);
    expect(mcpClientsForTargets(['claude', 'cursor', 'codex'])).toEqual(['claude-code', 'cursor']);
  });

  it('uses singular file noun for a single artifact', () => {
    expect(formatAgentsWriteSummary(1, ['codex'])).toBe('Wrote 1 file for codex.');
    expect(formatAgentsWriteSummary(2, ['claude', 'cursor'])).toBe(
      'Wrote 2 files for claude, cursor.',
    );
  });
});

describe('managedBlockIsCurrent', () => {
  it('classifies missing, stale, and current managed blocks', () => {
    const planned = '<!-- launch:start -->\nNEW\n<!-- launch:end -->';
    expect(managedBlockIsCurrent('no fences', planned)).toBe('missing-block');
    expect(managedBlockIsCurrent('<!-- launch:start -->\nOLD\n<!-- launch:end -->', planned)).toBe(
      'stale',
    );
    expect(managedBlockIsCurrent(planned, planned)).toBe('current');
  });
});

describe('ownedAgentArtifact / planBaseAndTaskArtifacts', () => {
  it('maps a generated file into an owned artifact', () => {
    expect(ownedAgentArtifact({ path: 'a.md', body: 'x\n' })).toEqual({
      kind: 'owned',
      path: 'a.md',
      content: 'x\n',
    });
  });

  it('plans one base rule plus one task rule per consumer skill', () => {
    const planned = planBaseAndTaskArtifacts('1.0.0', renderCursorBaseRule, renderCursorTaskRule);
    expect(planned[0]).toMatchObject({ kind: 'owned', path: '.cursor/rules/launch.mdc' });
    expect(planned).toHaveLength(1 + CONSUMER_SKILLS.length);
    expect(planned.map((artifact) => artifact.path)).toContain('.cursor/rules/launch-ship.mdc');
  });
});

describe('detectAgentTargets', () => {
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

describe('planAgentArtifacts', () => {
  it('writes only Cursor files for the cursor target (base rule + one rule per skill)', () => {
    const artifactPaths = planAgentArtifacts(['cursor'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.cursor/rules/launch.mdc');
    expect(artifactPaths).toContain('.cursor/rules/launch-ship.mdc');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });

  it('writes only the AGENTS.md block for the codex target', () => {
    expect(planAgentArtifacts(['codex'], '1.0.0')).toEqual([
      { kind: 'spliced', path: 'AGENTS.md', block: expect.any(String) },
    ]);
  });

  it('writes AGENTS.md once when both claude and codex are selected', () => {
    const agentsBlocks = planAgentArtifacts(['claude', 'codex'], '1.0.0').filter(
      (artifact) => artifact.path === 'AGENTS.md',
    );
    expect(agentsBlocks).toHaveLength(1);
  });

  it('writes AGENTS.md + CLAUDE.md + the skills (incl. the bundled reference) for claude', () => {
    const artifactPaths = planAgentArtifacts(['claude'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('AGENTS.md');
    expect(artifactPaths).toContain('CLAUDE.md');
    expect(artifactPaths).toContain('.claude/skills/launch-ship/SKILL.md');
    expect(artifactPaths).toContain('.claude/skills/launch-store-config/reference.md');
  });

  it('writes Windsurf base rule + one task rule per skill for windsurf', () => {
    const artifactPaths = planAgentArtifacts(['windsurf'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.windsurf/rules/launch.md');
    expect(artifactPaths).toContain('.windsurf/rules/launch-ship.md');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });

  it('writes a spliced copilot-instructions block for copilot', () => {
    const plannedArtifacts = planAgentArtifacts(['copilot'], '1.0.0');
    expect(plannedArtifacts).toEqual([
      { kind: 'spliced', path: '.github/copilot-instructions.md', block: expect.any(String) },
    ]);
  });

  it('writes a single Kiro steering hook for kiro', () => {
    const plannedArtifacts = planAgentArtifacts(['kiro'], '1.0.0');
    expect(plannedArtifacts).toEqual([
      { kind: 'owned', path: '.kiro/steering/launch.md', content: expect.any(String) },
    ]);
  });

  it('writes Cline base rule + one task rule per skill for cline', () => {
    const artifactPaths = planAgentArtifacts(['cline'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.cline/rules/launch.md');
    expect(artifactPaths).toContain('.cline/rules/launch-ship.md');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });

  it('writes Amazon Q base rule + one task rule per skill for amazonq', () => {
    const artifactPaths = planAgentArtifacts(['amazonq'], '1.0.0').map(
      (plannedArtifact) => plannedArtifact.path,
    );
    expect(artifactPaths).toContain('.amazonq/rules/launch.md');
    expect(artifactPaths).toContain('.amazonq/rules/launch-ship.md');
    expect(artifactPaths).not.toContain('AGENTS.md');
  });
});

describe('write to check round-trip', () => {
  it('reports no drift right after writing, drift after an edit, and clean again after rewriting', async () => {
    const plannedArtifacts = planAgentArtifacts(['claude', 'cursor'], '1.0.0');
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
    await writeArtifacts(temporaryRepositoryPath, planAgentArtifacts(['codex'], '1.0.0'));
    const staleArtifactPaths = await findStaleArtifacts(
      temporaryRepositoryPath,
      planAgentArtifacts(['codex'], '2.0.0'),
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
    const plannedArtifacts = planAgentArtifacts(['codex'], '1.0.0');
    await writeArtifacts(temporaryRepositoryPath, plannedArtifacts);

    const agentsInstructions = readFileSync(join(temporaryRepositoryPath, 'AGENTS.md'), 'utf8');
    expect(agentsInstructions).toContain('# My app rules');
    expect(agentsInstructions).toContain("Don't break the build.");
    expect(agentsInstructions).toContain('Shipping this app with Launch');
    expect(await findStaleArtifacts(temporaryRepositoryPath, plannedArtifacts)).toEqual([]);
  });
});
