/**
 * Package-manager & monorepo detection — Launch's structural answer to a whole cluster of EAS build
 * failures ("uses Yarn v1 despite Corepack", "tries to install pnpm again", "doesn't recognize local
 * packages in a yarn workspace").
 *
 * EAS guesses the project's package manager and workspace layout on a remote installer and gets it
 * wrong. Launch builds on the user's own machine with their already-installed toolchain, so it can
 * read the repo's REAL package manager instead of guessing. This module makes that explicit and
 * verifiable: it resolves the PM from the `packageManager` field (Corepack), the lockfile, then
 * `.yarnrc.yml`; finds the monorepo workspace root; and flags the known footguns (Corepack not enabled,
 * a declared PM that disagrees with the lockfile) — surfaced by `launch doctor` before a wasted build.
 *
 * The parsing/decision functions are pure so they're unit-testable; the thin `inspectPackageSetup`
 * composes them over the filesystem.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The package managers Launch recognizes. */
export type PackageManagerName = 'npm' | 'yarn' | 'pnpm' | 'bun';

/** The canonical lockfile each manager writes (bun also accepts the newer text `bun.lock`). */
const LOCKFILES: Record<PackageManagerName, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lockb',
};

/**
 * The resolved package manager for a project and HOW Launch concluded it — the basis for both the
 * doctor readout and the footgun checks. `version`/`corepackPinned` come only from a `packageManager`
 * field; `source` records which signal won so the reasoning is legible.
 */
export interface PackageManagerInfo {
  name: PackageManagerName;
  /** Version pinned via the `packageManager` field (Corepack), when declared. */
  version?: string;
  /** Which signal decided the manager. */
  source: 'packageManager' | 'lockfile' | 'yarnrc' | 'default';
  /** Whether a Corepack `packageManager` pin was present (so Corepack must be enabled to honor it). */
  corepackPinned: boolean;
}

/** A discovered monorepo workspace root and how it was declared. */
export interface WorkspaceInfo {
  /** Absolute path to the root (the package.json with `workspaces`, or the dir with `pnpm-workspace.yaml`). */
  root: string;
  /** How the workspace was declared. */
  kind: 'npm/yarn' | 'pnpm';
}

/** The full package-setup picture for one app dir, assembled by {@link inspectPackageSetup}. */
export interface PackageSetup {
  pm: PackageManagerInfo;
  workspace: WorkspaceInfo | null;
  /** The lockfile present at the install root, if any (drives the mismatch check + display). */
  lockfile: string | null;
}

/**
 * Parse a `packageManager` field (`"yarn@4.1.0"`, `"pnpm@9.1.0+sha512.…"`) into a manager + version.
 * Pure. Returns null for an absent/unrecognized value, so the caller falls through to lockfile detection.
 */
export function parsePackageManagerField(
  field: unknown,
): { name: PackageManagerName; version?: string } | null {
  if (typeof field !== 'string') return null;
  const match = /^(npm|yarn|pnpm|bun)@?([0-9][^+\s]*)?/.exec(field.trim());
  if (!match) return null;
  const name = match[1] as PackageManagerName;
  return match[2] ? { name, version: match[2] } : { name };
}

/**
 * Decide the manager from the lockfiles present, in priority order (a pnpm/yarn lockfile is a stronger
 * signal than `package-lock.json`, which some tools write incidentally). Pure over the set of filenames.
 */
export function detectFromLockfiles(present: ReadonlySet<string>): PackageManagerName | null {
  if (present.has('pnpm-lock.yaml')) return 'pnpm';
  if (present.has('yarn.lock')) return 'yarn';
  if (present.has('bun.lockb') || present.has('bun.lock')) return 'bun';
  if (present.has('package-lock.json')) return 'npm';
  return null;
}

/** Inputs for {@link packageManagerWarnings} — all the facts a footgun check needs, no I/O. */
export interface PackageManagerWarningInput {
  info: PackageManagerInfo;
  /** Lockfile present at the install root, if any. */
  lockfile: string | null;
  /** Whether the `corepack` shim is on PATH. */
  corepackAvailable: boolean;
}

