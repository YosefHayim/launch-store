import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import { buildLogId, buildLogPath } from './build-log.ts';

function resolveTestLogPath(buildIdentifier: string): string {
  useLaunchDirectories({ homeDirectory: '/tmp', workingDirectory: '/workspace' });

  return buildLogPath(buildIdentifier);
}

afterEach(() => {
  resetLaunchDirectories();
});

describe('buildLogId', () => {
  it('joins the natural keys into the same id `builds list` shows', () => {
    const logId = buildLogId({
      appName: 'demo',
      version: '1.2.0',
      buildNumber: 7,
      platform: 'ios',
    });
    expect(logId).toBe('demo-1.2.0-7-ios');
  });
});
describe('buildLogPath', () => {
  it('derives a .log filename under the logs dir from the id', () => {
    expect(resolveTestLogPath('demo-1.2.0-7-ios').endsWith('demo-1.2.0-7-ios.log')).toBe(true);
  });
  it('sanitizes filesystem-unsafe characters in the id', () => {
    expect(resolveTestLogPath('a/b c').endsWith('a-b-c.log')).toBe(true);
  });
});
