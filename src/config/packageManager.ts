import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathExists } from '../path-exists.js';

type PackageManagerName = 'npm' | 'yarn' | 'pnpm' | 'bun';

const LOCKFILES: Record<PackageManagerName, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lockb',
};

type PackageManagerInfo = {
  name: PackageManagerName;
  version?: string;
  source: 'packageManager' | 'lockfile' | 'yarnrc' | 'default';
  corepackPinned: boolean;
};

type WorkspaceInfo = {
  root: string;
  kind: 'npm/yarn' | 'pnpm';
};

type PackageSetup = {
  pm: PackageManagerInfo;
  workspace: WorkspaceInfo | null;
  lockfile: string | null;
};

const PACKAGE_MANAGER_FIELD = /^(npm|yarn|pnpm|bun)@?([0-9][^+\s]*)?/;

function isPackageManagerName(name: string | undefined): name is PackageManagerName {
  if (name == 'npm') {
    return true;
  }

  if (name == 'yarn') {
    return true;
  }

  if (name == 'pnpm') {
    return true;
  }

  return name == 'bun';
}

export function parsePackageManagerField(field: unknown): {
  name: PackageManagerName;
  version?: string;
} | null {
  if (typeof field != 'string') {
    return null;
  }

  const match = PACKAGE_MANAGER_FIELD.exec(field.trim());

  if (match == null) {
    return null;
  }

  const managerName = match[1];

  if (isPackageManagerName(managerName) == false) {
    return null;
  }

  const packageManagerField: { name: PackageManagerName; version?: string } = {
    name: managerName,
  };
  const version = match[2];

  if (version != null) {
    const versionIsPresent = version.length > 0;

    if (versionIsPresent) {
      packageManagerField.version = version;
    }
  }

  return packageManagerField;
}

export function detectFromLockfiles(present: ReadonlySet<string>): PackageManagerName | null {
  if (present.has('pnpm-lock.yaml')) {
    return 'pnpm';
  }

  if (present.has('yarn.lock')) {
    return 'yarn';
  }

  if (present.has('bun.lockb')) {
    return 'bun';
  }

  if (present.has('bun.lock')) {
    return 'bun';
  }

  if (present.has('package-lock.json')) {
    return 'npm';
  }

  return null;
}

type PackageManagerWarningInput = {
  info: PackageManagerInfo;
  lockfile: string | null;
  corepackAvailable: boolean;
};

function needsCorepackWarning(input: PackageManagerWarningInput): boolean {
  const isPinned = input.info.corepackPinned;

  if (isPinned == false) {
    return false;
  }

  const isNpm = input.info.name == 'npm';

  if (isNpm) {
    return false;
  }

  return input.corepackAvailable == false;
}

function bunLockfileMatches(managerName: PackageManagerName, lockfile: string): boolean {
  const isBun = managerName == 'bun';

  if (isBun == false) {
    return false;
  }

  if (lockfile == 'bun.lockb') {
    return true;
  }

  return lockfile == 'bun.lock';
}

