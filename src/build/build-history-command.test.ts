import { describe, expect, it } from 'vitest';
import type { BuildArtifact, PrunedArtifact } from '../types/artifacts.ts';
import {
  buildId,
  buildKindLabel,
  buildsLabel,
  filterBuilds,
  findBuild,
  formatBuildDetail,
  formatBuildsTable,
  formatPrunePreview,
  parsePruneDays,
  pruneConfirmationBlocked,
  readBuildRow,
} from './build-history-command.ts';

const MB = 1024 * 1024;

/** A stored-build fixture; override any field to vary one dimension under test. */
function artifact(overrides: Partial<BuildArtifact> = {}): BuildArtifact {
  return {
    path: '/home/u/.launch/artifacts/demo-1.0.0-7-ios.ipa',
    platform: 'ios',
    appName: 'demo',
    profile: 'production',
    version: '1.0.0',
    buildNumber: 7,
    sizeReport: {
      artifactBytes: 61 * MB,
      entries: [{ device: 'iPhone15,2', downloadBytes: 38 * MB, installBytes: 92 * MB }],
    },
    clean: true,
    createdAt: '2026-06-13T14:02:11.000Z',
    ...overrides,
  };
}

function describeBuildIdStableProviderIndependentIdFromNaturalKeys() {
  function joinsAppVersionBuildNumberAndPlatform() {
    expect(buildId(artifact())).toBe('demo-1.0.0-7-ios');
  }

  it('joins app, version, build number, and platform', joinsAppVersionBuildNumberAndPlatform);

  function ignoresTheStoragePathAndFileExtension() {
    expect(buildId(artifact({ path: '/elsewhere/whatever.aab' }))).toBe('demo-1.0.0-7-ios');
  }

  it('ignores the storage path and file extension', ignoresTheStoragePathAndFileExtension);
}

describe(
  'buildId - stable, provider-independent id from natural keys',
  describeBuildIdStableProviderIndependentIdFromNaturalKeys,
);

function describeToBuildPiece() {
  function derivesTheWorstCaseDownloadFromThePerDeviceEntries() {
    const tableRow = readBuildRow(
      artifact({
        sizeReport: {
          artifactBytes: 61 * MB,
          entries: [
            { device: 'a', downloadBytes: 38 * MB, installBytes: 0 },
            { device: 'b', downloadBytes: 47 * MB, installBytes: 0 },
          ],
        },
      }),
    );

    expect(tableRow.downloadBytes).toBe(47 * MB);
    expect(tableRow.artifactBytes).toBe(61 * MB);
    expect(tableRow.id).toBe('demo-1.0.0-7-ios');
  }

  it(
    'derives the worst-case download from the per-device entries',
    derivesTheWorstCaseDownloadFromThePerDeviceEntries,
  );
}

describe('readBuildRow', describeToBuildPiece);

function describeFilterBuilds() {
  const ios = artifact({ appName: 'demo', platform: 'ios' });
  const android = artifact({ appName: 'demo', platform: 'android', path: '/a/demo.aab' });
  const other = artifact({ appName: 'other', platform: 'ios' });
  const all = [ios, android, other];

  function returnsEverythingWhenNoFilterIsSet() {
    expect(filterBuilds(all, {})).toEqual(all);
  }

  it('returns everything when no filter is set', returnsEverythingWhenNoFilterIsSet);

  function filtersByApp() {
    expect(filterBuilds(all, { app: 'demo' })).toEqual([ios, android]);
  }

  it('filters by app', filtersByApp);

  function filtersByPlatform() {
    expect(filterBuilds(all, { platform: 'android' })).toEqual([android]);
  }

  it('filters by platform', filtersByPlatform);

  function filtersByAppAndPlatformTogether() {
    expect(filterBuilds(all, { app: 'demo', platform: 'ios' })).toEqual([ios]);
  }

  it('filters by app and platform together', filtersByAppAndPlatformTogether);
}

describe('filterBuilds', describeFilterBuilds);

