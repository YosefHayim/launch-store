import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MigrationResult } from '../types/migrate.ts';
import { writeArtifacts } from './write.ts';

/** A two-artifact result, overridable. */
function migration(): MigrationResult {
  return {
    source: 'eas',
    artifacts: [
      { path: 'launch.config.ts', contents: '// config\n' },
      { path: '.env.example', contents: 'API_URL=\n' },
    ],
    notes: [],
  };
}

describe('writeArtifacts', () => {
  let dir: string;

  beforeEach(() => {
    const systemTemporaryDirectory = tmpdir();
    const launchMigrateWritePath = join(systemTemporaryDirectory, 'launch-migrate-write-');
    dir = mkdtempSync(launchMigrateWritePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes every artifact into the output directory', async () => {
    const outcome = await writeArtifacts(migration(), { outDir: dir });

    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    expect(outcome.skipped).toEqual([]);
    const launchPath = join(dir, 'launch.config.ts');
    const loadedFile = readFileSync(launchPath, 'utf8');
    expect(loadedFile).toBe('// config\n');
  });

  it('keeps an existing file untouched without --force', async () => {
    const launchPath = join(dir, 'launch.config.ts');
    writeFileSync(launchPath, '// mine\n');
    const outcome = await writeArtifacts(migration(), { outDir: dir });

    expect(outcome.skipped).toEqual(['launch.config.ts']);
    expect(outcome.written).toEqual(['.env.example']);
    const joinedPath = join(dir, 'launch.config.ts');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    expect(loadedFile).toBe('// mine\n');
  });

  it('overwrites an existing file with --force', async () => {
    const launchPath = join(dir, 'launch.config.ts');
    writeFileSync(launchPath, '// mine\n');
    const outcome = await writeArtifacts(migration(), { outDir: dir, force: true });

    expect(outcome.skipped).toEqual([]);
    const joinedPath = join(dir, 'launch.config.ts');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    expect(loadedFile).toBe('// config\n');
  });

  it('classifies without writing under dryRun', async () => {
    const outcome = await writeArtifacts(migration(), { outDir: dir, dryRun: true });

    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    const launchPath = join(dir, 'launch.config.ts');
    const pathExists = existsSync(launchPath);
    expect(pathExists).toBe(false);
  });

  it('dryRun still reports an existing file as skipped', async () => {
    const joinedPath = join(dir, '.env.example');
    writeFileSync(joinedPath, 'X=\n');
    const outcome = await writeArtifacts(migration(), { outDir: dir, dryRun: true });

    expect(outcome.skipped).toEqual(['.env.example']);
    expect(outcome.written).toEqual(['launch.config.ts']);
  });
});
