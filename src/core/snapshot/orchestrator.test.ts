import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { captureSnapshot, SNAPSHOT_EXIT, SNAPSHOT_VERSION } from './orchestrator.js';
import type { LaunchConfig } from '../types/config.js';
import type {
  SnapshotContext,
  SnapshotSource,
  SnapshotStore,
  SourceCapture,
} from '../types/snapshot.js';
/** A minimal context - fake sources ignore it, but the type must be honored without casts. */
const makeCtx = (): SnapshotContext => {
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
    resolveAscApi: () => Effect.succeed(null),
    resolvePlayApi: () => Effect.succeed(null),
  };
};
/** A source that returns a canned capture (or throws), ignoring its context. */
const source = (
  id: string,
  store: SnapshotStore,
  capture: () => Effect.Effect<SourceCapture, unknown>,
): SnapshotSource => {
  return { id, title: id, store, capture };
};
const META = { name: 'before-sync', capturedAt: '2026-06-16T00:00:00.000Z' };
const runCapture = (sources: SnapshotSource[]) =>
  Effect.runPromise(captureSnapshot(makeCtx(), sources, META));
/** A captured surface holding `count` entities under one app. */
const captured = (count: number): SourceCapture => {
  const entities = Array.from({ length: count }, (_, i) => ({
    key: `p${i}`,
    summary: `p${i}`,
    data: { id: i },
  }));
  return { state: 'captured', apps: [{ app: 'alpha', identifier: 'com.acme.alpha', entities }] };
};
describe('captureSnapshot', () => {
  it('assembles the record with version, name, and capture time', async () => {
    const captureResult = await runCapture([
      source('a', 'appstore', () => Effect.succeed(captured(2))),
    ]);
    expect(captureResult.snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(captureResult.snapshot.name).toBe('before-sync');
    expect(captureResult.snapshot.capturedAt).toBe('2026-06-16T00:00:00.000Z');
  });
  it('tallies captured entities across sources and exits ok', async () => {
    const captureResult = await runCapture([
      source('a', 'appstore', () => Effect.succeed(captured(2))),
      source('b', 'play', () => Effect.succeed(captured(3))),
    ]);
    expect(captureResult.entityCount).toBe(5);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.ok);
  });
  it('drops omitted surfaces from the persisted record', async () => {
    const captureResult = await runCapture([
      source('a', 'appstore', () => Effect.succeed(captured(1))),
      source('b', 'play', () => Effect.succeed({ state: 'omitted' })),
    ]);
    expect(captureResult.snapshot.reports.map((report) => report.id)).toEqual(['a']);
  });
  it('records a skipped surface without failing the run', async () => {
    const captureResult = await runCapture([
      source('a', 'play', () =>
        Effect.succeed({ state: 'skipped', reason: 'no Play credentials' }),
      ),
    ]);
    expect(captureResult.skippedCount).toBe(1);
    expect(captureResult.errorCount).toBe(0);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.ok);
  });
  it('converts a thrown source into an errored report and exits 1', async () => {
    const captureResult = await runCapture([
      source('ok', 'appstore', () => Effect.succeed(captured(1))),
      source('boom', 'play', () => Effect.fail(new Error('network down'))),
    ]);
    const errored = captureResult.snapshot.reports.find((report) => report.id === 'boom');
    expect(errored?.outcome).toEqual({ state: 'errored', error: 'network down' });
    expect(captureResult.errorCount).toBe(1);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.error);
  });
});
