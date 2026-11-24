import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectFromLockfiles,
  detectPackageManager,
  findWorkspaceRoot,
  inspectPackageSetup,
  packageManagerWarnings,
  parsePackageManagerField,
} from './package-manager.ts';
import { expectDefined } from '../testkit/expect-defined.ts';
const tmpDirs: string[] = [];

async function runPackageManagerEffect<Success>(packageWork: Promise<Success>): Promise<Success> {
  return packageWork;
}

function scratch(): string {
  const systemTemporaryDirectory = tmpdir();
  const launchPmPath = join(systemTemporaryDirectory, 'launch-pm-');
  const dir = mkdtempSync(launchPmPath);

  tmpDirs.push(dir);

  return dir;
}

function cleanup() {
  while (tmpDirs.length) {
    rmSync(expectDefined(tmpDirs.pop(), 'temp dir'), { recursive: true, force: true });
  }
}

afterEach(cleanup);

function describeParsePackageManagerField() {
  function splitsACorepackPinIntoManagerVersion() {
    const packageManagerField = parsePackageManagerField('yarn@4.1.0');

    expect(packageManagerField).toEqual({ name: 'yarn', version: '4.1.0' });
    expect(parsePackageManagerField('pnpm@9.1.0+sha512.abc')).toEqual({
      name: 'pnpm',
      version: '9.1.0',
    });
    expect(parsePackageManagerField('npm')).toEqual({ name: 'npm' });
  }

  it('splits a Corepack pin into manager + version', splitsACorepackPinIntoManagerVersion);

  function returnsNullForAbsentOrUnknownValues() {
    const packageManagerField = parsePackageManagerField(undefined);
    expect(packageManagerField).toBeNull();
    expect(parsePackageManagerField('rush@1.0.0')).toBeNull();
  }

  it('returns null for absent or unknown values', returnsNullForAbsentOrUnknownValues);
}

describe('parsePackageManagerField', describeParsePackageManagerField);

function describeDetectFromLockfiles() {
  function prefersPnpmYarnOverAnIncidentalPackageLockPiece() {
    const fromLockfiles = detectFromLockfiles(new Set(['pnpm-lock.yaml', 'package-lock.json']));

    expect(fromLockfiles).toBe('pnpm');
    expect(detectFromLockfiles(new Set(['yarn.lock']))).toBe('yarn');
    expect(detectFromLockfiles(new Set(['bun.lock']))).toBe('bun');
    expect(detectFromLockfiles(new Set(['package-lock.json']))).toBe('npm');
    expect(detectFromLockfiles(new Set())).toBeNull();
  }

  it(
    'prefers pnpm/yarn over an incidental package-lock.json',
    prefersPnpmYarnOverAnIncidentalPackageLockPiece,
  );
}

describe('detectFromLockfiles', describeDetectFromLockfiles);

function describePackageManagerWarnings() {
  function flagsACorepackPinWithCorepackDisabled() {
    const warnings = packageManagerWarnings({
      info: { name: 'pnpm', version: '9.1.0', source: 'packageManager', corepackPinned: true },
      lockfile: 'pnpm-lock.yaml',
      corepackAvailable: false,
    });

    expect(warnings.join(' ')).toContain('corepack enable');
  }

  it('flags a Corepack pin with Corepack disabled', flagsACorepackPinWithCorepackDisabled);

  function flagsADeclaredPMThatDisagreesWithTheLockfile() {
    const warnings = packageManagerWarnings({
      info: { name: 'pnpm', version: '9.1.0', source: 'packageManager', corepackPinned: true },
      lockfile: 'yarn.lock',
      corepackAvailable: true,
    });

    expect(warnings.join(' ')).toContain('disagree');
  }

  it(
    'flags a declared PM that disagrees with the lockfile',
    flagsADeclaredPMThatDisagreesWithTheLockfile,
  );

  function isSilentForAConsistentSetup() {
    expect(
      packageManagerWarnings({
        info: { name: 'yarn', version: '4.1.0', source: 'packageManager', corepackPinned: true },
        lockfile: 'yarn.lock',
        corepackAvailable: true,
      }),
    ).toEqual([]);
  }

  it('is silent for a consistent setup', isSilentForAConsistentSetup);
}

