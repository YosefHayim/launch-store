// Adds a git ignore rule so Launch build artifacts are not committed.

import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { captureCommandOutput } from '../services/platform/execute-command.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';

type GitignoreChange = { added: false } | { added: true; entry: string };

type GitignoreFailure = Readonly<{
  _tag: 'GitignoreFailure';
  path: string;
  cause: unknown;
}>;

function makeGitignoreFailure(path: string, cause: unknown): GitignoreFailure {
  return { _tag: 'GitignoreFailure', path, cause };
}

// A git hook exports GIT_DIR, and then `git -C <dir>` treats <dir> as that repo. Drop it so discovery follows the directory.
async function runGit(directory: string, gitArguments: readonly string[]): Promise<string> {
  return captureCommandOutput('env', [
    '-u',
    'GIT_DIR',
    '-u',
    'GIT_WORK_TREE',
    'git',
    '-C',
    directory,
    ...gitArguments,
  ]);
}

/** The git work-tree root containing `dir`, or null when `dir` isn't inside a repo (or git is absent). */
async function repoRoot(directory: string): Promise<string | null> {
  try {
    return await runGit(directory, ['rev-parse', '--show-toplevel']);
  } catch (error) {
    const gitIsUnavailable = error != null;

    if (gitIsUnavailable) {
      return null;
    }

    return null;
  }
}

/** Whether git already ignores `dir` (by any pattern). `check-ignore -q` exits 0 when ignored, 1 otherwise. */
async function alreadyIgnored(root: string, directory: string): Promise<boolean> {
  try {
    await runGit(root, ['check-ignore', '-q', '--', directory]);

    return true;
  } catch (error) {
    const isNotIgnored = error != null;

    if (isNotIgnored) {
      return false;
    }

    return false;
  }
}

function ignoreGap(existingText: string): string {
  const isEmpty = existingText.length == 0;

  if (isEmpty) {
    return '';
  }

  const alreadyHasBlankLine = existingText.endsWith('\n\n');

  if (alreadyHasBlankLine) {
    return '';
  }

  return '\n';
}

/** Ensure `artifactDirectory` (an absolute artifact directory) is git-ignored when it lives inside */
export async function ensureArtifactDirIgnored(
  artifactDirectory: string,
  requestedProjectDirectory?: string,
): Promise<GitignoreChange> {
  let projectDirectory = readLaunchDirectories().workingDirectory;

  if (requestedProjectDirectory != null) {
    projectDirectory = requestedProjectDirectory;
  }

  const root = await repoRoot(projectDirectory);

  const hasNoRepo = root == null;

  if (hasNoRepo) {
    return { added: false };
  }

  const relativePath = relative(root, artifactDirectory);

  const isRepoRoot = relativePath == '';

  if (isRepoRoot) {
    return { added: false };
  }

  const leavesTheRepo = relativePath.startsWith('..');

  if (leavesTheRepo) {
    return { added: false };
  }

  const isOutsidePath = isAbsolute(relativePath);

  if (isOutsidePath) {
    return { added: false };
  }

  const isIgnored = await alreadyIgnored(root, artifactDirectory);

  if (isIgnored) {
    return { added: false };
  }

  // Anchored, NO trailing slash: a directory-only (`foo/`) pattern only matches via `check-ignore` once
  // the directory exists on disk, so it would re-append every run before the first build creates the dir.
  const entry = `/${relativePath.split(sep).join('/')}`;
  const gitignorePath = join(root, '.gitignore');
  let existing = '';

  try {
    const gitignoreExists = await pathExists(gitignorePath);

    if (gitignoreExists) {
      existing = await readFile(gitignorePath, 'utf8');
    }
  } catch (cause) {
    throw makeGitignoreFailure(gitignorePath, cause);
  }

  let base = existing;

  const needsTrailingNewline = base.length > 0;

  if (needsTrailingNewline) {
    const endsWithNewline = base.endsWith('\n');

    if (endsWithNewline == false) {
      base = `${base}\n`;
    }
  }

  const gap = ignoreGap(base);

  try {
    await writeFile(gitignorePath, `${base}${gap}# launch-store build artifacts\n${entry}\n`);
  } catch (cause) {
    throw makeGitignoreFailure(gitignorePath, cause);
  }

  return { added: true, entry };
}