/**
 * The known package-manager footguns, as plain-English warnings with the fix. Pure. Empty when the
 * setup is consistent. Covers the two recurring EAS failures: a Corepack-pinned PM with Corepack
 * disabled (the build silently falls back to npm), and a declared PM that disagrees with the lockfile.
 */
export function packageManagerWarnings(input: PackageManagerWarningInput): string[] {
  const { info, lockfile, corepackAvailable } = input;
  const warnings: string[] = [];

  if (info.corepackPinned && info.name !== 'npm' && !corepackAvailable) {
    const pin = info.version ? `${info.name}@${info.version}` : info.name;
    warnings.push(
      `package.json pins ${pin} via "packageManager", but Corepack isn't enabled — run \`corepack enable\` ` +
        `so installs use ${info.name} instead of silently falling back to npm.`,
    );
  }

  if (lockfile && info.source === 'packageManager') {
    const expected = LOCKFILES[info.name];
    const bunOk = info.name === 'bun' && (lockfile === 'bun.lockb' || lockfile === 'bun.lock');
    if (lockfile !== expected && !bunOk) {
      warnings.push(
        `"packageManager" declares ${info.name} but the lockfile is ${lockfile} — they disagree. ` +
          `Commit the matching ${expected}, or correct the "packageManager" field.`,
      );
    }
  }

  return warnings;
}

/** Read and JSON-parse a directory's package.json, or null when absent/malformed. */
function readPackageJson(dir: string): Record<string, unknown> | null {
  const path = join(dir, 'package.json');
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The lockfile present in a directory, if any (first match in detection-priority order). */
function lockfileIn(dir: string): string | null {
  for (const name of [
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lockb',
    'bun.lock',
    'package-lock.json',
  ]) {
    if (existsSync(join(dir, name))) return name;
  }
  return null;
}

/**
 * Walk up from `appDir` to the monorepo root: the nearest ancestor whose package.json declares
 * `workspaces`, or that holds a `pnpm-workspace.yaml`. Null when the app isn't inside a workspace.
 * Stops at the filesystem root.
 */
export function findWorkspaceRoot(appDir: string): WorkspaceInfo | null {
  let dir = appDir;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return { root: dir, kind: 'pnpm' };
    const pkg = readPackageJson(dir);
    if (pkg && 'workspaces' in pkg) return { root: dir, kind: 'npm/yarn' };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the package manager from a single directory's signals (no workspace walk): the
 * `packageManager` field wins, then the lockfile, then `.yarnrc.yml` (Yarn Berry), then npm by default.
 */
export function detectPackageManager(dir: string): PackageManagerInfo {
  const pinned = parsePackageManagerField(readPackageJson(dir)?.['packageManager']);
  if (pinned) {
    return {
      name: pinned.name,
      ...(pinned.version ? { version: pinned.version } : {}),
      source: 'packageManager',
      corepackPinned: true,
    };
  }
  const lockfile = lockfileIn(dir);
  const fromLock = lockfile ? detectFromLockfiles(new Set([lockfile])) : null;
  if (fromLock) return { name: fromLock, source: 'lockfile', corepackPinned: false };
  if (existsSync(join(dir, '.yarnrc.yml')))
    return { name: 'yarn', source: 'yarnrc', corepackPinned: false };
  return { name: 'npm', source: 'default', corepackPinned: false };
}

/**
 * The full package-setup picture for an app: its workspace root (if any) and the package manager +
 * lockfile resolved at the INSTALL root — the workspace root when inside a monorepo (where the lockfile
 * and `packageManager` field live), else the app dir itself.
 */
export function inspectPackageSetup(appDir: string): PackageSetup {
  const workspace = findWorkspaceRoot(appDir);
  const installRoot = workspace?.root ?? appDir;
  return { pm: detectPackageManager(installRoot), workspace, lockfile: lockfileIn(installRoot) };
}
