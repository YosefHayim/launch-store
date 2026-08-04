import { FileSystem, Path } from '@effect/platform';
import type * as PlatformError from '@effect/platform/Error';
import { Effect, Option, Schema } from 'effect';
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
 * The resolved package manager for a project and HOW Launch concluded it - the basis for both the
 * doctor readout and the footgun checks. `version`/`corepackPinned` come only from a `packageManager`
 * field; `source` records which signal won so the reasoning is legible.
 */
export type PackageManagerInfo = {
  name: PackageManagerName;
  version?: string;
  source: 'packageManager' | 'lockfile' | 'yarnrc' | 'default';
  corepackPinned: boolean;
};
/** A discovered monorepo workspace root and how it was declared. */
export type WorkspaceInfo = {
  root: string;
  kind: 'npm/yarn' | 'pnpm';
};
/** The full package-setup picture for one app dir, assembled by {@link inspectPackageSetup}. */
export type PackageSetup = {
  pm: PackageManagerInfo;
  workspace: WorkspaceInfo | null;
  lockfile: string | null;
};
/**
 * Parse a `packageManager` field (`"yarn@4.1.0"`, `"pnpm@9.1.0+sha512...."`) into a manager + version.
 * Pure. Returns null for an absent/unrecognized value, so the caller falls through to lockfile detection.
 */
export const parsePackageManagerField = (
  field: unknown,
): {
  name: PackageManagerName;
  version?: string;
} | null => {
  if (typeof field !== 'string') return null;
  const match = /^(npm|yarn|pnpm|bun)@?([0-9][^+\s]*)?/.exec(field.trim());
  if (!match) return null;
  const managerName = match[1];
  if (
    managerName !== 'npm' &&
    managerName !== 'yarn' &&
    managerName !== 'pnpm' &&
    managerName !== 'bun'
  )
    return null;
  const packageManagerField: { name: PackageManagerName; version?: string } = {
    name: managerName,
  };
  if (match[2]) packageManagerField.version = match[2];
  return packageManagerField;
};
/**
 * Decide the manager from the lockfiles present, in priority order (a pnpm/yarn lockfile is a stronger
 * signal than `package-lock.json`, which some tools write incidentally). Pure over the set of filenames.
 */
export const detectFromLockfiles = (present: ReadonlySet<string>): PackageManagerName | null => {
  if (present.has('pnpm-lock.yaml')) return 'pnpm';
  if (present.has('yarn.lock')) return 'yarn';
  if (present.has('bun.lockb')) return 'bun';
  if (present.has('bun.lock')) return 'bun';
  if (present.has('package-lock.json')) return 'npm';
  return null;
};
/** Inputs for {@link packageManagerWarnings} - all the facts a footgun check needs, no I/O. */
export type PackageManagerWarningInput = {
  info: PackageManagerInfo;
  lockfile: string | null;
  corepackAvailable: boolean;
};
/**
 * The known package-manager footguns, as plain-English warnings with the fix. Pure. Empty when the
 * setup is consistent. Covers the two recurring EAS failures: a Corepack-pinned PM with Corepack
 * disabled (the build silently falls back to npm), and a declared PM that disagrees with the lockfile.
 */
export const packageManagerWarnings = (input: PackageManagerWarningInput): string[] => {
  const { info: packageManagerInfo, lockfile, corepackAvailable } = input;
  const warnings: string[] = [];
  if (
    packageManagerInfo.corepackPinned &&
    packageManagerInfo.name !== 'npm' &&
    !corepackAvailable
  ) {
    let pin: string = packageManagerInfo.name;
    if (packageManagerInfo.version) {
      pin = `${packageManagerInfo.name}@${packageManagerInfo.version}`;
    }
    warnings.push(
      `package.json pins ${pin} via "packageManager", but Corepack isn't enabled - run \`corepack enable\` ` +
        `so installs use ${packageManagerInfo.name} instead of silently falling back to npm.`,
    );
  }
  if (lockfile && packageManagerInfo.source === 'packageManager') {
    const expected = LOCKFILES[packageManagerInfo.name];
    let bunLockfileMatches = false;
    if (packageManagerInfo.name === 'bun') {
      bunLockfileMatches = lockfile === 'bun.lockb';
      if (!bunLockfileMatches) bunLockfileMatches = lockfile === 'bun.lock';
    }
    if (lockfile !== expected && !bunLockfileMatches) {
      warnings.push(
        `"packageManager" declares ${packageManagerInfo.name} but the lockfile is ${lockfile} - they disagree. ` +
          `Commit the matching ${expected}, or correct the "packageManager" field.`,
      );
    }
  }
  return warnings;
};
/** Read and JSON-parse a directory's package.json, or null when absent/malformed. */
const readPackageJson = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const packageJsonPath = pathService.join(directory, 'package.json');
    if (!(yield* fileSystem.exists(packageJsonPath))) return null;
    const parsedPackage = yield* fileSystem.readFileString(packageJsonPath).pipe(
      Effect.flatMap((packageText) => Effect.try(() => JSON.parse(packageText))),
      Effect.orElseSucceed(() => null),
    );
    const packageObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
    return Option.getOrNull(Schema.decodeUnknownOption(packageObjectSchema)(parsedPackage));
  });
