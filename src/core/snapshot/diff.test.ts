import { describe, expect, it } from 'vitest';
import { diffSnapshots, stableStringify } from './diff.js';
import type { JsonValue, Snapshot, SnapshotEntity } from '../types.js';

/** A snapshot with one captured Apple-products surface holding the given entities. */
function snap(entities: SnapshotEntity[]): Snapshot {
  return {
    version: 1,
    name: 's',
    capturedAt: '2026-06-16T00:00:00.000Z',
    reports: [
      {
        id: 'apple-products',
        title: 'App Store in-app purchases',
        store: 'appstore',
        outcome: {
          state: 'captured',
          apps: [{ app: 'alpha', identifier: 'com.acme.alpha', entities }],
        },
      },
    ],
  };
}

function entity(key: string, data: JsonValue): SnapshotEntity {
  return { key, summary: key, data };
}

describe('stableStringify', () => {
  it('is insensitive to object key order', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it('sorts keys recursively but preserves array order', () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('diffSnapshots', () => {
  it('reports an entity present only in the newer snapshot as added', () => {
    const diff = diffSnapshots(snap([]), snap([entity('coins', { id: 1 })]));
    expect(diff.addedCount).toBe(1);
    expect(diff.entries[0]).toMatchObject({
      change: 'added',
      key: 'coins',
      app: 'alpha',
      store: 'appstore',
    });
  });

  it('reports an entity present only in the baseline as removed', () => {
    const diff = diffSnapshots(snap([entity('coins', { id: 1 })]), snap([]));
    expect(diff.removedCount).toBe(1);
    expect(diff.entries[0]).toMatchObject({ change: 'removed', key: 'coins' });
  });

  it('reports a same-key entity with differing data as changed', () => {
    const diff = diffSnapshots(
      snap([entity('coins', { price: 1 })]),
      snap([entity('coins', { price: 2 })]),
    );
    expect(diff.changedCount).toBe(1);
    expect(diff.entries[0]).toMatchObject({ change: 'changed', key: 'coins' });
  });

  it('treats reordered keys as no change', () => {
    const diff = diffSnapshots(
      snap([entity('coins', { a: 1, b: 2 })]),
      snap([entity('coins', { b: 2, a: 1 })]),
    );
    expect(diff.entries).toHaveLength(0);
  });

  it('pairs entities by (store, source, app, key), not by raw key alone', () => {
    const before: Snapshot = {
      ...snap([entity('dup', { id: 1 })]),
      reports: [
        ...snap([entity('dup', { id: 1 })]).reports,
        {
          id: 'play-products',
          title: 'Google Play products',
          store: 'play',
          outcome: {
            state: 'captured',
            apps: [
              { app: 'alpha', identifier: 'com.acme.alpha', entities: [entity('dup', { id: 1 })] },
            ],
          },
        },
      ],
    };
    // The same key under a different source must not collide — re-capturing identical state yields no diff.
    expect(diffSnapshots(before, before).entries).toHaveLength(0);
  });
});
