import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLastApp, readLastBump, readLastRun, rememberLastRun } from './lastRun.ts';

describe('lastRun - remembered build picks round-trip through a temp file', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-lastrun-'));
    file = join(dir, 'last-run.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads an empty, well-formed state before anything is written', async () => {
    await expect(readLastRun(file)).resolves.toEqual({ apps: {} });
    await expect(readLastApp(file)).resolves.toBeUndefined();
    await expect(readLastBump('sampleapp', file)).resolves.toBeUndefined();
  });

  it('remembers the last app and its bump, then reads them back', async () => {
    await rememberLastRun('sampleapp', 'patch', file);
    await expect(readLastApp(file)).resolves.toBe('sampleapp');
    await expect(readLastBump('sampleapp', file)).resolves.toBe('patch');
  });

  it("updates lastApp without clobbering another app's remembered bump", async () => {
    await rememberLastRun('sampleapp', 'minor', file);
    await rememberLastRun('arcade', 'major', file);
    await expect(readLastApp(file)).resolves.toBe('arcade');
    await expect(readLastBump('sampleapp', file)).resolves.toBe('minor');
    await expect(readLastBump('arcade', file)).resolves.toBe('major');
  });

  it('leaves a prior bump untouched when none is applied', async () => {
    await rememberLastRun('sampleapp', 'patch', file);
    await rememberLastRun('sampleapp', undefined, file);
    await expect(readLastApp(file)).resolves.toBe('sampleapp');
    await expect(readLastBump('sampleapp', file)).resolves.toBe('patch');
  });

  it('tolerates a malformed file, reading as nothing remembered', async () => {
    writeFileSync(file, '{ not json');
    await expect(readLastRun(file)).resolves.toEqual({ apps: {} });
  });
});