/** The lockfile present in a directory, if any (first match in detection-priority order). */
const lockfileIn = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    for (const name of [
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lockb',
      'bun.lock',
      'package-lock.json',
    ]) {
      if (yield* fileSystem.exists(pathService.join(directory, name))) return name;
    }
    return null;
  });
/**
 * Walk up from `appDir` to the monorepo root: the nearest ancestor whose package.json declares
 * `workspaces`, or that holds a `pnpm-workspace.yaml`. Null when the app isn't inside a workspace.
 * Stops at the filesystem root.
 */
export const findWorkspaceRoot = (appDirectory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    let directory = appDirectory;
    for (;;) {
      if (yield* fileSystem.exists(pathService.join(directory, 'pnpm-workspace.yaml'))) {
        return { root: directory, kind: 'pnpm' } as const;
      }
      const packageJson = yield* readPackageJson(directory);
      if (packageJson !== null && 'workspaces' in packageJson) {
        return { root: directory, kind: 'npm/yarn' } as const;
      }
      const parentDirectory = pathService.dirname(directory);
      if (parentDirectory === directory) return null;
      directory = parentDirectory;
    }
  });
/**
 * Resolve the package manager from a single directory's signals (no workspace walk): the
 * `packageManager` field wins, then the lockfile, then `.yarnrc.yml` (Yarn Berry), then npm by default.
 */
export const detectPackageManager = (
  directory: string,
): Effect.Effect<
  PackageManagerInfo,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const packageJson = yield* readPackageJson(directory);
    const pinned = parsePackageManagerField(packageJson?.['packageManager']);
    if (pinned) {
      const packageManagerInfo: PackageManagerInfo = {
        name: pinned.name,
        source: 'packageManager',
        corepackPinned: true,
      };
      if (pinned.version) packageManagerInfo.version = pinned.version;
      return packageManagerInfo;
    }
    const lockfile = yield* lockfileIn(directory);
    let fromLock: PackageManagerName | null = null;
    if (lockfile) fromLock = detectFromLockfiles(new Set([lockfile]));
    if (fromLock)
      return {
        name: fromLock,
        source: 'lockfile',
        corepackPinned: false,
      } satisfies PackageManagerInfo;
    if (yield* fileSystem.exists(pathService.join(directory, '.yarnrc.yml')))
      return {
        name: 'yarn',
        source: 'yarnrc',
        corepackPinned: false,
      } satisfies PackageManagerInfo;
    return {
      name: 'npm',
      source: 'default',
      corepackPinned: false,
    } satisfies PackageManagerInfo;
  });
/**
 * The full package-setup picture for an app: its workspace root (if any) and the package manager +
 * lockfile resolved at the INSTALL root - the workspace root when inside a monorepo (where the lockfile
 * and `packageManager` field live), else the app dir itself.
 */
export const inspectPackageSetup = (appDirectory: string) =>
  Effect.gen(function* () {
    const workspace = yield* findWorkspaceRoot(appDirectory);
    let installRoot = appDirectory;
    if (workspace !== null) installRoot = workspace.root;
    return {
      pm: yield* detectPackageManager(installRoot),
      workspace,
      lockfile: yield* lockfileIn(installRoot),
    } satisfies PackageSetup;
  });