describe('packageManagerWarnings', describePackageManagerWarnings);

function describeDetectPackageManagerFilesystem() {
  async function letsThePackageManagerFieldWinOverALockfile() {
    const dir = scratch();
    const packagePath = join(dir, 'package.json');
    const serialized = JSON.stringify({ packageManager: 'yarn@4.1.0' });

    writeFileSync(packagePath, serialized);

    const packageLockPath = join(dir, 'package-lock.json');

    writeFileSync(packageLockPath, '{}');

    const packageManager = detectPackageManager(dir);
    const packageManagerEffect = await runPackageManagerEffect(packageManager);

    expect(packageManagerEffect).toMatchObject({
      name: 'yarn',
      source: 'packageManager',
      corepackPinned: true,
    });
  }

  it(
    'lets the packageManager field win over a lockfile',
    letsThePackageManagerFieldWinOverALockfile,
  );

  async function fallsBackToTheLockfileThenYarnrcYmlThenNpm() {
    const lock = scratch();
    const pnpmLockPath = join(lock, 'pnpm-lock.yaml');

    writeFileSync(pnpmLockPath, '');

    const packageManager = detectPackageManager(lock);
    const packageManagerEffect = await runPackageManagerEffect(packageManager);

    expect(packageManagerEffect).toMatchObject({
      name: 'pnpm',
      source: 'lockfile',
    });

    const berry = scratch();
    const joinedPath = join(berry, '.yarnrc.yml');

    writeFileSync(joinedPath, '');
    expect(await runPackageManagerEffect(detectPackageManager(berry))).toMatchObject({
      name: 'yarn',
      source: 'yarnrc',
    });
    expect(await runPackageManagerEffect(detectPackageManager(scratch()))).toMatchObject({
      name: 'npm',
      source: 'default',
    });
  }

  it(
    'falls back to the lockfile, then .yarnrc.yml, then npm',
    fallsBackToTheLockfileThenYarnrcYmlThenNpm,
  );
}

describe('detectPackageManager (filesystem)', describeDetectPackageManagerFilesystem);

function describeFindWorkspaceRootInspectPackageSetup() {
  async function resolvesThePMAtTheMonorepoRootNotTheNestedAppDir() {
    const root = scratch();
    const packagePath = join(root, 'package.json');
    const serialized = JSON.stringify({ workspaces: ['apps/*'] });

    writeFileSync(packagePath, serialized);

    const pnpmLockPath = join(root, 'pnpm-lock.yaml');

    writeFileSync(pnpmLockPath, '');

    const appDir = join(root, 'apps', 'mobile');

    mkdirSync(appDir, { recursive: true });

    const joinedPath = join(appDir, 'package.json');

    writeFileSync(joinedPath, JSON.stringify({ name: 'mobile' }));

    const workspaceRoot = findWorkspaceRoot(appDir);
    const packageManagerEffect = await runPackageManagerEffect(workspaceRoot);

    expect(packageManagerEffect).toEqual({
      root,
      kind: 'npm/yarn',
    });

    const setup = await runPackageManagerEffect(inspectPackageSetup(appDir));

    expect(setup.pm.name).toBe('pnpm');
    expect(setup.workspace?.root).toBe(root);
    expect(setup.lockfile).toBe('pnpm-lock.yaml');
  }

  it(
    'resolves the PM at the monorepo root, not the nested app dir',
    resolvesThePMAtTheMonorepoRootNotTheNestedAppDir,
  );

  async function returnsNoWorkspaceForAStandaloneApp() {
    const dir = scratch();
    const packagePath = join(dir, 'package.json');
    const serialized = JSON.stringify({ name: 'solo' });

    writeFileSync(packagePath, serialized);

    const workspaceRoot = findWorkspaceRoot(dir);
    const packageManagerEffect = await runPackageManagerEffect(workspaceRoot);

    expect(packageManagerEffect).toBeNull();
  }

  it('returns no workspace for a standalone app', returnsNoWorkspaceForAStandaloneApp);
}

describe('findWorkspaceRoot + inspectPackageSetup', describeFindWorkspaceRootInspectPackageSetup);
