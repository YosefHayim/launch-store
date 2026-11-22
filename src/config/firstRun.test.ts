import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { readFirstRunState } from './firstRun.ts';

let temporaryHome: string;

beforeEach(() => {
  temporaryHome = mkdtempSync(join(tmpdir(), 'launch-first-run-'));
  useLaunchDirectories({ homeDirectory: temporaryHome, workingDirectory: temporaryHome });
});

afterEach(() => {
  resetLaunchDirectories();
  rmSync(temporaryHome, { recursive: true, force: true });
});

describe('first-run state', () => {
  it('reads as unseen when the state file does not exist', async () => {
    await expect(readFirstRunState()).resolves.toEqual({});
  });

  it('treats malformed state as unseen', async () => {
    const launchHome = join(temporaryHome, '.launch');
    const stateFile = join(launchHome, 'state.json');
    mkdirSync(launchHome, { recursive: true });
    writeFileSync(stateFile, '{ not json');
    await expect(readFirstRunState()).resolves.toEqual({});
  });
});
