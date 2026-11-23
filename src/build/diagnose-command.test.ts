import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { decodeDiagnoseCommandInput, findMostRecentBuildLog } from './diagnose-command.ts';

function cleanup() {
  resetLaunchDirectories();
}

afterEach(cleanup);

function describeFindMostRecentBuildLog() {
  async function returnsTheNewestLogAndIgnoresNonLogFiles() {
    const systemTemporaryDirectory = tmpdir();
    const launchDiagnosePath = join(systemTemporaryDirectory, 'launch-diagnose-');
    const homeDirectory = mkdtempSync(launchDiagnosePath);
    const logsDirectory = join(homeDirectory, '.launch', 'logs');

    mkdirSync(logsDirectory, { recursive: true });

    const olderLog = join(logsDirectory, 'older.log');
    const newerLog = join(logsDirectory, 'newer.log');

    writeFileSync(olderLog, 'old');
    writeFileSync(newerLog, 'new');

    const ignorePath = join(logsDirectory, 'ignore.txt');

    writeFileSync(ignorePath, 'ignore');
    utimesSync(olderLog, new Date(1_000), new Date(1_000));
    utimesSync(newerLog, new Date(2_000), new Date(2_000));

    useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });

    const mostRecentBuildLog = findMostRecentBuildLog();

    await expect(mostRecentBuildLog).resolves.toBe(newerLog);
  }

  it('returns the newest log and ignores non-log files', returnsTheNewestLogAndIgnoresNonLogFiles);

  async function returnsNullWhenTheLogDirectoryDoesNotExist() {
    const systemTemporaryDirectory = tmpdir();
    const launchDiagnoseEmptyPath = join(systemTemporaryDirectory, 'launch-diagnose-empty-');
    const homeDirectory = mkdtempSync(launchDiagnoseEmptyPath);

    useLaunchDirectories({ homeDirectory, workingDirectory: homeDirectory });

    const mostRecentBuildLog = findMostRecentBuildLog();

    await expect(mostRecentBuildLog).resolves.toBeNull();
  }

  it(
    'returns null when the log directory does not exist',
    returnsNullWhenTheLogDirectoryDoesNotExist,
  );
}

describe('findMostRecentBuildLog', describeFindMostRecentBuildLog);

function describeDiagnoseCommandPieceSchema() {
  function acceptsAnOmittedOrExplicitLogPath() {
    const decodeDiagnoseCommand = decodeDiagnoseCommandInput({});

    expect(decodeDiagnoseCommand).toEqual({});
    expect(decodeDiagnoseCommandInput({ logfile: '/tmp/build.log' })).toEqual({
      logfile: '/tmp/build.log',
    });
  }

  it('accepts an omitted or explicit log path', acceptsAnOmittedOrExplicitLogPath);
}

describe('DiagnoseCommandInputSchema', describeDiagnoseCommandPieceSchema);
