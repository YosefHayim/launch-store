import { describe, expect, it } from 'vitest';
import { buildLogId, buildLogPath } from './buildLog.js';

describe('buildLogId', () => {
  it('joins the natural keys into the same id `builds list` shows', () => {
    expect(buildLogId({ appName: 'demo', version: '1.2.0', buildNumber: 7, platform: 'ios' })).toBe(
      'demo-1.2.0-7-ios',
    );
  });
});

describe('buildLogPath', () => {
  it('derives a .log filename under the logs dir from the id', () => {
    expect(buildLogPath('demo-1.2.0-7-ios').endsWith('demo-1.2.0-7-ios.log')).toBe(true);
  });

  it('sanitizes filesystem-unsafe characters in the id', () => {
    expect(buildLogPath('a/b c').endsWith('a-b-c.log')).toBe(true);
  });
});
