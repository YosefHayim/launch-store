import { describe, expect, it } from 'vitest';
import type { UpdateManifest } from '../distribution/over-the-air-manifest.ts';
import {
  formatUpdateDetail,
  formatUpdatesTable,
  platformsForUpdatesFilter,
  shortId,
  type UpdateRow,
} from './updates-command.ts';

/** Build one history row with concise overrides for each scenario. */
function makeUpdateRow(overrides: Partial<UpdateRow> = {}): UpdateRow {
  return {
    id: '1234abcd-5678-90ef-ghij-klmnopqrstuv',
    platform: 'ios',
    runtimeVersion: '1.0.0',
    createdAt: '2026-06-14T09:12:00.000Z',
    active: true,
    signed: true,
    kind: 'publish',
    ...overrides,
  };
}

const sampleManifest: UpdateManifest = {
  id: '1234abcd',
  createdAt: '2026-06-14T09:12:00.000Z',
  runtimeVersion: '1.0.0',
  launchAsset: {
    key: 'bundle',
    contentType: 'application/javascript',
    url: 'https://cdn/bundle.hbc',
  },
  assets: [
    { key: 'logo', contentType: 'image/png', url: 'https://cdn/logo.png', fileExtension: '.png' },
  ],
  metadata: {},
  extra: {},
};

function describeShortId() {
  function abbreviatesAUUIDToItsFirstEightCharacters() {
    expect(shortId('1234abcd-5678-90ef')).toBe('1234abcd');
  }

  it('abbreviates a UUID to its first eight characters', abbreviatesAUUIDToItsFirstEightCharacters);
}

describe('shortId', describeShortId);

function describePlatformsForUpdatesFilter() {
  function defaultsToBothPlatformsWhenTheFilterIsOmitted() {
    expect(platformsForUpdatesFilter(undefined)).toEqual(['ios', 'android']);
  }

  it(
    'defaults to both platforms when the filter is omitted',
    defaultsToBothPlatformsWhenTheFilterIsOmitted,
  );

  function acceptsIosOrAndroidAlone() {
    expect(platformsForUpdatesFilter('ios')).toEqual(['ios']);
    expect(platformsForUpdatesFilter('android')).toEqual(['android']);
  }

  it('accepts ios or android alone', acceptsIosOrAndroidAlone);

  function rejectsAnUnknownPlatformWithATaggedFailure() {
    var thrown: unknown = null;

    try {
      platformsForUpdatesFilter('web');
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toMatchObject({
      _tag: 'UpdatesCommandFailure',
      operation: 'parse update platform',
      message: 'Unknown --platform "web". Use "ios" or "android".',
    });
  }

  it(
    'rejects an unknown platform with a tagged failure',
    rejectsAnUnknownPlatformWithATaggedFailure,
  );
}

describe('platformsForUpdatesFilter', describePlatformsForUpdatesFilter);

function describeFormatUpdatesTable() {
  function rendersAHeaderAndOnePiecePerUpdateWithTheActiveMarker() {
    const makeUpdate = makeUpdateRow({ id: 'aaaaaaaa-1', active: true, kind: 'publish' });
    const table = formatUpdatesTable([
      makeUpdate,
      makeUpdateRow({
        id: 'bbbbbbbb-2',
        platform: 'android',
        active: false,
        kind: 'rollback',
        runtimeVersion: '2.0.0',
      }),
    ]);
    const [header, first, second] = table.split('\n');

    expect(header).toContain('UPDATE');
    expect(header).toContain('ACTIVE');
    expect(first).toContain('aaaaaaaa');
    expect(first).toContain('yes');
    expect(second).toContain('android');
    expect(second).toContain('rollback');
    expect(second).toContain('2.0.0');
    expect(second).not.toContain('yes');
  }

  it(
    'renders a header and one row per update with the active marker',
    rendersAHeaderAndOnePiecePerUpdateWithTheActiveMarker,
  );
}

describe('formatUpdatesTable', describeFormatUpdatesTable);

function describeFormatUpdateDetail() {
  function includesTheBundleURLAssetCountAndActiveSignedLabelsWhenPresent() {
    const makeUpdate = makeUpdateRow();
    const detail = formatUpdateDetail(makeUpdate, sampleManifest);

    expect(detail).toContain('https://cdn/bundle.hbc');
    expect(detail).toContain('assets:  1');
    expect(detail).toContain('active');
    expect(detail).toContain('signed:  yes');
  }

  it(
    'includes the bundle URL, asset count, and active/signed labels when present',
    includesTheBundleURLAssetCountAndActiveSignedLabelsWhenPresent,
  );

  function omitsManifestLinesAndActiveLabelWhenTheSnapshotAndActiveFlagAreAbsent() {
    const makeUpdate = makeUpdateRow({ active: false, signed: false });
    const detail = formatUpdateDetail(makeUpdate, null);

    expect(detail).not.toContain('bundle:');
    expect(detail).toContain('runtime 1.0.0');
    expect(detail).toContain('signed:  no');
    expect(detail).not.toContain(', active');
  }

  it(
    'omits manifest lines and active label when the snapshot and active flag are absent',
    omitsManifestLinesAndActiveLabelWhenTheSnapshotAndActiveFlagAreAbsent,
  );

  function labelsPriorRollbackHistoryRowsWithoutRewritingTheirKind() {
    const makeUpdate = makeUpdateRow({ active: false, kind: 'rollback' });
    const detail = formatUpdateDetail(makeUpdate, sampleManifest);
    expect(detail).toContain('(rollback)');
    expect(detail).not.toContain(', active');
  }

  it(
    'labels prior rollback history rows without rewriting their kind',
    labelsPriorRollbackHistoryRowsWithoutRewritingTheirKind,
  );
}

describe('formatUpdateDetail', describeFormatUpdateDetail);