function describeFindBuild() {
  const newest = artifact({ buildNumber: 9, version: '1.1.0' });
  const older = artifact({ buildNumber: 7, version: '1.0.0' });
  const history = [newest, older];

  function resolvesLatestToTheNewestBuild() {
    const buildProgram = findBuild(history, 'latest');
    expect(buildProgram).toBe(newest);
  }

  it('resolves `latest` to the newest build', resolvesLatestToTheNewestBuild);

  function matchesAFullBuildId() {
    const buildProgram = findBuild(history, 'demo-1.0.0-7-ios');
    expect(buildProgram).toBe(older);
  }

  it('matches a full build id', matchesAFullBuildId);

  function matchesABareBuildNumber() {
    const buildProgram = findBuild(history, '9');
    expect(buildProgram).toBe(newest);
  }

  it('matches a bare build number', matchesABareBuildNumber);

  function returnsUndefinedOnAMiss() {
    const buildProgram = findBuild(history, 'nope');
    expect(buildProgram).toBeUndefined();
  }

  it('returns undefined on a miss', returnsUndefinedOnAMiss);

  function returnsUndefinedForLatestAgainstAnEmptyHistory() {
    const buildProgram = findBuild([], 'latest');
    expect(buildProgram).toBeUndefined();
  }

  it(
    'returns undefined for `latest` against an empty history',
    returnsUndefinedForLatestAgainstAnEmptyHistory,
  );
}

describe('findBuild', describeFindBuild);

function describeBuildKindLabelBuildsLabel() {
  function labelsPrunedCleanAndIncrementalBuilds() {
    const kindLabel = buildKindLabel({ clean: true, prunedAt: '2026-06-14T00:00:00.000Z' });
    expect(kindLabel).toBe('pruned');
    expect(buildKindLabel({ clean: true })).toBe('clean');
    expect(buildKindLabel({ clean: false })).toBe('incremental');
  }

  it('labels pruned, clean, and incremental builds', labelsPrunedCleanAndIncrementalBuilds);

  function pluralizesBuildCountsForPruneAndListSummaries() {
    expect(buildsLabel(0)).toBe('0 builds');
    expect(buildsLabel(1)).toBe('1 build');
    expect(buildsLabel(3)).toBe('3 builds');
  }

  it(
    'pluralizes build counts for prune and list summaries',
    pluralizesBuildCountsForPruneAndListSummaries,
  );
}

describe('buildKindLabel / buildsLabel', describeBuildKindLabelBuildsLabel);

function describeFormatBuildsTable() {
  function rendersAHeaderPlusOneAlignedPiecePerBuild() {
    const table = formatBuildsTable([artifact()].map(readBuildRow));
    const [header, tableRow] = table.split('\n');

    expect(header).toContain('BUILD');
    expect(header).toContain('DOWNLOAD');
    expect(header).toContain('TYPE');
    expect(tableRow).toContain('demo');
    expect(tableRow).toContain('38.0 MB');
    expect(tableRow).toContain('2026-06-13 14:02');
    expect(tableRow).toContain('clean');
  }

  it('renders a header plus one aligned row per build', rendersAHeaderPlusOneAlignedPiecePerBuild);

  function labelsAnIncrementalBuild() {
    const table = formatBuildsTable([artifact({ clean: false })].map(readBuildRow));
    expect(table).toContain('incremental');
  }

  it('labels an incremental build', labelsAnIncrementalBuild);
}

describe('formatBuildsTable', describeFormatBuildsTable);

function describeFormatBuildDetail() {
  function showsBothSizeNumbersAndThePerDeviceBreakdown() {
    const detail = formatBuildDetail(artifact());

    expect(detail).toContain('demo 1.0.0 (build 7) - ios');
    expect(detail).toContain('download 38.0 MB - on disk 61.0 MB');
    expect(detail).toContain('iPhone15,2');
    expect(detail).toContain('install 92.0 MB');
    expect(detail).toContain('demo-1.0.0-7-ios');
  }

  it(
    'shows both size numbers and the per-device breakdown',
    showsBothSizeNumbersAndThePerDeviceBreakdown,
  );

  function omitsThePerDeviceBlockWhenThereIsNoThinningReport() {
    const detail = formatBuildDetail(
      artifact({ sizeReport: { artifactBytes: 61 * MB, entries: [] } }),
    );

    expect(detail).not.toContain('download / install');
    expect(detail).toContain('on disk 61.0 MB (no per-device estimate)');
  }

  it(
    'omits the per-device block when there is no thinning report',
    omitsThePerDeviceBlockWhenThereIsNoThinningReport,
  );
}

describe('formatBuildDetail', describeFormatBuildDetail);

