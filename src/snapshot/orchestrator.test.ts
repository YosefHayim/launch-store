import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import type {
  SnapshotContext,
  SnapshotSource,
  SnapshotStore,
  SourceCapture,
} from '../types/snapshot.ts';
import { captureSnapshot, SNAPSHOT_EXIT, SNAPSHOT_VERSION } from './orchestrator.ts';

function makeCtx(): SnapshotContext {
  const config: LaunchConfig = {
    profiles: {},
    credentials: 'local',
    storage: 'local',
    buildEngine: 'xcode',
    submit: 'app-store-connect',
  };

  return {
    config,
    apps: [],
    resolveAscApi: () => Promise.resolve(null),
    resolvePlayApi: () => Promise.resolve(null),
  };
}

function source(
  id: string,
  store: SnapshotStore,
  capture: () => Promise<SourceCapture>,
): SnapshotSource {
  return { id, title: id, store, capture };
}

function runCapture(sources: readonly SnapshotSource[]) {
  return captureSnapshot(makeCtx(), sources, {
    name: 'before-sync',
    capturedAt: '2026-06-16T00:00:00.000Z',
  });
}

function captured(count: number): SourceCapture {
  const entities = Array.from({ length: count }, function entityAt(_ignored, index) {
    return {
      key: `p${index}`,
      summary: `p${index}`,
      data: { id: index },
    };
  });

  return { state: 'captured', apps: [{ app: 'alpha', identifier: 'com.acme.alpha', entities }] };
}

describe('captureSnapshot', () => {
  it('assembles the record with version, name, and capture time', async () => {
    const captureResult = await runCapture([
      source('a', 'appstore', () => {
        return Promise.resolve(captured(2));
      }),
    ]);
    expect(captureResult.snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(captureResult.snapshot.name).toBe('before-sync');
    expect(captureResult.snapshot.capturedAt).toBe('2026-06-16T00:00:00.000Z');
  });

  it('tallies captured entities across sources and exits ok', async () => {
    const captureResult = await runCapture([
      source('a', 'appstore', () => {
        return Promise.resolve(captured(2));
      }),
      source('b', 'play', () => {
        return Promise.resolve(captured(3));
      }),
    ]);
    expect(captureResult.entityCount).toBe(5);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.ok);
  });

  it('drops omitted surfaces from the persisted record', async () => {
    const captureResult = await runCapture([
      source('a', 'appstore', () => {
        return Promise.resolve(captured(1));
      }),
      source('b', 'play', () => Promise.resolve({ state: 'omitted' })),
    ]);
    expect(captureResult.snapshot.reports.map((report) => report.id)).toEqual(['a']);
  });

  it('records a skipped surface without failing the run', async () => {
    const captureResult = await runCapture([
      source('a', 'play', () =>
        Promise.resolve({ state: 'skipped', reason: 'no Play credentials' }),
      ),
    ]);
    expect(captureResult.skippedCount).toBe(1);
    expect(captureResult.errorCount).toBe(0);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.ok);
  });

  it('converts a thrown source into an errored report and exits 1', async () => {
    const captureResult = await runCapture([
      source('ok', 'appstore', () => {
        return Promise.resolve(captured(1));
      }),
      source('boom', 'play', () => Promise.reject(new Error('network down'))),
    ]);
    const errored = captureResult.snapshot.reports.find((report) => report.id == 'boom');
    expect(errored?.outcome).toEqual({ state: 'errored', error: 'network down' });
    expect(captureResult.errorCount).toBe(1);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.error);
  });
});
