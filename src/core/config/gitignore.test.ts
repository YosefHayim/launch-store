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
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureCommandOutput, provideNodeCommandServices } from '../services/exec.js';
import { makeLaunchPathsTest, type LaunchPathsService } from '../services/paths.js';
import { ensureArtifactDirIgnored } from './gitignore.js';
const runGitignoreEffect = <Success, Failure>(
  gitignoreEffect: Effect.Effect<Success, Failure, NodeContext.NodeContext | LaunchPathsService>,
  projectDirectory: string,
): Promise<Success> =>
  Effect.runPromise(
    gitignoreEffect.pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest(projectDirectory, projectDirectory)),
    ),
  );
/**
 * Exercise the auto-gitignore against a real git repo in a temp dir (git's own `check-ignore` decides
 * "already covered", so a mocked repo wouldn't prove anything). `realpathSync` resolves the macOS
 * `/var -> /private/var` symlink up front, since `git rev-parse --show-toplevel` returns the real path.
 */
describe('ensureArtifactDirIgnored', () => {
  let repo: string;
  beforeEach(async () => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'launch-gitignore-')));
    await Effect.runPromise(
      provideNodeCommandServices(captureCommandOutput('git', ['-C', repo, 'init'])),
    );
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });
  it('appends an anchored entry under the marker for an in-repo dir, and is idempotent', async () => {
    const artifacts = join(repo, '.launch', 'artifacts');
    const first = await runGitignoreEffect(ensureArtifactDirIgnored(artifacts, repo), repo);
    expect(first).toEqual({ added: true, entry: '/.launch/artifacts' });
    const gitignore = readFileSync(join(repo, '.gitignore'), 'utf8');
    expect(gitignore).toContain('# launch build artifacts');
    expect(gitignore).toContain('/.launch/artifacts');
    // Idempotent even though the dir was never created - `check-ignore` matches the anchored entry anyway.
    const second = await runGitignoreEffect(ensureArtifactDirIgnored(artifacts, repo), repo);
    expect(second).toEqual({ added: false });
    // Re-run appended nothing - the marker still appears exactly once.
    expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe(gitignore);
  });
  it('respects a pre-existing broader ignore pattern (no duplicate entry)', async () => {
    writeFileSync(join(repo, '.gitignore'), '.launch/\n');
    const ignoreOutcome = await runGitignoreEffect(
      ensureArtifactDirIgnored(join(repo, '.launch', 'artifacts'), repo),
      repo,
    );
    expect(ignoreOutcome).toEqual({ added: false });
  });
  it("no-ops for a dir outside the project's work tree", async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'launch-outside-')));
    try {
      expect(await runGitignoreEffect(ensureArtifactDirIgnored(outside, repo), repo)).toEqual({
        added: false,
      });
      expect(existsSync(join(repo, '.gitignore'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
  it("no-ops when the project dir isn't a git repo", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'launch-plain-')));
    mkdirSync(join(plain, 'out'));
    try {
      expect(
        await runGitignoreEffect(ensureArtifactDirIgnored(join(plain, 'out'), plain), plain),
      ).toEqual({ added: false });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
