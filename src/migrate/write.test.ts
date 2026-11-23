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
function describeWriteArtifacts() {
  let dir: string;
  function prepareWriteArtifacts() {
    const systemTemporaryDirectory = tmpdir();
    const launchMigrateWritePath = join(systemTemporaryDirectory, 'launch-migrate-write-');
    dir = mkdtempSync(launchMigrateWritePath);
  }

  beforeEach(prepareWriteArtifacts);
  function cleanupWriteArtifacts() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupWriteArtifacts);
  async function writesEveryArtifactIntoThePieceDirectory() {
    const outcome = await writeArtifacts(migration(), { outDir: dir });

    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    expect(outcome.skipped).toEqual([]);
    const launchPath = join(dir, 'launch.config.ts');
    const loadedFile = readFileSync(launchPath, 'utf8');
    expect(loadedFile).toBe('// config\n');
  }

  it('writes every artifact into the output directory', writesEveryArtifactIntoThePieceDirectory);
  async function keepsAnExistingFileUntouchedWithoutForce() {
    const launchPath = join(dir, 'launch.config.ts');
    writeFileSync(launchPath, '// mine\n');
    const outcome = await writeArtifacts(migration(), { outDir: dir });

    expect(outcome.skipped).toEqual(['launch.config.ts']);
    expect(outcome.written).toEqual(['.env.example']);
    const joinedPath = join(dir, 'launch.config.ts');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    expect(loadedFile).toBe('// mine\n');
  }

  it('keeps an existing file untouched without --force', keepsAnExistingFileUntouchedWithoutForce);
  async function overwritesAnExistingFileWithForce() {
    const launchPath = join(dir, 'launch.config.ts');
    writeFileSync(launchPath, '// mine\n');
    const outcome = await writeArtifacts(migration(), { outDir: dir, force: true });

    expect(outcome.skipped).toEqual([]);
    const joinedPath = join(dir, 'launch.config.ts');
    const loadedFile = readFileSync(joinedPath, 'utf8');
    expect(loadedFile).toBe('// config\n');
  }

  it('overwrites an existing file with --force', overwritesAnExistingFileWithForce);
  async function classifiesWithoutWritingUnderDryRun() {
    const outcome = await writeArtifacts(migration(), { outDir: dir, dryRun: true });

    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    const launchPath = join(dir, 'launch.config.ts');
    const pathExists = existsSync(launchPath);
    expect(pathExists).toBe(false);
  }

  it('classifies without writing under dryRun', classifiesWithoutWritingUnderDryRun);
  async function dryRunStillReportsAnExistingFileAsSkipped() {
    const joinedPath = join(dir, '.env.example');
    writeFileSync(joinedPath, 'X=\n');
    const outcome = await writeArtifacts(migration(), { outDir: dir, dryRun: true });

    expect(outcome.skipped).toEqual(['.env.example']);
    expect(outcome.written).toEqual(['launch.config.ts']);
  }

  it('dryRun still reports an existing file as skipped', dryRunStillReportsAnExistingFileAsSkipped);
}

describe('writeArtifacts', describeWriteArtifacts);
