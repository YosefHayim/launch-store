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
} from './packageManager.js';

const tmpDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launch-pm-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('parsePackageManagerField', () => {
  it('splits a Corepack pin into manager + version', () => {
    expect(parsePackageManagerField('yarn@4.1.0')).toEqual({ name: 'yarn', version: '4.1.0' });
    expect(parsePackageManagerField('pnpm@9.1.0+sha512.abc')).toEqual({
      name: 'pnpm',
      version: '9.1.0',
    });
    expect(parsePackageManagerField('npm')).toEqual({ name: 'npm' });
  });
  it('returns null for absent or unknown values', () => {
    expect(parsePackageManagerField(undefined)).toBeNull();
    expect(parsePackageManagerField('rush@1.0.0')).toBeNull();
  });
});

describe('detectFromLockfiles', () => {
  it('prefers pnpm/yarn over an incidental package-lock.json', () => {
    expect(detectFromLockfiles(new Set(['pnpm-lock.yaml', 'package-lock.json']))).toBe('pnpm');
    expect(detectFromLockfiles(new Set(['yarn.lock']))).toBe('yarn');
    expect(detectFromLockfiles(new Set(['bun.lock']))).toBe('bun');
    expect(detectFromLockfiles(new Set(['package-lock.json']))).toBe('npm');
    expect(detectFromLockfiles(new Set())).toBeNull();
  });
});

describe('packageManagerWarnings', () => {
  it('flags a Corepack pin with Corepack disabled', () => {
    const warnings = packageManagerWarnings({
      info: { name: 'pnpm', version: '9.1.0', source: 'packageManager', corepackPinned: true },
      lockfile: 'pnpm-lock.yaml',
      corepackAvailable: false,
    });
    expect(warnings.join(' ')).toContain('corepack enable');
  });
  it('flags a declared PM that disagrees with the lockfile', () => {
    const warnings = packageManagerWarnings({
      info: { name: 'pnpm', version: '9.1.0', source: 'packageManager', corepackPinned: true },
      lockfile: 'yarn.lock',
      corepackAvailable: true,
    });
    expect(warnings.join(' ')).toContain('disagree');
  });
  it('is silent for a consistent setup', () => {
    expect(
      packageManagerWarnings({
        info: { name: 'yarn', version: '4.1.0', source: 'packageManager', corepackPinned: true },
        lockfile: 'yarn.lock',
        corepackAvailable: true,
      }),
    ).toEqual([]);
  });
});

describe('detectPackageManager (filesystem)', () => {
  it('lets the packageManager field win over a lockfile', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.1.0' }));
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir)).toMatchObject({
      name: 'yarn',
      source: 'packageManager',
      corepackPinned: true,
    });
  });
  it('falls back to the lockfile, then .yarnrc.yml, then npm', () => {
    const lock = scratch();
    writeFileSync(join(lock, 'pnpm-lock.yaml'), '');
    expect(detectPackageManager(lock)).toMatchObject({ name: 'pnpm', source: 'lockfile' });

    const berry = scratch();
    writeFileSync(join(berry, '.yarnrc.yml'), '');
    expect(detectPackageManager(berry)).toMatchObject({ name: 'yarn', source: 'yarnrc' });

    expect(detectPackageManager(scratch())).toMatchObject({ name: 'npm', source: 'default' });
  });
});

describe('findWorkspaceRoot + inspectPackageSetup', () => {
  it('resolves the PM at the monorepo root, not the nested app dir', () => {
    const root = scratch();
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: ['apps/*'] }));
    writeFileSync(join(root, 'pnpm-lock.yaml'), '');
    const appDir = join(root, 'apps', 'mobile');
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'mobile' }));

    expect(findWorkspaceRoot(appDir)).toEqual({ root, kind: 'npm/yarn' });
    const setup = inspectPackageSetup(appDir);
    expect(setup.pm.name).toBe('pnpm');
    expect(setup.workspace?.root).toBe(root);
    expect(setup.lockfile).toBe('pnpm-lock.yaml');
  });

  it('returns no workspace for a standalone app', () => {
    const dir = scratch();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'solo' }));
    expect(findWorkspaceRoot(dir)).toBeNull();
  });
});
