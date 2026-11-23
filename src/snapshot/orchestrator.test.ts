import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.ts';
import type {
  SnapshotContext,
  SnapshotSource,
  SnapshotStore,
  SourceCapture,
} from '../types/snapshot.ts';
import { captureSnapshot, SNAPSHOT_EXIT, SNAPSHOT_VERSION } from './orchestrator.ts';
import type { CaptureOutcome } from '../types/snapshot.ts';

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
    resolveAscApi() {
      return Promise.resolve(null);
    },
    resolvePlayApi() {
      return Promise.resolve(null);
    },
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
function describeCaptureSnapshot() {
  async function assemblesThePieceWithVersionNameAndCaptureTime() {
    function piecePiece() {
      return Promise.resolve(captured(2));
    }

    const captureResult = await runCapture([source('a', 'appstore', piecePiece)]);
    expect(captureResult.snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(captureResult.snapshot.name).toBe('before-sync');
    expect(captureResult.snapshot.capturedAt).toBe('2026-06-16T00:00:00.000Z');
  }

  it(
    'assembles the record with version, name, and capture time',
    assemblesThePieceWithVersionNameAndCaptureTime,
  );
  async function talliesCapturedEntitiesAcrossSourcesAndExitsOk() {
    function piecePiece2() {
      return Promise.resolve(captured(2));
    }

    function piecePiece3() {
      return Promise.resolve(captured(3));
    }

    const captureResult = await runCapture([
      source('a', 'appstore', piecePiece2),
      source('b', 'play', piecePiece3),
    ]);
    expect(captureResult.entityCount).toBe(5);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.ok);
  }

  it(
    'tallies captured entities across sources and exits ok',
    talliesCapturedEntitiesAcrossSourcesAndExitsOk,
  );
  async function dropsOmittedSurfacesFromThePersistedPiece() {
    function piecePiece4() {
      return Promise.resolve(captured(1));
    }

    function piecePiece5() {
      return Promise.resolve({ state: 'omitted' } as const);
    }

    const captureResult = await runCapture([
      source('a', 'appstore', piecePiece4),
      source('b', 'play', piecePiece5),
    ]);
    function readId(report: {
      readonly id: string;
      readonly title: string;
      readonly store: SnapshotStore;
      readonly outcome: CaptureOutcome;
    }) {
      return report.id;
    }

    expect(captureResult.snapshot.reports.map(readId)).toEqual(['a']);
  }

  it('drops omitted surfaces from the persisted record', dropsOmittedSurfacesFromThePersistedPiece);
  async function recordsASkippedSurfaceWithoutFailingTheRun() {
    function piecePiece6() {
      return Promise.resolve({ state: 'skipped', reason: 'no Play credentials' } as const);
    }

    const captureResult = await runCapture([source('a', 'play', piecePiece6)]);
    expect(captureResult.skippedCount).toBe(1);
    expect(captureResult.errorCount).toBe(0);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.ok);
  }

  it(
    'records a skipped surface without failing the run',
    recordsASkippedSurfaceWithoutFailingTheRun,
  );
  async function convertsAThrownPieceIntoAnErroredReportAndExits1() {
    function piecePiece7() {
      return Promise.resolve(captured(1));
    }

    function piecePiece8() {
      return Promise.reject(new Error('network down'));
    }

    const captureResult = await runCapture([
      source('ok', 'appstore', piecePiece7),
      source('boom', 'play', piecePiece8),
    ]);
    function findReport(report: {
      readonly id: string;
      readonly title: string;
      readonly store: SnapshotStore;
      readonly outcome: CaptureOutcome;
    }) {
      return report.id == 'boom';
    }

    const errored = captureResult.snapshot.reports.find(findReport);
    expect(errored?.outcome).toEqual({ state: 'errored', error: 'network down' });
    expect(captureResult.errorCount).toBe(1);
    expect(captureResult.exitCode).toBe(SNAPSHOT_EXIT.error);
  }

  it(
    'converts a thrown source into an errored report and exits 1',
    convertsAThrownPieceIntoAnErroredReportAndExits1,
  );
}

describe('captureSnapshot', describeCaptureSnapshot);
