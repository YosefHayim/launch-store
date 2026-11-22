import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLastApp, readLastBump, readLastRun, rememberLastRun } from './last-run.ts';

describe('lastRun - remembered build picks round-trip through a temp file', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    const systemTemporaryDirectory = tmpdir();
    const launchLastrunPath = join(systemTemporaryDirectory, 'launch-lastrun-');
    dir = mkdtempSync(launchLastrunPath);
    file = join(dir, 'last-run.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads an empty, well-formed state before anything is written', async () => {
    const lastRun = readLastRun(file);
    await expect(lastRun).resolves.toEqual({ apps: {} });
    const lastApp = readLastApp(file);
    await expect(lastApp).resolves.toBeUndefined();
    const lastBump = readLastBump('sampleapp', file);
    await expect(lastBump).resolves.toBeUndefined();
  });

  it('remembers the last app and its bump, then reads them back', async () => {
    await rememberLastRun('sampleapp', 'patch', file);
    const lastApp = readLastApp(file);
    await expect(lastApp).resolves.toBe('sampleapp');
    const lastBump = readLastBump('sampleapp', file);
    await expect(lastBump).resolves.toBe('patch');
  });

  it("updates lastApp without clobbering another app's remembered bump", async () => {
    await rememberLastRun('sampleapp', 'minor', file);
    await rememberLastRun('arcade', 'major', file);
    const lastApp = readLastApp(file);
    await expect(lastApp).resolves.toBe('arcade');
    const lastBump = readLastBump('sampleapp', file);
    await expect(lastBump).resolves.toBe('minor');
    await expect(readLastBump('arcade', file)).resolves.toBe('major');
  });

  it('leaves a prior bump untouched when none is applied', async () => {
    await rememberLastRun('sampleapp', 'patch', file);
    await rememberLastRun('sampleapp', undefined, file);
    const lastApp = readLastApp(file);
    await expect(lastApp).resolves.toBe('sampleapp');
    const lastBump = readLastBump('sampleapp', file);
    await expect(lastBump).resolves.toBe('patch');
  });

  it('tolerates a malformed file, reading as nothing remembered', async () => {
    writeFileSync(file, '{ not json');
    const lastRun = readLastRun(file);
    await expect(lastRun).resolves.toEqual({ apps: {} });
  });
});
