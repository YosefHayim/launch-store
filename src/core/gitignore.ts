/**
 * Keep build artifacts out of version control.
 *
 * When the `local` storage provider's resolved artifact directory lives INSIDE the project's git work
 * tree and isn't already ignored, this appends it to the repo-root `.gitignore` under a marker comment.
 * It's what makes the in-repo `artifactDir` default (`./.launch/artifacts`) safe — the "it won't get
 * committed" promise — and runs both at `launch init` and at the top of every `launch build`, so the
 * guard holds even if init was skipped or the entry was removed.
 *
 * Correctness/safety:
 *  - the repo is located from the PROJECT directory (cwd), not the artifact dir, so the global
 *    `~/.launch/artifacts` default can't accidentally resolve into a user's home-dotfiles repo;
 *  - git's own `check-ignore` decides "already covered", so an existing broader pattern is respected and
 *    re-runs are idempotent (it appends at most once);
 *  - it no-ops outside a repo and for any dir that isn't under the project's work tree.
 *
 * All git calls go through {@link import("./exec.js")} (`shell: false`), never a shell string.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { capture } from './exec.js';

/** Marker comment that headers Launch's auto-added ignore entry, so it's recognizable and removable by hand. */
const IGNORE_MARKER = '# launch build artifacts';

/** Outcome of an {@link ensureArtifactDirIgnored} attempt. */
export interface GitignoreResult {
  /** Whether a new entry was appended to `.gitignore` on this call. */
  added: boolean;
  /** The entry written (anchored, repo-root-relative, e.g. `/.launch/artifacts`) — present only when `added`. */
  entry?: string;
}

/** The git work-tree root containing `dir`, or null when `dir` isn't inside a repo (or git is absent). */
async function repoRoot(dir: string): Promise<string | null> {
  try {
    return await capture('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  } catch {
    return null;
  }
}

/** Whether git already ignores `dir` (by any pattern). `check-ignore -q` exits 0 when ignored, 1 otherwise. */
async function alreadyIgnored(root: string, dir: string): Promise<boolean> {
  try {
    await capture('git', ['-C', root, 'check-ignore', '-q', '--', dir]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure `resolvedDir` (an absolute artifact directory) is git-ignored when it lives inside the project's
 * repo. `projectDir` is where the repo is located from — defaults to the current directory (which is the
 * project root, since `launch` loads its config from there). Returns whether an entry was added.
 */
export async function ensureArtifactDirIgnored(
  resolvedDir: string,
  projectDir: string = process.cwd(),
): Promise<GitignoreResult> {
  const root = await repoRoot(projectDir);
  if (!root) return { added: false };

  const rel = relative(root, resolvedDir);
  // Empty → the dir IS the repo root; `..`/absolute → outside the work tree. Never ignore either.
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { added: false };

  if (await alreadyIgnored(root, resolvedDir)) return { added: false };

  // Anchored, NO trailing slash: a directory-only (`foo/`) pattern only matches via `check-ignore` once
  // the directory exists on disk, so it would re-append every run before the first build creates the dir.
  // The anchored form matches whether the dir exists yet or not — keeping this idempotent — and still
  // ignores the directory and everything under it (binaries + `objects/`).
  const entry = `/${rel.split(sep).join('/')}`;
  const gitignorePath = join(root, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const base = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
  const gap = base.length === 0 || base.endsWith('\n\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${base}${gap}${IGNORE_MARKER}\n${entry}\n`);
  return { added: true, entry };
}
