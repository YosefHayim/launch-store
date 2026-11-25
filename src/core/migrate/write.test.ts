import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MigrationResult } from '../types/migrate.js';
import { writeArtifacts } from './write.js';
/** A two-artifact result, overridable. */
const migration = (): MigrationResult => {
  return {
    source: 'eas',
    artifacts: [
      { path: 'launch.config.ts', contents: '// config\n' },
      { path: '.env.example', contents: 'API_URL=\n' },
    ],
    notes: [],
  };
};
describe('writeArtifacts', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-migrate-write-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const runWriteArtifacts = (writeOptions: Parameters<typeof writeArtifacts>[1]) =>
    Effect.runPromise(
      writeArtifacts(migration(), writeOptions).pipe(Effect.provide(NodeContext.layer)),
    );
  it('writes every artifact into the output directory', async () => {
    const outcome = await runWriteArtifacts({ outDir: dir });
    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    expect(outcome.skipped).toEqual([]);
    expect(readFileSync(join(dir, 'launch.config.ts'), 'utf8')).toBe('// config\n');
  });
  it('keeps an existing file untouched without --force', async () => {
    writeFileSync(join(dir, 'launch.config.ts'), '// mine\n');
    const outcome = await runWriteArtifacts({ outDir: dir });
    expect(outcome.skipped).toEqual(['launch.config.ts']);
    expect(outcome.written).toEqual(['.env.example']);
    expect(readFileSync(join(dir, 'launch.config.ts'), 'utf8')).toBe('// mine\n');
  });
  it('overwrites an existing file with --force', async () => {
    writeFileSync(join(dir, 'launch.config.ts'), '// mine\n');
    const outcome = await runWriteArtifacts({ outDir: dir, force: true });
    expect(outcome.skipped).toEqual([]);
    expect(readFileSync(join(dir, 'launch.config.ts'), 'utf8')).toBe('// config\n');
  });
  it('classifies without writing under dryRun', async () => {
    const outcome = await runWriteArtifacts({ outDir: dir, dryRun: true });
    expect(outcome.written.sort()).toEqual(['.env.example', 'launch.config.ts']);
    expect(existsSync(join(dir, 'launch.config.ts'))).toBe(false);
  });
  it('dryRun still reports an existing file as skipped', async () => {
    writeFileSync(join(dir, '.env.example'), 'X=\n');
    const outcome = await runWriteArtifacts({ outDir: dir, dryRun: true });
    expect(outcome.skipped).toEqual(['.env.example']);
    expect(outcome.written).toEqual(['launch.config.ts']);
  });
});
