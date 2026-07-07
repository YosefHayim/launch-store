import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  detectTargets,
  findStaleArtifacts,
  parseAgentFlag,
  planArtifacts,
  writeArtifacts,
} from './agents.js';

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'launch-agents-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
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
  it('finds nothing in an empty repo', () => {
    expect(detectTargets(cwd)).toEqual([]);
  });

  it("maps each agent's footprint to its target", () => {
    writeFileSync(join(cwd, 'CLAUDE.md'), '# notes\n');
    mkdirSync(join(cwd, '.cursor'));
    writeFileSync(join(cwd, 'AGENTS.md'), '# rules\n');
    expect(detectTargets(cwd)).toEqual(['claude', 'cursor', 'codex']);
  });

  it('detects windsurf from .windsurf directory', () => {
    mkdirSync(join(cwd, '.windsurf'));
    expect(detectTargets(cwd)).toContain('windsurf');
  });

  it('detects copilot from .github/copilot-instructions.md', () => {
    mkdirSync(join(cwd, '.github'));
    writeFileSync(join(cwd, '.github/copilot-instructions.md'), '# copilot\n');
    expect(detectTargets(cwd)).toContain('copilot');
  });

  it('detects kiro from .kiro directory', () => {
    mkdirSync(join(cwd, '.kiro'));
    expect(detectTargets(cwd)).toContain('kiro');
  });

  it('detects cline from .cline directory', () => {
    mkdirSync(join(cwd, '.cline'));
    expect(detectTargets(cwd)).toContain('cline');
  });

  it('detects cline from .clinerules file', () => {
    writeFileSync(join(cwd, '.clinerules'), '# rules\n');
    expect(detectTargets(cwd)).toContain('cline');
  });

  it('detects amazonq from .amazonq directory', () => {
    mkdirSync(join(cwd, '.amazonq'));
    expect(detectTargets(cwd)).toContain('amazonq');
  });
});

describe('planArtifacts', () => {
  it('writes only Cursor files for the cursor target (base rule + one rule per skill)', () => {
    const paths = planArtifacts(['cursor'], '1.0.0').map((a) => a.path);
    expect(paths).toContain('.cursor/rules/launch.mdc');
    expect(paths).toContain('.cursor/rules/launch-ship.mdc');
    expect(paths).not.toContain('AGENTS.md');
  });

  it('writes only the AGENTS.md block for the codex target', () => {
    expect(planArtifacts(['codex'], '1.0.0')).toEqual([
      { kind: 'spliced', path: 'AGENTS.md', block: expect.any(String) },
    ]);
  });

  it('writes AGENTS.md + CLAUDE.md + the skills (incl. the bundled reference) for claude', () => {
    const paths = planArtifacts(['claude'], '1.0.0').map((a) => a.path);
    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('CLAUDE.md');
    expect(paths).toContain('.claude/skills/launch-ship/SKILL.md');
    expect(paths).toContain('.claude/skills/launch-store-config/reference.md');
  });

  it('writes Windsurf base rule + one task rule per skill for windsurf', () => {
    const paths = planArtifacts(['windsurf'], '1.0.0').map((a) => a.path);
    expect(paths).toContain('.windsurf/rules/launch.md');
    expect(paths).toContain('.windsurf/rules/launch-ship.md');
    expect(paths).not.toContain('AGENTS.md');
  });

  it('writes a spliced copilot-instructions block for copilot', () => {
    const artifacts = planArtifacts(['copilot'], '1.0.0');
    expect(artifacts).toEqual([
      { kind: 'spliced', path: '.github/copilot-instructions.md', block: expect.any(String) },
    ]);
  });

  it('writes a single Kiro steering hook for kiro', () => {
    const artifacts = planArtifacts(['kiro'], '1.0.0');
    expect(artifacts).toEqual([
      { kind: 'owned', path: '.kiro/steering/launch.md', body: expect.any(String) },
    ]);
  });

  it('writes Cline base rule + one task rule per skill for cline', () => {
    const paths = planArtifacts(['cline'], '1.0.0').map((a) => a.path);
    expect(paths).toContain('.cline/rules/launch.md');
    expect(paths).toContain('.cline/rules/launch-ship.md');
    expect(paths).not.toContain('AGENTS.md');
  });

  it('writes Amazon Q base rule + one task rule per skill for amazonq', () => {
    const paths = planArtifacts(['amazonq'], '1.0.0').map((a) => a.path);
    expect(paths).toContain('.amazonq/rules/launch.md');
    expect(paths).toContain('.amazonq/rules/launch-ship.md');
    expect(paths).not.toContain('AGENTS.md');
  });
});

describe('write → check round-trip', () => {
  it('reports no drift right after writing, drift after an edit, and clean again after rewriting', () => {
    const artifacts = planArtifacts(['claude', 'cursor'], '1.0.0');
    writeArtifacts(cwd, artifacts);
    expect(findStaleArtifacts(cwd, artifacts)).toEqual([]);

    writeFileSync(join(cwd, '.cursor/rules/launch-ship.mdc'), 'tampered\n');
    expect(findStaleArtifacts(cwd, artifacts)).toContain('.cursor/rules/launch-ship.mdc');

    writeArtifacts(cwd, artifacts);
    expect(findStaleArtifacts(cwd, artifacts)).toEqual([]);
  });

  it('flags drift when the installed version moved past what scaffolded the files', () => {
    writeArtifacts(cwd, planArtifacts(['codex'], '1.0.0'));
    const stale = findStaleArtifacts(cwd, planArtifacts(['codex'], '2.0.0'));
    expect(stale).toContain('AGENTS.md');
  });
});

describe('managed-block splicing into an existing AGENTS.md', () => {
  it("preserves the user's own AGENTS.md content and adds the Launch block", () => {
    writeFileSync(join(cwd, 'AGENTS.md'), "# My app rules\n\nDon't break the build.\n");
    const artifacts = planArtifacts(['codex'], '1.0.0');
    writeArtifacts(cwd, artifacts);

    const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('# My app rules');
    expect(agents).toContain("Don't break the build.");
    expect(agents).toContain('Shipping this app with Launch');
    expect(findStaleArtifacts(cwd, artifacts)).toEqual([]);
  });
});
