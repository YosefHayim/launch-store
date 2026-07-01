import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  removeTrainRecord,
  writeTrainRecord,
} from './record.js';
import type { TrainRecord } from '../types.js';

/** Build a minimal valid train record, overridable per field. */
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

describe('release-train record', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-trains-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a record through write → read unchanged', () => {
    const record = train();
    writeTrainRecord(record, dir);
    expect(readTrainRecord(record.id, dir)).toEqual(record);
  });

  it('returns null for an unknown id', () => {
    expect(readTrainRecord('nope', dir)).toBeNull();
  });

  it('tolerates a corrupt record file (reads as null / skips it in lists)', () => {
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    writeTrainRecord(train(), dir);
    expect(readTrainRecord('broken', dir)).toBeNull();
    expect(listTrainRecords(dir)).toHaveLength(1);
  });

  it('lists records newest-first by createdAt', () => {
    writeTrainRecord(train({ id: 'old', createdAt: '2026-06-10T00:00:00.000Z' }), dir);
    writeTrainRecord(train({ id: 'new', createdAt: '2026-06-15T00:00:00.000Z' }), dir);
    expect(listTrainRecords(dir).map((t) => t.id)).toEqual(['new', 'old']);
  });

  it('latestTrainRecord prefers a live train over a newer terminal one', () => {
    writeTrainRecord(
      train({ id: 'done-newer', state: 'done', createdAt: '2026-06-15T00:00:00.000Z' }),
      dir,
    );
    writeTrainRecord(
      train({ id: 'running-older', state: 'running', createdAt: '2026-06-14T00:00:00.000Z' }),
      dir,
    );
    expect(latestTrainRecord(dir)?.id).toBe('running-older');
  });

  it('latestTrainRecord falls back to the newest terminal train when none are live', () => {
    writeTrainRecord(
      train({ id: 'done-older', state: 'done', createdAt: '2026-06-13T00:00:00.000Z' }),
      dir,
    );
    writeTrainRecord(
      train({ id: 'aborted-newer', state: 'aborted', createdAt: '2026-06-16T00:00:00.000Z' }),
      dir,
    );
    expect(latestTrainRecord(dir)?.id).toBe('aborted-newer');
  });

  it('returns null from latestTrainRecord when no trains exist', () => {
    expect(latestTrainRecord(dir)).toBeNull();
  });

  it('removes a record', () => {
    writeTrainRecord(train(), dir);
    removeTrainRecord('helloworld-ab12', dir);
    expect(readTrainRecord('helloworld-ab12', dir)).toBeNull();
  });
});
