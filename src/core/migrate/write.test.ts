import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MigrationResult } from '../types.js';
import { writeArtifacts } from './write.js';

/** A two-artifact result, overridable. */
function result(): MigrationResult {
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
    dir = mkdtempSync(join(tmpdir(), 'launch-migrate-write-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes every artifact into the output directory', () => {
    const outcome = writeArtifacts(result(), { outDir: dir });
    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    expect(outcome.skipped).toEqual([]);
    expect(readFileSync(join(dir, 'launch.config.ts'), 'utf8')).toBe('// config\n');
  });

  it('keeps an existing file untouched without --force', () => {
    writeFileSync(join(dir, 'launch.config.ts'), '// mine\n');
    const outcome = writeArtifacts(result(), { outDir: dir });
    expect(outcome.skipped).toEqual(['launch.config.ts']);
    expect(outcome.written).toEqual(['.env.example']);
    expect(readFileSync(join(dir, 'launch.config.ts'), 'utf8')).toBe('// mine\n');
  });

  it('overwrites an existing file with --force', () => {
    writeFileSync(join(dir, 'launch.config.ts'), '// mine\n');
    const outcome = writeArtifacts(result(), { outDir: dir, force: true });
    expect(outcome.skipped).toEqual([]);
    expect(readFileSync(join(dir, 'launch.config.ts'), 'utf8')).toBe('// config\n');
  });

  it('classifies without writing under dryRun', () => {
    const outcome = writeArtifacts(result(), { outDir: dir, dryRun: true });
    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    expect(existsSync(join(dir, 'launch.config.ts'))).toBe(false);
  });

  it('dryRun still reports an existing file as skipped', () => {
    writeFileSync(join(dir, '.env.example'), 'X=\n');
    const outcome = writeArtifacts(result(), { outDir: dir, dryRun: true });
    expect(outcome.skipped).toEqual(['.env.example']);
    expect(outcome.written).toEqual(['launch.config.ts']);
  });
});
