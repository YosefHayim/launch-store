import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AUTO_SNAPSHOT_PREFIX, autoSnapshotName, captureAutoSnapshot } from './autoSnapshot.js';
import type { LaunchConfig } from '../types/config.js';
import type { SnapshotContext } from '../types/snapshot.js';
import { makeLaunchPathsTest } from '../services/paths.js';
const CONFIG: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
};
/** A context with no apps and unconfigured stores - every source skips/omits, so capture stays offline. */
const snapshotContext = (over: Partial<SnapshotContext> = {}): SnapshotContext => {
  return {
    config: CONFIG,
    apps: [],
    resolveAscApi: () => Effect.succeed(null),
    resolvePlayApi: () => Effect.succeed(null),
    ...over,
  };
};
const runAutoSnapshot = (
  snapshotContext: SnapshotContext,
  options: Parameters<typeof captureAutoSnapshot>[1],
) =>
  Effect.runPromise(
    captureAutoSnapshot(snapshotContext, options).pipe(
      Effect.provide(NodeContext.layer),
      Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
    ),
  );
describe('captureAutoSnapshot', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-auto-snap-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it('saves a reserved-prefix baseline even when no store is configured', async () => {
    const capturedAt = '2026-06-17T08:00:00.000Z';
    const savedSnapshot = await runAutoSnapshot(snapshotContext(), { capturedAt, dir });
    expect(savedSnapshot.name).toBe(autoSnapshotName(capturedAt));
    expect(savedSnapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX)).toBe(true);
    expect(savedSnapshot.pruned).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(1);
  });
  it('prunes older baselines beyond the retention window', async () => {
    await runAutoSnapshot(snapshotContext(), {
      capturedAt: '2026-06-15T00:00:00.000Z',
      keep: 1,
      dir,
    });
    const second = await runAutoSnapshot(snapshotContext(), {
      capturedAt: '2026-06-16T00:00:00.000Z',
      keep: 1,
      dir,
    });
    expect(second.pruned).toEqual([autoSnapshotName('2026-06-15T00:00:00.000Z')]);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});
