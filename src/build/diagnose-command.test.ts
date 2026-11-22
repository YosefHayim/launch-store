import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { decodeDiagnoseCommandInput, findMostRecentBuildLog } from './diagnose-command.ts';

afterEach(() => {
  resetLaunchDirectories();
});

describe('findMostRecentBuildLog', () => {
  it('returns the newest log and ignores non-log files', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'launch-diagnose-'));
    const logsDirectory = join(homeDirectory, '.launch', 'logs');
    mkdirSync(logsDirectory, { recursive: true });
    const olderLog = join(logsDirectory, 'older.log');
    const newerLog = join(logsDirectory, 'newer.log');
    writeFileSync(olderLog, 'old');
    writeFileSync(newerLog, 'new');
    writeFileSync(join(logsDirectory, 'ignore.txt'), 'ignore');
    utimesSync(olderLog, new Date(1_000), new Date(1_000));
    utimesSync(newerLog, new Date(2_000), new Date(2_000));

    useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
    await expect(findMostRecentBuildLog()).resolves.toBe(newerLog);
  });

  it('returns null when the log directory does not exist', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'launch-diagnose-empty-'));
    useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });
    await expect(findMostRecentBuildLog()).resolves.toBeNull();
  });
});

describe('DiagnoseCommandInputSchema', () => {
  it('accepts an omitted or explicit log path', () => {
    expect(decodeDiagnoseCommandInput({})).toEqual({});
    expect(decodeDiagnoseCommandInput({ logfile: '/tmp/build.log' })).toEqual({
      logfile: '/tmp/build.log',
    });
  });
});
