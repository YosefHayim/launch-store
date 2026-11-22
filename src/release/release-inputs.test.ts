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
    const releaseType = resolveReleaseType(undefined, {});
    expect(releaseType).toEqual({ releaseType: 'AFTER_APPROVAL' });
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
    const releaseType = resolveReleaseType(undefined, { scheduled: '2026-08-01T12:00:00Z' });
    expect(releaseType).toEqual({
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
    const releaseType = resolveReleaseType(undefined, {
      scheduled: '2026-08-01T12:00:00Z',
      manual: true,
    });
    expect(releaseType).toEqual({
      releaseType: 'SCHEDULED',
      earliestReleaseDate: '2026-08-01T12:00:00Z',
    });
  });
});

describe('resolveReleaseNotes - config notes -> per-locale map', () => {
  it('returns {} when no notes are configured', () => {
    const releaseNotes = resolveReleaseNotes(undefined, 'en-US');
    expect(releaseNotes).toEqual({});
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
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);

    const storeReleaseNotes = await readStoreReleaseNotes(appDirectory);
    expect(storeReleaseNotes).toEqual({});
  });

  it("reads each locale's releaseNotes and skips locales without them", async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);
    const storePath = join(appDirectory, 'store.config.json');
    const serialized = JSON.stringify({
      apple: {
        info: { 'en-US': { releaseNotes: 'Hello' }, 'de-DE': { title: 'no notes here' } },
      },
    });
    writeFileSync(storePath, serialized);

    const storeReleaseNotes = await readStoreReleaseNotes(appDirectory);
    expect(storeReleaseNotes).toEqual({ 'en-US': 'Hello' });
  });
});

describe('resolveWhatsNew - store.config.json overrides release.releaseNotes per locale', () => {
  it('merges both sources, store.config.json winning for a shared locale', async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);
    const storePath = join(appDirectory, 'store.config.json');
    const serialized = JSON.stringify({
      apple: { info: { 'en-US': { releaseNotes: 'From the store config' } } },
    });
    writeFileSync(storePath, serialized);

    const merged = await resolveWhatsNew(
      { releaseNotes: { 'en-US': 'From launch.config', 'fr-FR': 'Config only' } },
      appDirectory,
    );

    expect(merged).toEqual({ 'en-US': 'From the store config', 'fr-FR': 'Config only' });
  });

  it("falls back to release.releaseNotes when there's no store.config.json", async () => {
    const systemTemporaryDirectory = tmpdir();
    const launchReleasePath = join(systemTemporaryDirectory, 'launch-release-');
    const appDirectory = mkdtempSync(launchReleasePath);

    const whatsNew = await resolveWhatsNew({ releaseNotes: 'Just the config.' }, appDirectory);
    expect(whatsNew).toEqual({
      'en-US': 'Just the config.',
    });
  });
});
