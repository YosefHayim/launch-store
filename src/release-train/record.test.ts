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
function describeReleaseTrainPiecePureHelpers() {
  function treatsRunningAndBlockedTrainsAsLive() {
    expect(isLiveTrain(train({ state: 'running' }))).toBe(true);
    expect(isLiveTrain(train({ state: 'blocked' }))).toBe(true);
    expect(isLiveTrain(train({ state: 'done' }))).toBe(false);
    expect(isLiveTrain(train({ state: 'aborted' }))).toBe(false);
  }

  it('treats running and blocked trains as live', treatsRunningAndBlockedTrainsAsLive);
  function sanitizesTrainIdsForFilenames() {
    expect(safeTrainId('hello-world_ab12')).toBe('hello-world_ab12');
    expect(safeTrainId('weird/../id')).toBe('weirdid');
    expect(safeTrainId('!!!')).toBe('train');
  }

  it('sanitizes train ids for filenames', sanitizesTrainIdsForFilenames);
}

describe('release-train record pure helpers', describeReleaseTrainPiecePureHelpers);
function describeReleaseTrainPiece() {
  let directoryPath: string;
  function prepareReleaseTrainPiece() {
    const systemTemporaryDirectory = tmpdir();
    const launchTrainsPath = join(systemTemporaryDirectory, 'launch-trains-');
    directoryPath = mkdtempSync(launchTrainsPath);
  }

  beforeEach(prepareReleaseTrainPiece);
  function cleanupReleaseTrainPiece() {
    rmSync(directoryPath, { recursive: true, force: true });
  }

  afterEach(cleanupReleaseTrainPiece);
  async function roundTripsAPieceThroughWriteReadUnchanged() {
    const trainRecord = train();
    await writeTrainRecord(trainRecord, directoryPath);
    const readTrain = await readTrainRecord(trainRecord.id, directoryPath);
    expect(readTrain).toEqual(trainRecord);
  }

  it(
    'round-trips a record through write -> read unchanged',
    roundTripsAPieceThroughWriteReadUnchanged,
  );
  async function returnsNullForAnUnknownId() {
    const readTrain = await readTrainRecord('nope', directoryPath);
    expect(readTrain).toBeNull();
  }

  it('returns null for an unknown id', returnsNullForAnUnknownId);
  async function toleratesACorruptPieceFileReadsAsNullSkipsItInLists() {
    const brokenPath = join(directoryPath, 'broken.json');
    writeFileSync(brokenPath, '{ not json');
    await writeTrainRecord(train(), directoryPath);
    const readTrain = await readTrainRecord('broken', directoryPath);
    expect(readTrain).toBeNull();
    const trainRecords = await listTrainRecords(directoryPath);
    expect(trainRecords).toHaveLength(1);
  }

  it(
    'tolerates a corrupt record file (reads as null / skips it in lists)',
    toleratesACorruptPieceFileReadsAsNullSkipsItInLists,
  );
  async function listsRecordsNewestFirstByCreatedAt() {
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
  }

  it('lists records newest-first by createdAt', listsRecordsNewestFirstByCreatedAt);
  async function latestTrainPiecePrefersALiveTrainOverANewerTerminalOne() {
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
  }

  it(
    'latestTrainRecord prefers a live train over a newer terminal one',
    latestTrainPiecePrefersALiveTrainOverANewerTerminalOne,
  );
  async function latestTrainPieceFallsBackToTheNewestTerminalTrainWhenNoneAreLive() {
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
  }

  it(
    'latestTrainRecord falls back to the newest terminal train when none are live',
    latestTrainPieceFallsBackToTheNewestTerminalTrainWhenNoneAreLive,
  );
  async function returnsNullFromLatestTrainPieceWhenNoTrainsExist() {
    const latestTrain = await latestTrainRecord(directoryPath);
    expect(latestTrain).toBeNull();
  }

  it(
    'returns null from latestTrainRecord when no trains exist',
    returnsNullFromLatestTrainPieceWhenNoTrainsExist,
  );
  async function removesAPiece() {
    await writeTrainRecord(train(), directoryPath);
    await removeTrainRecord('helloworld-ab12', directoryPath);
    const readTrain = await readTrainRecord('helloworld-ab12', directoryPath);
    expect(readTrain).toBeNull();
  }

  it('removes a record', removesAPiece);
}

describe('release-train record', describeReleaseTrainPiece);
