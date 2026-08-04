import * as NodeContext from '@effect/platform-node/NodeContext';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeLaunchPathsTest } from '../services/paths.js';
import { buildLogId, buildLogPath } from './buildLog.js';

const resolveTestLogPath = (buildIdentifier: string) =>
  Effect.runPromise(
    buildLogPath(buildIdentifier).pipe(
      Effect.provide(makeLaunchPathsTest('/tmp', '/workspace')),
      Effect.provide(NodeContext.layer),
    ),
  );
describe('buildLogId', () => {
  it('joins the natural keys into the same id `builds list` shows', () => {
    expect(buildLogId({ appName: 'demo', version: '1.2.0', buildNumber: 7, platform: 'ios' })).toBe(
      'demo-1.2.0-7-ios',
    );
  });
});
describe('buildLogPath', () => {
  it('derives a .log filename under the logs dir from the id', async () => {
    expect((await resolveTestLogPath('demo-1.2.0-7-ios')).endsWith('demo-1.2.0-7-ios.log')).toBe(
      true,
    );
  });
  it('sanitizes filesystem-unsafe characters in the id', async () => {
    expect((await resolveTestLogPath('a/b c')).endsWith('a-b-c.log')).toBe(true);
  });
});
