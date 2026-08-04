import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLaunchPathsTest } from '../services/paths.js';
import type { TrainRecord } from '../types/releaseTrain.js';
import {
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  removeTrainRecord,
  type TrainRecordRequirements,
  writeTrainRecord,
} from './record.js';
/** Build a minimal valid train record, overridable per field. */
const train = (over: Partial<TrainRecord> = {}): TrainRecord => {
  return {
    id: 'helloworld-ab12',
    app: 'hello-world',
    hold: false,
    state: 'running',
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
    cars: [
      { kind: 'ios', state: 'building', updatedAt: '2026-06-16T00:00:00.000Z' },
      {
        kind: 'ota',
        platform: 'ios',
        channel: 'production',
        runtimeVersion: '1.0.0',
        state: 'pending',
        updatedAt: '2026-06-16T00:00:00.000Z',
      },
    ],
    ...over,
  };
};

/** Run one record operation with deterministic Launch home and Node platform services. */
const runRecordOperation = <Success, Failure>(
  recordOperation: Effect.Effect<Success, Failure, TrainRecordRequirements>,
): Promise<Success> =>
  Effect.runPromise(
    recordOperation.pipe(
      Effect.provide(makeLaunchPathsTest('/tmp/launch-home', '/tmp/launch-workspace')),
      Effect.provide(NodeContext.layer),
    ),
  );

describe('release-train record', () => {
  let directoryPath: string;
  beforeEach(() => {
    directoryPath = mkdtempSync(join(tmpdir(), 'launch-trains-'));
  });
  afterEach(() => {
    rmSync(directoryPath, { recursive: true, force: true });
  });
  it('round-trips a record through write -> read unchanged', async () => {
    const trainRecord = train();
    await runRecordOperation(writeTrainRecord(trainRecord, directoryPath));
    expect(await runRecordOperation(readTrainRecord(trainRecord.id, directoryPath))).toEqual(
      trainRecord,
    );
  });
  it('returns null for an unknown id', async () => {
    expect(await runRecordOperation(readTrainRecord('nope', directoryPath))).toBeNull();
  });
  it('tolerates a corrupt record file (reads as null / skips it in lists)', async () => {
    writeFileSync(join(directoryPath, 'broken.json'), '{ not json');
    await runRecordOperation(writeTrainRecord(train(), directoryPath));
    expect(await runRecordOperation(readTrainRecord('broken', directoryPath))).toBeNull();
    expect(await runRecordOperation(listTrainRecords(directoryPath))).toHaveLength(1);
  });
  it('lists records newest-first by createdAt', async () => {
    await runRecordOperation(
      writeTrainRecord(train({ id: 'old', createdAt: '2026-06-10T00:00:00.000Z' }), directoryPath),
    );
    await runRecordOperation(
      writeTrainRecord(train({ id: 'new', createdAt: '2026-06-15T00:00:00.000Z' }), directoryPath),
    );
    const trainRecords = await runRecordOperation(listTrainRecords(directoryPath));
    expect(trainRecords.map((trainRecord) => trainRecord.id)).toEqual(['new', 'old']);
  });
  it('latestTrainRecord prefers a live train over a newer terminal one', async () => {
    await runRecordOperation(
      writeTrainRecord(
        train({ id: 'done-newer', state: 'done', createdAt: '2026-06-15T00:00:00.000Z' }),
        directoryPath,
      ),
    );
    await runRecordOperation(
      writeTrainRecord(
        train({
          id: 'running-older',
          state: 'running',
          createdAt: '2026-06-14T00:00:00.000Z',
        }),
        directoryPath,
      ),
    );
    const latestTrain = await runRecordOperation(latestTrainRecord(directoryPath));
    expect(latestTrain?.id).toBe('running-older');
  });
  it('latestTrainRecord falls back to the newest terminal train when none are live', async () => {
    await runRecordOperation(
      writeTrainRecord(
        train({ id: 'done-older', state: 'done', createdAt: '2026-06-13T00:00:00.000Z' }),
        directoryPath,
      ),
    );
    await runRecordOperation(
      writeTrainRecord(
        train({
          id: 'aborted-newer',
          state: 'aborted',
          createdAt: '2026-06-16T00:00:00.000Z',
        }),
        directoryPath,
      ),
    );
    const latestTrain = await runRecordOperation(latestTrainRecord(directoryPath));
    expect(latestTrain?.id).toBe('aborted-newer');
  });
  it('returns null from latestTrainRecord when no trains exist', async () => {
    expect(await runRecordOperation(latestTrainRecord(directoryPath))).toBeNull();
  });
  it('removes a record', async () => {
    await runRecordOperation(writeTrainRecord(train(), directoryPath));
    await runRecordOperation(removeTrainRecord('helloworld-ab12', directoryPath));
    expect(await runRecordOperation(readTrainRecord('helloworld-ab12', directoryPath))).toBeNull();
  });
});
