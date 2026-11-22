import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readStoreReleaseNotes,
  resolveReleaseNotes,
  resolveReleaseType,
  resolveWhatsNew,
} from './release-inputs.ts';

describe('resolveReleaseType - CLI flags override the configured default', () => {
  it('defaults to AFTER_APPROVAL with no config and no overrides', () => {
    expect(resolveReleaseType(undefined, {})).toEqual({ releaseType: 'AFTER_APPROVAL' });
  });

  it('passes the configured releaseType and earliestReleaseDate through', () => {
    expect(
      resolveReleaseType(
        { releaseType: 'SCHEDULED', earliestReleaseDate: '2026-07-01T00:00:00Z' },
        {},
      ),
    ).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-07-01T00:00:00Z',
    });
  });

  it('--scheduled forces SCHEDULED at the given instant', () => {
    expect(resolveReleaseType(undefined, { scheduled: '2026-08-01T12:00:00Z' })).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T12:00:00Z',
    });
  });

  it('--manual forces MANUAL', () => {
    expect(resolveReleaseType({ releaseType: 'AFTER_APPROVAL' }, { manual: true })).toEqual({
      releaseType: 'MANUAL',
    });
  });

  it('--scheduled beats --manual when both are set', () => {
    expect(
      resolveReleaseType(undefined, { scheduled: '2026-08-01T12:00:00Z', manual: true }),
    ).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T12:00:00Z',
    });
  });
});

describe('resolveReleaseNotes - config notes -> per-locale map', () => {
  it('returns {} when no notes are configured', () => {
    expect(resolveReleaseNotes(undefined, 'en-US')).toEqual({});
  });

  it('targets the primary locale for a bare string', () => {
    expect(resolveReleaseNotes({ releaseNotes: 'Bug fixes.' }, 'en-GB')).toEqual({
      'en-GB': 'Bug fixes.',
    });
  });

  it('passes a per-locale map through unchanged', () => {
    const notes = { 'en-US': 'A', 'fr-FR': 'B' };

    expect(resolveReleaseNotes({ releaseNotes: notes }, 'en-US')).toEqual(notes);
  });
});

describe('readStoreReleaseNotes - per-locale releaseNotes from store.config.json', () => {
  it('returns {} when the app has no store.config.json', async () => {
    const appDirectory = mkdtempSync(join(tmpdir(), 'launch-release-'));

    expect(await readStoreReleaseNotes(appDirectory)).toEqual({});
  });

  it("reads each locale's releaseNotes and skips locales without them", async () => {
    const appDirectory = mkdtempSync(join(tmpdir(), 'launch-release-'));
    writeFileSync(
      join(appDirectory, 'store.config.json'),
      JSON.stringify({
        apple: {
          info: { 'en-US': { releaseNotes: 'Hello' }, 'de-DE': { title: 'no notes here' } },
        },
      }),
    );

    expect(await readStoreReleaseNotes(appDirectory)).toEqual({ 'en-US': 'Hello' });
  });
});

describe('resolveWhatsNew - store.config.json overrides release.releaseNotes per locale', () => {
  it('merges both sources, store.config.json winning for a shared locale', async () => {
    const appDirectory = mkdtempSync(join(tmpdir(), 'launch-release-'));
    writeFileSync(
      join(appDirectory, 'store.config.json'),
      JSON.stringify({ apple: { info: { 'en-US': { releaseNotes: 'From the store config' } } } }),
    );

    const merged = await resolveWhatsNew(
      { releaseNotes: { 'en-US': 'From launch.config', 'fr-FR': 'Config only' } },
      appDirectory,
    );

    expect(merged).toEqual({ 'en-US': 'From the store config', 'fr-FR': 'Config only' });
  });

  it("falls back to release.releaseNotes when there's no store.config.json", async () => {
    const appDirectory = mkdtempSync(join(tmpdir(), 'launch-release-'));

    expect(await resolveWhatsNew({ releaseNotes: 'Just the config.' }, appDirectory)).toEqual({
      'en-US': 'Just the config.',
    });
  });
});