export function packageManagerWarnings(input: PackageManagerWarningInput): string[] {
  const packageManagerInfo = input.info;
  const warnings: string[] = [];
  const corepackIsMissing = needsCorepackWarning(input);

  if (corepackIsMissing) {
    let pin: string = packageManagerInfo.name;

    if (packageManagerInfo.version != null) {
      pin = `${packageManagerInfo.name}@${packageManagerInfo.version}`;
    }

    warnings.push(
      `package.json pins ${pin} via "packageManager", but Corepack isn't enabled - run \`corepack enable\` ` +
        `so installs use ${packageManagerInfo.name} instead of silently falling back to npm.`,
    );
  }

  const lockfile = input.lockfile;
  const declaredByField = packageManagerInfo.source == 'packageManager';

  if (lockfile != null) {
    if (declaredByField) {
      const expected = LOCKFILES[packageManagerInfo.name];
      const lockfileAgrees = lockfile == expected;
      const bunAgrees = bunLockfileMatches(packageManagerInfo.name, lockfile);
      const lockfilesMatch = lockfileAgrees;

      if (lockfilesMatch == false) {
        if (bunAgrees == false) {
          warnings.push(
            `"packageManager" declares ${packageManagerInfo.name} but the lockfile is ${lockfile} - they disagree. ` +
              `Commit the matching ${expected}, or correct the "packageManager" field.`,
          );
        }
      }
    }
  }

  return warnings;
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

async function readPackageJson(directory: string): Promise<Record<string, unknown> | null> {
  const packageJsonPath = join(directory, 'package.json');
  const packageExists = await pathExists(packageJsonPath);

  if (packageExists == false) {
    return null;
  }

  try {
    const packageText = await readFile(packageJsonPath, 'utf8');
    const parsedPackage: unknown = JSON.parse(packageText);

    if (isPlainRecord(parsedPackage)) {
      return parsedPackage;
    }

    return null;
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

const LOCKFILE_NAMES = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'package-lock.json',
] as const;

async function lockfileIn(directory: string): Promise<string | null> {
  for (const name of LOCKFILE_NAMES) {
    const lockfilePath = join(directory, name);
    const lockfileExists = await pathExists(lockfilePath);

    if (lockfileExists) {
      return name;
    }
  }

  return null;
}

export async function findWorkspaceRoot(appDirectory: string): Promise<WorkspaceInfo | null> {
  let directory = appDirectory;

  for (;;) {
    const pnpmWorkspacePath = join(directory, 'pnpm-workspace.yaml');
    const pnpmWorkspaceExists = await pathExists(pnpmWorkspacePath);

    if (pnpmWorkspaceExists) {
      return { root: directory, kind: 'pnpm' };
    }

    const packageJson = await readPackageJson(directory);

    if (packageJson != null) {
      if ('workspaces' in packageJson) {
        return { root: directory, kind: 'npm/yarn' };
      }
    }

    const parentDirectory = dirname(directory);
    const isFilesystemRoot = parentDirectory == directory;

    if (isFilesystemRoot) {
      return null;
    }

    directory = parentDirectory;
  }
}

export async function detectPackageManager(directory: string): Promise<PackageManagerInfo> {
  const packageJson = await readPackageJson(directory);
  let packageManagerField: unknown;

  if (packageJson != null) {
    packageManagerField = packageJson['packageManager'];
  }

  const pinned = parsePackageManagerField(packageManagerField);

  if (pinned != null) {
    const packageManagerInfo: PackageManagerInfo = {
      name: pinned.name,
      source: 'packageManager',
      corepackPinned: true,
    };

    if (pinned.version != null) {
      packageManagerInfo.version = pinned.version;
    }

    return packageManagerInfo;
  }

  const lockfile = await lockfileIn(directory);
  let fromLock: PackageManagerName | null = null;

  if (lockfile != null) {
    fromLock = detectFromLockfiles(new Set([lockfile]));
  }

  if (fromLock != null) {
    return {
      name: fromLock,
      source: 'lockfile',
      corepackPinned: false,
    };
  }

  const yarnrcPath = join(directory, '.yarnrc.yml');
  const yarnrcExists = await pathExists(yarnrcPath);

  if (yarnrcExists) {
    return {
      name: 'yarn',
      source: 'yarnrc',
      corepackPinned: false,
    };
  }

  return {
    name: 'npm',
    source: 'default',
    corepackPinned: false,
  };
}

export async function inspectPackageSetup(appDirectory: string): Promise<PackageSetup> {
  const workspace = await findWorkspaceRoot(appDirectory);
  let installRoot = appDirectory;

  if (workspace != null) {
    installRoot = workspace.root;
  }

  const packageManagerInfo = await detectPackageManager(installRoot);
  const lockfile = await lockfileIn(installRoot);

  return {
    pm: packageManagerInfo,
    workspace,
    lockfile,
  };
}
