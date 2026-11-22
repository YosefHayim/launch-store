import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatAgentsWriteSummary,
  managedBlockIsCurrent,
  normalizeLaunchVersion,
  mcpClientsForTargets,
  ownedAgentArtifact,
  parseAgentFlag,
  planAgentArtifacts,
  planBaseAndTaskArtifacts,
  detectAgentTargets,
  findStaleAgentArtifacts,
  writeAgentArtifacts,
} from './command.ts';
import { CONSUMER_SKILLS } from './registry.ts';
import { renderCursorBaseRule, renderCursorTaskRule } from './render.ts';

let temporaryRepositoryPath: string;

beforeEach(() => {
  const systemTemporaryDirectory = tmpdir();
  const launchAgentsPath = join(systemTemporaryDirectory, 'launch-agents-');
  temporaryRepositoryPath = mkdtempSync(launchAgentsPath);
});

afterEach(() => {
  rmSync(temporaryRepositoryPath, { recursive: true, force: true });
});

describe('parseAgentFlag', () => {
  it('expands `all` and dedupes an explicit subset', () => {
    const agentFlag = parseAgentFlag('all');
    expect(agentFlag).toEqual([
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
    const agentFlag = parseAgentFlag('windsurf,copilot,kiro');
    expect(agentFlag).toEqual(['windsurf', 'copilot', 'kiro']);
    expect(parseAgentFlag('cline,amazonq')).toEqual(['cline', 'amazonq']);
  });

  it('rejects an unknown agent', () => {
    let thrownFailure: unknown = null;

    try {
      parseAgentFlag('emacs');
    } catch (error) {
      thrownFailure = error;
    }

    expect(thrownFailure).toMatchObject({
      _tag: 'AgentsCommandFailure',
      operation: 'parse --agent',
      message:
        'Unknown agent "emacs". Use claude, cursor, codex, windsurf, copilot, kiro, cline, amazonq, or all.',
    });
  });
});

describe('normalizeLaunchVersion / mcpClientsForTargets / formatAgentsWriteSummary', () => {
  it('defaults missing or empty Commander versions to 0.0.0', () => {
    const launchVersion = normalizeLaunchVersion(undefined);
    expect(launchVersion).toBe('0.0.0');
    expect(normalizeLaunchVersion('')).toBe('0.0.0');
    expect(normalizeLaunchVersion('1.2.3')).toBe('1.2.3');
  });

  it('maps only Claude and Cursor targets to MCP clients', () => {
    expect(mcpClientsForTargets(['codex', 'windsurf'])).toEqual([]);
    expect(mcpClientsForTargets(['claude', 'cursor', 'codex'])).toEqual(['claude-code', 'cursor']);
  });

  it('uses singular file noun for a single artifact', () => {
    const agentsWriteSummary = formatAgentsWriteSummary(1, ['codex']);
    expect(agentsWriteSummary).toBe('Wrote 1 file for codex.');
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
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toEqual([]);
  });

  it("maps each agent's footprint to its target", async () => {
    const claudePath = join(temporaryRepositoryPath, 'CLAUDE.md');
    writeFileSync(claudePath, '# notes\n');
    const joinedPath = join(temporaryRepositoryPath, '.cursor');
    mkdirSync(joinedPath);
    const agentsPath = join(temporaryRepositoryPath, 'AGENTS.md');
    writeFileSync(agentsPath, '# rules\n');
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toEqual(['claude', 'cursor', 'codex']);
  });

  it('detects windsurf from .windsurf directory', async () => {
    const joinedPath = join(temporaryRepositoryPath, '.windsurf');
    mkdirSync(joinedPath);
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toContain('windsurf');
  });

  it('detects copilot from .github/copilot-instructions.md', async () => {
    const joinedPath = join(temporaryRepositoryPath, '.github');
    mkdirSync(joinedPath);
    const copilotInstructionsPath = join(
      temporaryRepositoryPath,
      '.github/copilot-instructions.md',
    );
    writeFileSync(copilotInstructionsPath, '# copilot\n');
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toContain('copilot');
  });

  it('detects kiro from .kiro directory', async () => {
    const joinedPath = join(temporaryRepositoryPath, '.kiro');
    mkdirSync(joinedPath);
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toContain('kiro');
  });

  it('detects cline from .cline directory', async () => {
    const joinedPath = join(temporaryRepositoryPath, '.cline');
    mkdirSync(joinedPath);
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toContain('cline');
  });

  it('detects cline from .clinerules file', async () => {
    const joinedPath = join(temporaryRepositoryPath, '.clinerules');
    writeFileSync(joinedPath, '# rules\n');
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toContain('cline');
  });

  it('detects amazonq from .amazonq directory', async () => {
    const joinedPath = join(temporaryRepositoryPath, '.amazonq');
    mkdirSync(joinedPath);
    const agentTargets = await detectAgentTargets(temporaryRepositoryPath);
    expect(agentTargets).toContain('amazonq');
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
    const agentArtifacts = planAgentArtifacts(['codex'], '1.0.0');
    expect(agentArtifacts).toEqual([
      { kind: 'spliced', path: 'AGENTS.md', block: expect.any(String) },
    ]);
  });

  it('writes AGENTS.md once when both claude and codex are selected', () => {
    const agentsBlocks = planAgentArtifacts(['claude', 'codex'], '1.0.0').filter(
      (artifact) => artifact.path == 'AGENTS.md',
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
    await writeAgentArtifacts(temporaryRepositoryPath, plannedArtifacts);
    const staleAgentArtifacts = await findStaleAgentArtifacts(
      temporaryRepositoryPath,
      plannedArtifacts,
    );
    expect(staleAgentArtifacts).toEqual([]);

    const launchShipPath = join(temporaryRepositoryPath, '.cursor/rules/launch-ship.mdc');
    writeFileSync(launchShipPath, 'tampered\n');
    expect(await findStaleAgentArtifacts(temporaryRepositoryPath, plannedArtifacts)).toContain(
      '.cursor/rules/launch-ship.mdc',
    );

    await writeAgentArtifacts(temporaryRepositoryPath, plannedArtifacts);
    expect(await findStaleAgentArtifacts(temporaryRepositoryPath, plannedArtifacts)).toEqual([]);
  });

  it('flags drift when the installed version moved past what scaffolded the files', async () => {
    const agentArtifacts = planAgentArtifacts(['codex'], '1.0.0');
    await writeAgentArtifacts(temporaryRepositoryPath, agentArtifacts);
    const staleArtifactPaths = await findStaleAgentArtifacts(
      temporaryRepositoryPath,
      planAgentArtifacts(['codex'], '2.0.0'),
    );
    expect(staleArtifactPaths).toContain('AGENTS.md');
  });
});

describe('managed-block splicing into an existing AGENTS.md', () => {
  it("preserves the user's own AGENTS.md content and adds the Launch block", async () => {
    const agentsPath = join(temporaryRepositoryPath, 'AGENTS.md');
    writeFileSync(agentsPath, "# My app rules\n\nDon't break the build.\n");
    const plannedArtifacts = planAgentArtifacts(['codex'], '1.0.0');
    await writeAgentArtifacts(temporaryRepositoryPath, plannedArtifacts);

    const joinedPath = join(temporaryRepositoryPath, 'AGENTS.md');
    const agentsInstructions = readFileSync(joinedPath, 'utf8');
    expect(agentsInstructions).toContain('# My app rules');
    expect(agentsInstructions).toContain("Don't break the build.");
    expect(agentsInstructions).toContain('Shipping this app with Launch');
    const staleAgentArtifacts = await findStaleAgentArtifacts(
      temporaryRepositoryPath,
      plannedArtifacts,
    );
    expect(staleAgentArtifacts).toEqual([]);
  });
});
