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
import { captureCommandOutput } from '../services/platform/exec.ts';
import { ensureArtifactDirIgnored } from './gitignore.ts';
/**
 * Exercise the auto-gitignore against a real git repo in a temp dir (git's own `check-ignore` decides
 * "already covered", so a mocked repo wouldn't prove anything). `realpathSync` resolves the macOS
 * `/var -> /private/var` symlink up front, since `git rev-parse --show-toplevel` returns the real path.
 */
describe('ensureArtifactDirIgnored', () => {
  let repo: string;
  beforeEach(async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchGitignorePath = join(systemTemporaryDirectory, 'launch-gitignore-');
    const createdDirectory = mkdtempSync(launchGitignorePath);
    repo = realpathSync(createdDirectory);
    await captureCommandOutput('env', [
      '-u',
      'GIT_DIR',
      '-u',
      'GIT_WORK_TREE',
      'git',
      '-C',
      repo,
      'init',
    ]);
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  it('appends an anchored entry under the marker for an in-repo dir, and is idempotent', async () => {
    const artifacts = join(repo, '.launch', 'artifacts');
    const first = await ensureArtifactDirIgnored(artifacts, repo);
    expect(first).toEqual({ added: true, entry: '/.launch/artifacts' });
    const joinedPath = join(repo, '.gitignore');
    const gitignore = readFileSync(joinedPath, 'utf8');
    expect(gitignore).toContain('# launch build artifacts');
    expect(gitignore).toContain('/.launch/artifacts');
    // Idempotent even though the dir was never created - `check-ignore` matches the anchored entry anyway.
    const second = await ensureArtifactDirIgnored(artifacts, repo);
    expect(second).toEqual({ added: false });
    // Re-run appended nothing - the marker still appears exactly once.
    const loadedFile = readFileSync(join(repo, '.gitignore'), 'utf8');
    expect(loadedFile).toBe(gitignore);
  });
  it('respects a pre-existing broader ignore pattern (no duplicate entry)', async () => {
    const joinedPath = join(repo, '.gitignore');
    writeFileSync(joinedPath, '.launch/\n');
    const artifactsPath = join(repo, '.launch', 'artifacts');
    const ignoreOutcome = await ensureArtifactDirIgnored(artifactsPath, repo);
    expect(ignoreOutcome).toEqual({ added: false });
  });
  it("no-ops for a dir outside the project's work tree", async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchOutsidePath = join(systemTemporaryDirectory, 'launch-outside-');
    const createdDirectory = mkdtempSync(launchOutsidePath);
    const outside = realpathSync(createdDirectory);
    try {
      const artifactDirIgnored = await ensureArtifactDirIgnored(outside, repo);
      expect(artifactDirIgnored).toEqual({
        added: false,
      });
      const joinedPath = join(repo, '.gitignore');
      const pathExists = existsSync(joinedPath);
      expect(pathExists).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("no-ops when the project dir isn't a git repo", async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchPlainPath = join(systemTemporaryDirectory, 'launch-plain-');
    const createdDirectory = mkdtempSync(launchPlainPath);
    const plain = realpathSync(createdDirectory);
    const outPath = join(plain, 'out');
    mkdirSync(outPath);
    try {
      const outPath = join(plain, 'out');
      const artifactDirIgnored = await ensureArtifactDirIgnored(outPath, plain);
      expect(artifactDirIgnored).toEqual({ added: false });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
