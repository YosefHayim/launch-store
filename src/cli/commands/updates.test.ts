import { describe, expect, it } from 'vitest';
import type { UpdateManifest } from '../../core/otaManifest.js';
import { formatUpdateDetail, formatUpdatesTable, shortId, type UpdateRow } from './updates.js';

function row(over: Partial<UpdateRow> = {}): UpdateRow {
  return {
    id: '1234abcd-5678-90ef-ghij-klmnopqrstuv',
    platform: 'ios',
    runtimeVersion: '1.0.0',
    createdAt: '2026-06-14T09:12:00.000Z',
    active: true,
    signed: true,
    kind: 'publish',
    ...over,
  };
}

describe('shortId', () => {
  it('abbreviates a UUID to its first segment', () => {
    expect(shortId('1234abcd-5678-90ef')).toBe('1234abcd');
  });
});

describe('formatUpdatesTable', () => {
  it('renders a header and one row per update with the active marker', () => {
    const table = formatUpdatesTable([
      row({ id: 'aaaaaaaa-1', active: true, kind: 'publish' }),
      row({
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
    expect(first).toContain('yes'); // active
    expect(second).toContain('android');
    expect(second).toContain('rollback');
    expect(second).toContain('2.0.0');
  });
});

describe('formatUpdateDetail', () => {
  const manifest: UpdateManifest = {
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

  it('includes the bundle URL and asset count when the snapshot is present', () => {
    const detail = formatUpdateDetail(row(), manifest);
    expect(detail).toContain('https://cdn/bundle.hbc');
    expect(detail).toContain('assets:  1');
    expect(detail).toContain('active');
  });

  it('omits manifest lines when the snapshot is missing', () => {
    const detail = formatUpdateDetail(row({ active: false }), null);
    expect(detail).not.toContain('bundle:');
    expect(detail).toContain('runtime 1.0.0');
  });
});
