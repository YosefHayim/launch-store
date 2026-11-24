import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { buildLogId, buildLogPath } from './build-log.ts';

function readTestLogPath(buildIdentifier: string): string {
  useLaunchDirectories({ homeDirectory: '/tmp', workingDirectory: '/workspace' });

  return buildLogPath(buildIdentifier);
}

function cleanup() {
  resetLaunchDirectories();
}

afterEach(cleanup);

function describeBuildLogId() {
  function joinsTheNaturalKeysIntoTheSameIdBuildsListShows() {
    const logId = buildLogId({
      appName: 'demo',
      version: '1.2.0',
      buildNumber: 7,
      platform: 'ios',
    });

    expect(logId).toBe('demo-1.2.0-7-ios');
  }

  it(
    'joins the natural keys into the same id `builds list` shows',
    joinsTheNaturalKeysIntoTheSameIdBuildsListShows,
  );
}

describe('buildLogId', describeBuildLogId);

function describeBuildLogPath() {
  function derivesALogFilenameUnderTheLogsDirFromTheId() {
    expect(readTestLogPath('demo-1.2.0-7-ios').endsWith('demo-1.2.0-7-ios.log')).toBe(true);
  }

  it(
    'derives a .log filename under the logs dir from the id',
    derivesALogFilenameUnderTheLogsDirFromTheId,
  );

  function sanitizesFilesystemUnsafeCharactersInTheId() {
    expect(readTestLogPath('a/b c').endsWith('a-b-c.log')).toBe(true);
  }

  it(
    'sanitizes filesystem-unsafe characters in the id',
    sanitizesFilesystemUnsafeCharactersInTheId,
  );
}

describe('buildLogPath', describeBuildLogPath);
