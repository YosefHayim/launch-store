import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../types/snapshot.ts';
import { defaultSnapshotName } from './create-snapshot.ts';
import { parsePruneCount } from './prune-snapshots.ts';
import { previewOnlyTitles, savedEntitiesFor } from './restore-snapshot.ts';
import { SnapshotCommandInputSchema, countEntities } from './snapshot-command.ts';
import type { SnapshotEntity } from '../types/snapshot.ts';

/** Minimal snapshot fixture; override reports/name as needed. */
function sampleSnapshot(snapshotFields: Partial<Snapshot> = {}): Snapshot {
  return {
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
  };
}

function describeSnapshotCommandPieceSchema() {
  function decodesCaptureAndDiffOperations() {
    const snapshotCommandSchema = SnapshotCommandInputSchema({
      operation: 'create',
      name: 'before-release',
      app: 'demo',
      json: true,
    });

    expect(snapshotCommandSchema).toEqual({
      operation: 'create',
      name: 'before-release',
      app: 'demo',
      json: true,
    });
    expect(
      SnapshotCommandInputSchema({
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
  }

  it('decodes capture and diff operations', decodesCaptureAndDiffOperations);

  function decodesPruneAndRestorePieceWithoutGenericRecords() {
    const snapshotCommandSchema = SnapshotCommandInputSchema({
      operation: 'prune',
      options: { keep: '3', yes: false, json: true },
    });

    expect(snapshotCommandSchema).toEqual({
      operation: 'prune',
      options: { keep: '3', yes: false, json: true },
    });
    expect(
      SnapshotCommandInputSchema({
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
  }

  it(
    'decodes prune and restore options without generic records',
    decodesPruneAndRestorePieceWithoutGenericRecords,
  );

  function rejectsExplicitUndefinedExactOptionals() {
    function callSnapshotCommandPieceSchema() {
      return SnapshotCommandInputSchema({
        operation: 'create',
        name: undefined,
        json: false,
      });
    }

    expect(callSnapshotCommandPieceSchema).toThrow();
  }

  it('rejects explicit undefined exact optionals', rejectsExplicitUndefinedExactOptionals);
}

describe('SnapshotCommandInputSchema', describeSnapshotCommandPieceSchema);

function describeDefaultSnapshotName() {
  function filesystemSanitizesTheCaptureInstant() {
    expect(defaultSnapshotName('2026-06-16T12:34:56.789Z')).toBe(
      'snapshot-2026-06-16T12-34-56-789Z',
    );
  }

  it('filesystem-sanitizes the capture instant', filesystemSanitizesTheCaptureInstant);
}

describe('defaultSnapshotName', describeDefaultSnapshotName);

function describeCountEntities() {
  function sumsOnlyCapturedSurfaceEntitiesAndIgnoresSkippedSurfaces() {
    const entities = countEntities(sampleSnapshot());
    expect(entities).toBe(4);
  }

  it(
    'sums only captured surface entities and ignores skipped surfaces',
    sumsOnlyCapturedSurfaceEntitiesAndIgnoresSkippedSurfaces,
  );

  function returnsZeroWhenNothingWasCaptured() {
    const entities = countEntities(
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
    );

    expect(entities).toBe(0);
  }

  it('returns zero when nothing was captured', returnsZeroWhenNothingWasCaptured);
}

describe('countEntities', describeCountEntities);

function describeParsePruneCount() {
  function acceptsNonNegativeIntegers() {
    const pruneCount = parsePruneCount('0', '--keep');
    expect(pruneCount).toBe(0);
    expect(parsePruneCount('12', '--older-than')).toBe(12);
  }

  it('accepts non-negative integers', acceptsNonNegativeIntegers);

  function rejectsNonIntegersAndNegativeValuesWithAFlagSpecificMessage() {
    function callParsePruneCount() {
      return parsePruneCount('1.5', '--keep');
    }

    expect(callParsePruneCount).toThrow('--keep must be a non-negative integer.');

    function callParsePruneCount2() {
      return parsePruneCount('-1', '--older-than');
    }

    expect(callParsePruneCount2).toThrow('--older-than must be a non-negative integer.');

    try {
      parsePruneCount('1.5', '--keep');
    } catch (failure) {
      expect(failure).toMatchObject({ _tag: 'SnapshotCommandFailure' });
    }
  }

  it(
    'rejects non-integers and negative values with a flag-specific message',
    rejectsNonIntegersAndNegativeValuesWithAFlagSpecificMessage,
  );
}

describe('parsePruneCount', describeParsePruneCount);

function describeSavedEntitiesFor() {
  function returnsEveryAppWhenNoSelectorIsSet() {
    const savedApps = savedEntitiesFor(sampleSnapshot(), 'apple-listing', undefined);

    function readApp(appEntities: {
      readonly app: string;
      readonly identifier: string;
      readonly entities: readonly SnapshotEntity[];
    }) {
      return appEntities.app;
    }

    expect(savedApps.map(readApp)).toEqual(['alpha', 'beta']);
  }

  it('returns every app when no selector is set', returnsEveryAppWhenNoSelectorIsSet);

  function narrowsByCommaSeparatedAppSelector() {
    const savedApps = savedEntitiesFor(sampleSnapshot(), 'apple-listing', ' beta , missing ');

    function readApp2(appEntities: {
      readonly app: string;
      readonly identifier: string;
      readonly entities: readonly SnapshotEntity[];
    }) {
      return appEntities.app;
    }

    expect(savedApps.map(readApp2)).toEqual(['beta']);
  }

  it('narrows by comma-separated app selector', narrowsByCommaSeparatedAppSelector);

  function returnsEmptyForMissingOrNonCapturedSources() {
    expect(savedEntitiesFor(sampleSnapshot(), 'missing-source', undefined)).toEqual([]);
    expect(savedEntitiesFor(sampleSnapshot(), 'apple-capabilities', undefined)).toEqual([]);
  }

  it(
    'returns empty for missing or non-captured sources',
    returnsEmptyForMissingOrNonCapturedSources,
  );
}

describe('savedEntitiesFor', describeSavedEntitiesFor);

function describePreviewOnlyTitles() {
  function listsCapturedSurfacesThatHaveNoRestorePass() {
    expect(
      previewOnlyTitles(
        sampleSnapshot(),
        [{ source: 'apple-listing', title: 'App Store listing', actions: [] }],
        undefined,
      ),
    ).toEqual(['App Store in-app purchases (apple-products)']);
  }

  it(
    'lists captured surfaces that have no restore pass',
    listsCapturedSurfacesThatHaveNoRestorePass,
  );

  function honorsAPieceFilterAndSkipsNonCapturedSurfaces() {
    expect(previewOnlyTitles(sampleSnapshot(), [], 'apple-products')).toEqual([
      'App Store in-app purchases (apple-products)',
    ]);
    expect(previewOnlyTitles(sampleSnapshot(), [], 'apple-capabilities')).toEqual([]);
  }

  it(
    'honors a source filter and skips non-captured surfaces',
    honorsAPieceFilterAndSkipsNonCapturedSurfaces,
  );
}

describe('previewOnlyTitles', describePreviewOnlyTitles);
