import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { capture } from './exec.js';
import { ensureArtifactDirIgnored } from './gitignore.js';

/**
 * Exercise the auto-gitignore against a real git repo in a temp dir (git's own `check-ignore` decides
 * "already covered", so a mocked repo wouldn't prove anything). `realpathSync` resolves the macOS
 * `/var → /private/var` symlink up front, since `git rev-parse --show-toplevel` returns the real path.
 */
describe('ensureArtifactDirIgnored', () => {
  let repo: string;
  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'launch-gitignore-')));
    await capture('git', ['-C', repo, 'init']);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('appends an anchored entry under the marker for an in-repo dir, and is idempotent', async () => {
    const artifacts = join(repo, '.launch', 'artifacts');

    const first = await ensureArtifactDirIgnored(artifacts, repo);
    expect(first).toEqual({ added: true, entry: '/.launch/artifacts' });

    const gitignore = readFileSync(join(repo, '.gitignore'), 'utf8');
    expect(gitignore).toContain('# launch build artifacts');
    expect(gitignore).toContain('/.launch/artifacts');

    // Idempotent even though the dir was never created — `check-ignore` matches the anchored entry anyway.
    const second = await ensureArtifactDirIgnored(artifacts, repo);
    expect(second).toEqual({ added: false });
    // Re-run appended nothing — the marker still appears exactly once.
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe(gitignore);
  });

  it('respects a pre-existing broader ignore pattern (no duplicate entry)', async () => {
    writeFileSync(join(repo, '.gitignore'), '.launch/\n');

    const result = await ensureArtifactDirIgnored(join(repo, '.launch', 'artifacts'), repo);
    expect(result).toEqual({ added: false });
  });

  it("no-ops for a dir outside the project's work tree", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'launch-outside-')));
    try {
      expect(await ensureArtifactDirIgnored(outside, repo)).toEqual({ added: false });
      expect(existsSync(join(repo, '.gitignore'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("no-ops when the project dir isn't a git repo", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'launch-plain-')));
    mkdirSync(join(plain, 'out'));
    try {
      expect(await ensureArtifactDirIgnored(join(plain, 'out'), plain)).toEqual({ added: false });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