function describePrunedBuildsHistorySurvivesBinaryIsMarkedGone() {
  function carriesPrunedAtOntoThePieceOnlyWhenSet() {
    const buildRow = readBuildRow(artifact());

    expect(buildRow.prunedAt).toBeUndefined();
    expect(readBuildRow(artifact({ prunedAt: '2026-06-14T00:00:00.000Z' })).prunedAt).toBe(
      '2026-06-14T00:00:00.000Z',
    );
  }

  it('carries prunedAt onto the row only when set', carriesPrunedAtOntoThePieceOnlyWhenSet);

  function labelsAPrunedPiecePrunedInTheTYPEColumn() {
    const table = formatBuildsTable(
      [artifact({ prunedAt: '2026-06-14T00:00:00.000Z' })].map(readBuildRow),
    );

    expect(table).toContain('pruned');
    expect(table).not.toContain('clean');
  }

  it("labels a pruned row 'pruned' in the TYPE column", labelsAPrunedPiecePrunedInTheTYPEColumn);

  function showsTheRemovedToSaveDiskNoteInsteadOfAPathInTheDetailView() {
    const detail = formatBuildDetail(artifact({ prunedAt: '2026-06-14T09:00:00.000Z' }));

    expect(detail).toContain(
      'pruned 2026-06-14 09:00 - binary removed to save disk; rebuild to ship',
    );
    expect(detail).not.toContain('/home/u/.launch/artifacts/demo-1.0.0-7-ios.ipa');
  }

  it(
    'shows the removed-to-save-disk note instead of a path in the detail view',
    showsTheRemovedToSaveDiskNoteInsteadOfAPathInTheDetailView,
  );
}

describe(
  'pruned builds - history survives, binary is marked gone',
  describePrunedBuildsHistorySurvivesBinaryIsMarkedGone,
);

function describeFormatPrunePreview() {
  const pruned: PrunedArtifact[] = [
    {
      app: 'demo',
      platform: 'ios',
      version: '1.0.0',
      buildNumber: 7,
      bytes: 30 * MB,
      path: '/a/demo-7.ipa',
    },
    {
      app: 'demo',
      platform: 'android',
      version: '1.0.0',
      buildNumber: 4,
      bytes: 22 * MB,
      path: '/a/demo-4.aab',
    },
  ];

  function rendersAHeaderPlusOneAlignedPiecePerRemovedBinary() {
    const [header, first, second] = formatPrunePreview(pruned).split('\n');

    expect(header).toContain('BUILD');
    expect(header).toContain('SIZE');
    expect(first).toContain('ios');
    expect(first).toContain('30.0 MB');
    expect(second).toContain('android');
    expect(second).toContain('22.0 MB');
  }

  it(
    'renders a header plus one aligned row per removed binary',
    rendersAHeaderPlusOneAlignedPiecePerRemovedBinary,
  );
}

describe('formatPrunePreview', describeFormatPrunePreview);

function thrownPruneFailure(daysText: string): unknown {
  try {
    parsePruneDays(daysText);
  } catch (error) {
    return error;
  }

  throw new Error(`expected parsePruneDays(${daysText}) to throw`);
}

function describeParsePruneDays() {
  function acceptsPositiveWholeNumbersAndAbsentOverrides() {
    const pruneDays = parsePruneDays(undefined);
    expect(pruneDays).toBeUndefined();
    expect(parsePruneDays('30')).toBe(30);
  }

  it(
    'accepts positive whole numbers and absent overrides',
    acceptsPositiveWholeNumbersAndAbsentOverrides,
  );

  function rejectsZeroFractionsAndNonNumericPiece() {
    const zero = thrownPruneFailure('0');

    expect(zero).toMatchObject({ message: expect.stringContaining('0') });

    const fraction = thrownPruneFailure('1.5');

    expect(fraction).toMatchObject({ message: expect.stringContaining('1.5') });

    const nonNumeric = thrownPruneFailure('nope');

    expect(nonNumeric).toMatchObject({ message: expect.stringContaining('nope') });

    const empty = thrownPruneFailure('');

    expect(empty).toBeInstanceOf(Error);
    expect(empty).toMatchObject({ message: expect.stringContaining('""') });
  }

  it('rejects zero, fractions, and non-numeric text', rejectsZeroFractionsAndNonNumericPiece);
}

describe('parsePruneDays', describeParsePruneDays);

function describePruneConfirmationBlocked() {
  function allowsInteractiveConfirmationOnlyWhenTTYAndNotPieceYes() {
    expect(pruneConfirmationBlocked({}, true)).toBe(false);
    expect(pruneConfirmationBlocked({ yes: true }, false)).toBe(false);
    expect(pruneConfirmationBlocked({ yes: true, json: true }, false)).toBe(false);
    expect(pruneConfirmationBlocked({}, false)).toBe(true);
    expect(pruneConfirmationBlocked({ json: true }, true)).toBe(true);
  }

  it(
    'allows interactive confirmation only when TTY and not --json/--yes',
    allowsInteractiveConfirmationOnlyWhenTTYAndNotPieceYes,
  );
}

describe('pruneConfirmationBlocked', describePruneConfirmationBlocked);
