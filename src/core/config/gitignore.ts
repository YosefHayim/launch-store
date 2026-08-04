import { FileSystem, Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import { captureCommandOutput, provideNodeCommandServices } from '../services/exec.js';
import { LaunchPaths } from '../services/paths.js';
/** Marker comment that headers Launch's auto-added ignore entry, so it's recognizable and removable by hand. */
const IGNORE_MARKER = '# launch build artifacts';
/** Outcome of an {@link ensureArtifactDirIgnored} attempt. */
export type GitignoreResult = {
  added: boolean;
  entry?: string;
};
/** The git work-tree root containing `dir`, or null when `dir` isn't inside a repo (or git is absent). */
const repoRoot = (dir: string): Effect.Effect<string | null> =>
  provideNodeCommandServices(
    captureCommandOutput('git', ['-C', dir, 'rev-parse', '--show-toplevel']),
  ).pipe(Effect.catchAll(() => Effect.succeed(null)));
/** Whether git already ignores `dir` (by any pattern). `check-ignore -q` exits 0 when ignored, 1 otherwise. */
const alreadyIgnored = (root: string, dir: string): Effect.Effect<boolean> =>
  provideNodeCommandServices(
    captureCommandOutput('git', ['-C', root, 'check-ignore', '-q', '--', dir]),
  ).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
export type GitignoreFailure = Readonly<{
  readonly _tag: 'GitignoreFailure';
  readonly path: string;
  readonly cause: unknown;
}>;
export const makeGitignoreFailure = Data.tagged<GitignoreFailure>('GitignoreFailure');
/**
 * Ensure `resolvedDir` (an absolute artifact directory) is git-ignored when it lives inside the project's
 * repo. `projectDir` is where the repo is located from - defaults to the current directory (which is the
 * project root, since `launch` loads its config from there). Returns whether an entry was added.
 */
export const ensureArtifactDirIgnored = (resolvedDir: string, requestedProjectDirectory?: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    let projectDirectory = requestedProjectDirectory;
    if (projectDirectory === undefined) projectDirectory = (yield* LaunchPaths).workingDirectory;
    const root = yield* repoRoot(projectDirectory);
    if (!root) return { added: false };
    const rel = pathService.relative(root, resolvedDir);
    if (rel === '') return { added: false };
    if (rel.startsWith('..')) return { added: false };
    if (pathService.isAbsolute(rel)) return { added: false };
    if (yield* alreadyIgnored(root, resolvedDir)) return { added: false };
    // Anchored, NO trailing slash: a directory-only (`foo/`) pattern only matches via `check-ignore` once
    // the directory exists on disk, so it would re-append every run before the first build creates the dir.
    // The anchored form matches whether the dir exists yet or not - keeping this idempotent - and still
    // ignores the directory and everything under it (binaries + `objects/`).
    const entry = `/${rel.split(pathService.sep).join('/')}`;
    const gitignorePath = pathService.join(root, '.gitignore');
    let existing = '';
    const gitignoreExists = yield* fileSystem
      .exists(gitignorePath)
      .pipe(Effect.mapError((cause) => makeGitignoreFailure({ path: gitignorePath, cause })));
    if (gitignoreExists) {
      existing = yield* fileSystem
        .readFileString(gitignorePath)
        .pipe(Effect.mapError((cause) => makeGitignoreFailure({ path: gitignorePath, cause })));
    }
    let base = existing;
    if (base.length > 0 && !base.endsWith('\n')) base = `${base}\n`;
    let gap = '\n';
    if (base.length === 0) gap = '';
    else if (base.endsWith('\n\n')) gap = '';
    yield* fileSystem
      .writeFileString(gitignorePath, `${base}${gap}${IGNORE_MARKER}\n${entry}\n`)
      .pipe(Effect.mapError((cause) => makeGitignoreFailure({ path: gitignorePath, cause })));
    return { added: true, entry };
  });
