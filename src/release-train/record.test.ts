import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrainRecord } from '../types/release-train.ts';
import {
  isLiveTrain,
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  removeTrainRecord,
  safeTrainId,
  writeTrainRecord,
} from './record.ts';

function train(over: Partial<TrainRecord> = {}): TrainRecord {
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
}

function readTrainId(trainRecord: TrainRecord): string {
  return trainRecord.id;
}

describe('release-train record pure helpers', () => {
  it('treats running and blocked trains as live', () => {
    expect(isLiveTrain(train({ state: 'running' }))).toBe(true);
    expect(isLiveTrain(train({ state: 'blocked' }))).toBe(true);
    expect(isLiveTrain(train({ state: 'done' }))).toBe(false);
    expect(isLiveTrain(train({ state: 'aborted' }))).toBe(false);
  });

  it('sanitizes train ids for filenames', () => {
    expect(safeTrainId('hello-world_ab12')).toBe('hello-world_ab12');
    expect(safeTrainId('weird/../id')).toBe('weirdid');
    expect(safeTrainId('!!!')).toBe('train');
  });
});

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
    await writeTrainRecord(trainRecord, directoryPath);
    expect(await readTrainRecord(trainRecord.id, directoryPath)).toEqual(trainRecord);
  });

  it('returns null for an unknown id', async () => {
    expect(await readTrainRecord('nope', directoryPath)).toBeNull();
  });

  it('tolerates a corrupt record file (reads as null / skips it in lists)', async () => {
    writeFileSync(join(directoryPath, 'broken.json'), '{ not json');
    await writeTrainRecord(train(), directoryPath);
    expect(await readTrainRecord('broken', directoryPath)).toBeNull();
    expect(await listTrainRecords(directoryPath)).toHaveLength(1);
  });

  it('lists records newest-first by createdAt', async () => {
    await writeTrainRecord(
      train({ id: 'old', createdAt: '2026-06-10T00:00:00.000Z' }),
      directoryPath,
    );
    await writeTrainRecord(
      train({ id: 'new', createdAt: '2026-06-15T00:00:00.000Z' }),
      directoryPath,
    );
    const trainRecords = await listTrainRecords(directoryPath);
    expect(trainRecords.map(readTrainId)).toEqual(['new', 'old']);
  });

  it('latestTrainRecord prefers a live train over a newer terminal one', async () => {
    await writeTrainRecord(
      train({ id: 'done-newer', state: 'done', createdAt: '2026-06-15T00:00:00.000Z' }),
      directoryPath,
    );
    await writeTrainRecord(
      train({
        id: 'running-older',
        state: 'running',
        createdAt: '2026-06-14T00:00:00.000Z',
      }),
      directoryPath,
    );
    const latestTrain = await latestTrainRecord(directoryPath);
    expect(latestTrain?.id).toBe('running-older');
  });

  it('latestTrainRecord falls back to the newest terminal train when none are live', async () => {
    await writeTrainRecord(
      train({ id: 'done-older', state: 'done', createdAt: '2026-06-13T00:00:00.000Z' }),
      directoryPath,
    );
    await writeTrainRecord(
      train({
        id: 'aborted-newer',
        state: 'aborted',
        createdAt: '2026-06-16T00:00:00.000Z',
      }),
      directoryPath,
    );
    const latestTrain = await latestTrainRecord(directoryPath);
    expect(latestTrain?.id).toBe('aborted-newer');
  });

  it('returns null from latestTrainRecord when no trains exist', async () => {
    expect(await latestTrainRecord(directoryPath)).toBeNull();
  });

  it('removes a record', async () => {
    await writeTrainRecord(train(), directoryPath);
    await removeTrainRecord('helloworld-ab12', directoryPath);
    expect(await readTrainRecord('helloworld-ab12', directoryPath)).toBeNull();
  });
});
