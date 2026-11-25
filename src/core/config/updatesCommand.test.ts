import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { UpdateManifest } from '../distribution/otaManifest.js';
import {
  formatUpdateDetail,
  formatUpdatesTable,
  platformsForUpdatesFilter,
  shortId,
  type UpdateRow,
} from './updatesCommand.js';

/** Build one history row with concise overrides for each scenario. */
const makeUpdateRow = (overrides: Partial<UpdateRow> = {}): UpdateRow => ({
  id: '1234abcd-5678-90ef-ghij-klmnopqrstuv',
  platform: 'ios',
  runtimeVersion: '1.0.0',
  createdAt: '2026-06-14T09:12:00.000Z',
  active: true,
  signed: true,
  kind: 'publish',
  ...overrides,
});

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

describe('shortId', () => {
  it('abbreviates a UUID to its first eight characters', () => {
    expect(shortId('1234abcd-5678-90ef')).toBe('1234abcd');
  });
});

describe('platformsForUpdatesFilter', () => {
  it('defaults to both platforms when the filter is omitted', async () => {
    const platforms = await Effect.runPromise(platformsForUpdatesFilter(undefined));
    expect(platforms).toEqual(['ios', 'android']);
  });

  it('accepts ios or android alone', async () => {
    expect(await Effect.runPromise(platformsForUpdatesFilter('ios'))).toEqual(['ios']);
    expect(await Effect.runPromise(platformsForUpdatesFilter('android'))).toEqual(['android']);
  });

  it('rejects an unknown platform with a tagged failure', async () => {
    const filterAttempt = await Effect.runPromise(
      platformsForUpdatesFilter('web').pipe(Effect.either),
    );
    expect(filterAttempt).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'UpdatesCommandFailure',
        operation: 'parse update platform',
        message: 'Unknown --platform "web". Use "ios" or "android".',
      },
    });
  });
});

describe('formatUpdatesTable', () => {
  it('renders a header and one row per update with the active marker', () => {
    const table = formatUpdatesTable([
      makeUpdateRow({ id: 'aaaaaaaa-1', active: true, kind: 'publish' }),
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
  });
});

describe('formatUpdateDetail', () => {
  it('includes the bundle URL, asset count, and active/signed labels when present', () => {
    const detail = formatUpdateDetail(makeUpdateRow(), sampleManifest);
    expect(detail).toContain('https://cdn/bundle.hbc');
    expect(detail).toContain('assets:  1');
    expect(detail).toContain('active');
    expect(detail).toContain('signed:  yes');
  });

  it('omits manifest lines and active label when the snapshot and active flag are absent', () => {
    const detail = formatUpdateDetail(makeUpdateRow({ active: false, signed: false }), null);
    expect(detail).not.toContain('bundle:');
    expect(detail).toContain('runtime 1.0.0');
    expect(detail).toContain('signed:  no');
    expect(detail).not.toContain(', active');
  });

  it('labels prior rollback history rows without rewriting their kind', () => {
    const detail = formatUpdateDetail(
      makeUpdateRow({ active: false, kind: 'rollback' }),
      sampleManifest,
    );
    expect(detail).toContain('(rollback)');
    expect(detail).not.toContain(', active');
  });
});
