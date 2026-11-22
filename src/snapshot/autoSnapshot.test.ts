import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import type { SnapshotContext } from '../types/snapshot.ts';
import { AUTO_SNAPSHOT_PREFIX, autoSnapshotName, captureAutoSnapshot } from './autoSnapshot.ts';

const CONFIG: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};

function snapshotContext(over: Partial<SnapshotContext> = {}): SnapshotContext {
  return {
    config: CONFIG,
    apps: [],
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(null),
    ...over,
  };
}

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
    const savedSnapshot = await captureAutoSnapshot(snapshotContext(), { capturedAt, dir });
    expect(savedSnapshot.name).toBe(autoSnapshotName(capturedAt));
    expect(savedSnapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX)).toBe(true);
    expect(savedSnapshot.pruned).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('prunes older baselines beyond the retention window', async () => {
    await captureAutoSnapshot(snapshotContext(), {
      capturedAt: '2026-06-15T00:00:00.000Z',
      keep: 1,
      dir,
    });
    const second = await captureAutoSnapshot(snapshotContext(), {
      capturedAt: '2026-06-16T00:00:00.000Z',
      keep: 1,
      dir,
    });
    expect(second.pruned).toEqual([autoSnapshotName('2026-06-15T00:00:00.000Z')]);
    expect(readdirSync(dir)).toHaveLength(1);
  });
});
