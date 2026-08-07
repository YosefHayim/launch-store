import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../types/snapshot.js';
import {
  SnapshotCommandInputSchema,
  countEntities,
  defaultSnapshotName,
  parsePruneCount,
  previewOnlyTitles,
  savedEntitiesFor,
} from './snapshotCommand.js';

/** Minimal snapshot fixture; override reports/name as needed. */
const sampleSnapshot = (snapshotFields: Partial<Snapshot> = {}): Snapshot => ({
  version: 1,
  name: 'before-release',
  capturedAt: '2026-06-16T12:00:00.000Z',
  reports: [
    {
      id: 'apple-listing',
      title: 'App Store listing',
      store: 'appstore',
      outcome: {
        state: 'captured',
        apps: [
          {
            app: 'alpha',
            identifier: 'com.acme.alpha',
            entities: [
              { key: 'en-US', summary: 'listing en-US', data: { name: 'Alpha' } },
              { key: 'fr-FR', summary: 'listing fr-FR', data: { name: 'Alpha FR' } },
            ],
          },
          {
            app: 'beta',
            identifier: 'com.acme.beta',
            entities: [{ key: 'en-US', summary: 'listing en-US', data: { name: 'Beta' } }],
          },
        ],
      },
    },
    {
      id: 'apple-products',
      title: 'App Store in-app purchases',
      store: 'appstore',
      outcome: {
        state: 'captured',
        apps: [
          {
            app: 'alpha',
            identifier: 'com.acme.alpha',
            entities: [{ key: 'coins', summary: 'coins', data: { type: 'CONSUMABLE' } }],
          },
        ],
      },
    },
    {
      id: 'apple-capabilities',
      title: 'App Store capabilities',
      store: 'appstore',
      outcome: { state: 'skipped', reason: 'no Apple account configured' },
    },
  ],
  ...snapshotFields,
});

describe('SnapshotCommandInputSchema', () => {
  it('decodes capture and diff operations', () => {
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'create',
        name: 'before-release',
        app: 'demo',
        json: true,
      }),
    ).toEqual({ operation: 'create', name: 'before-release', app: 'demo', json: true });
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'diff',
        baseline: 'before-release',
        against: 'live',
        json: false,
      }),
    ).toEqual({
      operation: 'diff',
      baseline: 'before-release',
      against: 'live',
      json: false,
    });
  });

  it('decodes prune and restore options without generic records', () => {
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'prune',
        options: { keep: '3', yes: false, json: true },
      }),
    ).toEqual({ operation: 'prune', options: { keep: '3', yes: false, json: true } });
    expect(
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'restore',
        name: 'before-release',
        source: 'apple-listing',
        yes: false,
        json: false,
      }),
    ).toEqual({
      operation: 'restore',
      name: 'before-release',
      source: 'apple-listing',
      yes: false,
      json: false,
    });
  });

  it('rejects explicit undefined exact optionals', () => {
    expect(() =>
      Schema.decodeUnknownSync(SnapshotCommandInputSchema)({
        operation: 'create',
        name: undefined,
        json: false,
      }),
    ).toThrow();
  });
});

describe('defaultSnapshotName', () => {
  it('filesystem-sanitizes the capture instant', () => {
    expect(defaultSnapshotName('2026-06-16T12:34:56.789Z')).toBe(
      'snapshot-2026-06-16T12-34-56-789Z',
    );
  });
});

describe('countEntities', () => {
  it('sums only captured surface entities and ignores skipped surfaces', () => {
    expect(countEntities(sampleSnapshot())).toBe(4);
  });

  it('returns zero when nothing was captured', () => {
    expect(
      countEntities(
        sampleSnapshot({
          reports: [
            {
              id: 'apple-listing',
              title: 'App Store listing',
              store: 'appstore',
              outcome: { state: 'skipped', reason: 'no credentials' },
            },
          ],
        }),
      ),
    ).toBe(0);
  });
});

describe('parsePruneCount', () => {
  it('accepts non-negative integers', async () => {
    expect(await Effect.runPromise(parsePruneCount('0', '--keep'))).toBe(0);
    expect(await Effect.runPromise(parsePruneCount('12', '--older-than'))).toBe(12);
  });

  it('rejects non-integers and negative values with a flag-specific message', async () => {
    const nonInteger = await Effect.runPromise(parsePruneCount('1.5', '--keep').pipe(Effect.flip));
    expect(nonInteger._tag).toBe('SnapshotCommandFailure');
    expect(nonInteger.message).toBe('--keep must be a non-negative integer.');

    const negative = await Effect.runPromise(
      parsePruneCount('-1', '--older-than').pipe(Effect.flip),
    );
    expect(negative.message).toBe('--older-than must be a non-negative integer.');
  });
});

describe('savedEntitiesFor', () => {
  it('returns every app when no selector is set', () => {
    const savedApps = savedEntitiesFor(sampleSnapshot(), 'apple-listing', undefined);
    expect(savedApps.map((appEntities) => appEntities.app)).toEqual(['alpha', 'beta']);
  });

  it('narrows by comma-separated app selector', () => {
    const savedApps = savedEntitiesFor(sampleSnapshot(), 'apple-listing', ' beta , missing ');
    expect(savedApps.map((appEntities) => appEntities.app)).toEqual(['beta']);
  });

  it('returns empty for missing or non-captured sources', () => {
    expect(savedEntitiesFor(sampleSnapshot(), 'missing-source', undefined)).toEqual([]);
    expect(savedEntitiesFor(sampleSnapshot(), 'apple-capabilities', undefined)).toEqual([]);
  });
});

describe('previewOnlyTitles', () => {
  it('lists captured surfaces that have no restore pass', () => {
    expect(
      previewOnlyTitles(
        sampleSnapshot(),
        [{ source: 'apple-listing', title: 'App Store listing', actions: [] }],
        undefined,
      ),
    ).toEqual(['App Store in-app purchases (apple-products)']);
  });

  it('honors a source filter and skips non-captured surfaces', () => {
    expect(previewOnlyTitles(sampleSnapshot(), [], 'apple-products')).toEqual([
      'App Store in-app purchases (apple-products)',
    ]);
    expect(previewOnlyTitles(sampleSnapshot(), [], 'apple-capabilities')).toEqual([]);
  });
});
