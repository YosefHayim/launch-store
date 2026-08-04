import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeLaunchPathsTest } from '../services/paths.js';
import { DiagnoseCommandInputSchema, findMostRecentBuildLog } from './diagnoseCommand.js';

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

    await expect(
      Effect.runPromise(
        findMostRecentBuildLog().pipe(
          Effect.provide(makeLaunchPathsTest(homeDirectory, homeDirectory)),
          Effect.provide(NodeContext.layer),
        ),
      ),
    ).resolves.toBe(newerLog);
  });

  it('returns null when the log directory does not exist', async () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'launch-diagnose-empty-'));
    await expect(
      Effect.runPromise(
        findMostRecentBuildLog().pipe(
          Effect.provide(makeLaunchPathsTest(homeDirectory, homeDirectory)),
          Effect.provide(NodeContext.layer),
        ),
      ),
    ).resolves.toBeNull();
  });
});

describe('DiagnoseCommandInputSchema', () => {
  it('accepts an omitted or explicit log path', () => {
    expect(Schema.decodeUnknownSync(DiagnoseCommandInputSchema)({})).toEqual({});
    expect(
      Schema.decodeUnknownSync(DiagnoseCommandInputSchema)({ logfile: '/tmp/build.log' }),
    ).toEqual({ logfile: '/tmp/build.log' });
  });
});
