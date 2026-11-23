import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import type { SnapshotContext } from '../types/snapshot.ts';
import { AUTO_SNAPSHOT_PREFIX, autoSnapshotName, captureAutoSnapshot } from './auto-snapshot.ts';

const sampleLaunchConfig: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};

function snapshotContext(over: Partial<SnapshotContext> = {}): SnapshotContext {
  return {
    config: sampleLaunchConfig,
    apps: [],
    resolveAscApi() {
      return Promise.resolve(null);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
    ...over,
  };
}
function describeCaptureAutoSnapshot() {
  let dir: string;

  function prepareCaptureAutoSnapshot() {
    const systemTemporaryDirectory = tmpdir();
    const launchAutoSnapPath = join(systemTemporaryDirectory, 'launch-auto-snap-');
    dir = mkdtempSync(launchAutoSnapPath);
  }

  beforeEach(prepareCaptureAutoSnapshot);

  function cleanupCaptureAutoSnapshot() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupCaptureAutoSnapshot);

  async function savesAReservedPrefixBaselineEvenWhenNoStoreIsConfigured() {
    const capturedAt = '2026-06-17T08:00:00.000Z';
    const snapshot = snapshotContext();
    const savedSnapshot = await captureAutoSnapshot(snapshot, { capturedAt, dir });

    expect(savedSnapshot.name).toBe(autoSnapshotName(capturedAt));
    expect(savedSnapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX)).toBe(true);
    expect(savedSnapshot.pruned).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(1);
  }

  it(
    'saves a reserved-prefix baseline even when no store is configured',
    savesAReservedPrefixBaselineEvenWhenNoStoreIsConfigured,
  );

  async function prunesOlderBaselinesBeyondTheRetentionWindow() {
    const snapshot = snapshotContext();

    await captureAutoSnapshot(snapshot, {
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
  }

  it(
    'prunes older baselines beyond the retention window',
    prunesOlderBaselinesBeyondTheRetentionWindow,
  );
}

describe('captureAutoSnapshot', describeCaptureAutoSnapshot);
