import { describe, expect, it } from 'vitest';
import type { BuildArtifact, PrunedArtifact } from '../types/artifacts.js';
import {
  buildId,
  buildKindLabel,
  buildsLabel,
  filterBuilds,
  findBuild,
  formatBuildDetail,
  formatBuildsTable,
  formatPrunePreview,
  makeBuildHistoryCommandFailure,
  parsePruneDays,
  pruneConfirmationBlocked,
  toBuildRow,
} from './buildHistoryCommand.js';

const MB = 1024 * 1024;

/** A stored-build fixture; override any field to vary one dimension under test. */
const artifact = (overrides: Partial<BuildArtifact> = {}): BuildArtifact => ({
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
});

describe('buildId - stable, provider-independent id from natural keys', () => {
  it('joins app, version, build number, and platform', () => {
    expect(buildId(artifact())).toBe('demo-1.0.0-7-ios');
  });

  it('ignores the storage path and file extension', () => {
    expect(buildId(artifact({ path: '/elsewhere/whatever.aab' }))).toBe('demo-1.0.0-7-ios');
  });
});

describe('toBuildRow', () => {
  it('derives the worst-case download from the per-device entries', () => {
    const tableRow = toBuildRow(
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
  });
});

describe('filterBuilds', () => {
  const ios = artifact({ appName: 'demo', platform: 'ios' });
  const android = artifact({ appName: 'demo', platform: 'android', path: '/a/demo.aab' });
  const other = artifact({ appName: 'other', platform: 'ios' });
  const all = [ios, android, other];

  it('returns everything when no filter is set', () => {
    expect(filterBuilds(all, {})).toEqual(all);
  });

  it('filters by app', () => {
    expect(filterBuilds(all, { app: 'demo' })).toEqual([ios, android]);
  });

  it('filters by platform', () => {
    expect(filterBuilds(all, { platform: 'android' })).toEqual([android]);
  });

  it('filters by app and platform together', () => {
    expect(filterBuilds(all, { app: 'demo', platform: 'ios' })).toEqual([ios]);
  });
});

describe('findBuild', () => {
  const newest = artifact({ buildNumber: 9, version: '1.1.0' });
  const older = artifact({ buildNumber: 7, version: '1.0.0' });
  const history = [newest, older];

  it('resolves `latest` to the newest build', () => {
    expect(findBuild(history, 'latest')).toBe(newest);
  });

  it('matches a full build id', () => {
    expect(findBuild(history, 'demo-1.0.0-7-ios')).toBe(older);
  });

  it('matches a bare build number', () => {
    expect(findBuild(history, '9')).toBe(newest);
  });

  it('returns undefined on a miss', () => {
    expect(findBuild(history, 'nope')).toBeUndefined();
  });

  it('returns undefined for `latest` against an empty history', () => {
    expect(findBuild([], 'latest')).toBeUndefined();
  });
});

describe('buildKindLabel / buildsLabel', () => {
  it('labels pruned, clean, and incremental builds', () => {
    expect(buildKindLabel({ clean: true, prunedAt: '2026-06-14T00:00:00.000Z' })).toBe('pruned');
    expect(buildKindLabel({ clean: true })).toBe('clean');
    expect(buildKindLabel({ clean: false })).toBe('incremental');
  });

  it('pluralizes build counts for prune and list summaries', () => {
    expect(buildsLabel(0)).toBe('0 builds');
    expect(buildsLabel(1)).toBe('1 build');
    expect(buildsLabel(3)).toBe('3 builds');
  });
});

describe('formatBuildsTable', () => {
  it('renders a header plus one aligned row per build', () => {
    const table = formatBuildsTable([artifact()].map(toBuildRow));
    const [header, tableRow] = table.split('\n');
    expect(header).toContain('BUILD');
    expect(header).toContain('DOWNLOAD');
    expect(header).toContain('TYPE');
    expect(tableRow).toContain('demo');
    expect(tableRow).toContain('38.0 MB');
    expect(tableRow).toContain('2026-06-13 14:02');
    expect(tableRow).toContain('clean');
  });

  it('labels an incremental build', () => {
    const table = formatBuildsTable([artifact({ clean: false })].map(toBuildRow));
    expect(table).toContain('incremental');
  });
});

describe('formatBuildDetail', () => {
  it('shows both size numbers and the per-device breakdown', () => {
    const detail = formatBuildDetail(artifact());
    expect(detail).toContain('demo 1.0.0 (build 7) - ios');
    expect(detail).toContain('download 38.0 MB - on disk 61.0 MB');
    expect(detail).toContain('iPhone15,2');
    expect(detail).toContain('install 92.0 MB');
    expect(detail).toContain('demo-1.0.0-7-ios');
  });

  it('omits the per-device block when there is no thinning report', () => {
    const detail = formatBuildDetail(
      artifact({ sizeReport: { artifactBytes: 61 * MB, entries: [] } }),
    );
    expect(detail).not.toContain('download / install');
    expect(detail).toContain('on disk 61.0 MB (no per-device estimate)');
  });
});

describe('pruned builds - history survives, binary is marked gone', () => {
  it('carries prunedAt onto the row only when set', () => {
    expect(toBuildRow(artifact()).prunedAt).toBeUndefined();
    expect(toBuildRow(artifact({ prunedAt: '2026-06-14T00:00:00.000Z' })).prunedAt).toBe(
      '2026-06-14T00:00:00.000Z',
    );
  });

  it("labels a pruned row 'pruned' in the TYPE column", () => {
    const table = formatBuildsTable(
      [artifact({ prunedAt: '2026-06-14T00:00:00.000Z' })].map(toBuildRow),
    );
    expect(table).toContain('pruned');
    expect(table).not.toContain('clean');
  });

  it('shows the removed-to-save-disk note instead of a path in the detail view', () => {
    const detail = formatBuildDetail(artifact({ prunedAt: '2026-06-14T09:00:00.000Z' }));
    expect(detail).toContain(
      'pruned 2026-06-14 09:00 - binary removed to save disk; rebuild to ship',
    );
    expect(detail).not.toContain('/home/u/.launch/artifacts/demo-1.0.0-7-ios.ipa');
  });
});

describe('formatPrunePreview', () => {
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

  it('renders a header plus one aligned row per removed binary', () => {
    const [header, first, second] = formatPrunePreview(pruned).split('\n');
    expect(header).toContain('BUILD');
    expect(header).toContain('SIZE');
    expect(first).toContain('ios');
    expect(first).toContain('30.0 MB');
    expect(second).toContain('android');
    expect(second).toContain('22.0 MB');
  });
});

function thrownPruneFailure(daysText: string): unknown {
  try {
    parsePruneDays(daysText);
  } catch (error) {
    return error;
  }

  throw new Error(`expected parsePruneDays(${daysText}) to throw`);
}

describe('parsePruneDays', () => {
  it('accepts positive whole numbers and absent overrides', () => {
    expect(parsePruneDays(undefined)).toBeUndefined();
    expect(parsePruneDays('30')).toBe(30);
  });

  it('rejects zero, fractions, and non-numeric text', () => {
    const zero = thrownPruneFailure('0');
    expect(zero).toMatchObject({ operation: 'parse prune retention' });
    expect(zero).toMatchObject({ message: expect.stringContaining('0') });
    const fraction = thrownPruneFailure('1.5');
    expect(fraction).toMatchObject({ message: expect.stringContaining('1.5') });
    const nonNumeric = thrownPruneFailure('nope');
    expect(nonNumeric).toMatchObject({ message: expect.stringContaining('nope') });
    const empty = thrownPruneFailure('');
    expect(empty).toMatchObject({ _tag: 'BuildHistoryCommandFailure' });
  });
});

describe('pruneConfirmationBlocked', () => {
  it('allows interactive confirmation only when TTY and not --json/--yes', () => {
    expect(pruneConfirmationBlocked({}, true)).toBe(false);
    expect(pruneConfirmationBlocked({ yes: true }, false)).toBe(false);
    expect(pruneConfirmationBlocked({ yes: true, json: true }, false)).toBe(false);
    expect(pruneConfirmationBlocked({}, false)).toBe(true);
    expect(pruneConfirmationBlocked({ json: true }, true)).toBe(true);
  });
});

describe('makeBuildHistoryCommandFailure', () => {
  it('tags command failures for the Effect channel', () => {
    const failure = makeBuildHistoryCommandFailure({
      operation: 'read build history',
      message: 'disk full',
      cause: new Error('disk full'),
    });
    expect(failure._tag).toBe('BuildHistoryCommandFailure');
    expect(failure.operation).toBe('read build history');
    expect(failure.message).toBe('disk full');
  });
});
