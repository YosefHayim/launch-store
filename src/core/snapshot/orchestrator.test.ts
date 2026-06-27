import { describe, expect, it } from 'vitest';
import { captureSnapshot, SNAPSHOT_EXIT, SNAPSHOT_VERSION } from './orchestrator.js';
import type { SnapshotContext, SnapshotSource, SnapshotStore, SourceCapture } from './types.js';
import type { LaunchConfig } from '../types.js';

/** A minimal context — fake sources ignore it, but the type must be honored without casts. */
function makeCtx(): SnapshotContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'fastlane',
    submit: 'app-store-connect',
  };
  return {
    config,
    apps: [],
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

/** A source that returns a canned capture (or throws), ignoring its context. */
function source(
  id: string,
  store: SnapshotStore,
  capture: () => Promise<SourceCapture>,
): SnapshotSource {
  return { id, title: id, store, capture };
}

const META = { name: 'before-sync', capturedAt: '2026-06-16T00:00:00.000Z' };

/** A captured surface holding `count` entities under one app. */
function captured(count: number): SourceCapture {
  const entities = Array.from({ length: count }, (_, i) => ({
    key: `p${i}`,
    summary: `p${i}`,
    data: { id: i },
  }));
  return { state: 'captured', apps: [{ app: 'alpha', identifier: 'com.acme.alpha', entities }] };
}

describe('captureSnapshot', () => {
  it('assembles the record with version, name, and capture time', async () => {
    const result = await captureSnapshot(
      makeCtx(),
      [source('a', 'appstore', () => Promise.resolve(captured(2)))],
      META,
    );
    expect(result.snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(result.snapshot.name).toBe('before-sync');
    expect(result.snapshot.capturedAt).toBe('2026-06-16T00:00:00.000Z');
  });

  it('tallies captured entities across sources and exits ok', async () => {
    const result = await captureSnapshot(
      makeCtx(),
      [
        source('a', 'appstore', () => Promise.resolve(captured(2))),
        source('b', 'play', () => Promise.resolve(captured(3))),
      ],
      META,
    );
    expect(result.entityCount).toBe(5);
    expect(result.exitCode).toBe(SNAPSHOT_EXIT.ok);
  });

  it('drops omitted surfaces from the persisted record', async () => {
    const result = await captureSnapshot(
      makeCtx(),
      [
        source('a', 'appstore', () => Promise.resolve(captured(1))),
        source('b', 'play', () => Promise.resolve({ state: 'omitted' })),
      ],
      META,
    );
    expect(result.snapshot.reports.map((report) => report.id)).toEqual(['a']);
  });

  it('records a skipped surface without failing the run', async () => {
    const result = await captureSnapshot(
      makeCtx(),
      [
        source('a', 'play', () =>
          Promise.resolve({ state: 'skipped', reason: 'no Play credentials' }),
        ),
      ],
      META,
    );
    expect(result.skippedCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.exitCode).toBe(SNAPSHOT_EXIT.ok);
  });

  it('converts a thrown source into an errored report and exits 1', async () => {
    const result = await captureSnapshot(
      makeCtx(),
      [
        source('ok', 'appstore', () => Promise.resolve(captured(1))),
        source('boom', 'play', () => Promise.reject(new Error('network down'))),
      ],
      META,
    );
    const errored = result.snapshot.reports.find((report) => report.id === 'boom');
    expect(errored?.outcome).toEqual({ state: 'errored', error: 'network down' });
    expect(result.errorCount).toBe(1);
    expect(result.exitCode).toBe(SNAPSHOT_EXIT.error);
  });
});
