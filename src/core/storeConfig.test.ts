import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseStoreConfig,
  readAndroidMetadataDir,
  readAppleMetadataDir,
  writeAndroidMetadataDir,
  writeAppleMetadataDir,
} from './storeConfig.js';

const tmpDirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'storeconfig-test-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseStoreConfig', () => {
  it('parses the Expo apple schema plus the android extension', () => {
    const config = parseStoreConfig({
      configVersion: 0,
      apple: {
        info: { 'en-US': { title: 'Hello', keywords: ['a', 'b'], description: 'Desc' } },
        categories: ['PRODUCTIVITY'],
      },
      android: { info: { 'en-US': { title: 'Hello', shortDescription: 'short' } } },
    });
    expect(config.apple?.info['en-US']).toEqual({
      title: 'Hello',
      keywords: ['a', 'b'],
      description: 'Desc',
    });
    expect(config.apple?.categories).toEqual(['PRODUCTIVITY']);
    expect(config.android?.info['en-US']).toEqual({ title: 'Hello', shortDescription: 'short' });
  });

  it('rejects a non-object document', () => {
    expect(() => parseStoreConfig('nope')).toThrow(/must be a JSON object/);
  });

  it('rejects a document with neither platform section', () => {
    expect(() => parseStoreConfig({ configVersion: 0 })).toThrow(
      /neither an "apple" nor an "android"/,
    );
  });

  it('drops undefined/non-string fields rather than emitting key: undefined', () => {
    const config = parseStoreConfig({
      apple: { info: { 'en-US': { title: 'Hello', subtitle: 42 } } },
    });
    expect(config.apple?.info['en-US']).toEqual({ title: 'Hello' });
    expect('subtitle' in config.apple!.info['en-US']!).toBe(false);
  });
});

describe('apple metadata folder round-trip (deliver layout)', () => {
  it('writes deliver .txt files and reads them back identically', () => {
    const apple = {
      info: {
        'en-US': {
          title: 'Hello',
          subtitle: 'Sub',
          description: 'A great app',
          keywords: ['fast', 'local'],
          releaseNotes: 'First release',
          privacyPolicyUrl: 'https://example.com/privacy',
        },
      },
    };
    const dir = workDir();
    const written = writeAppleMetadataDir(apple, dir);

    // keywords land comma-joined in deliver's keywords.txt; the title goes to name.txt.
    expect(written).toContain(join('en-US', 'name.txt'));
    expect(written).toContain(join('en-US', 'keywords.txt'));
    expect(readFileSync(join(dir, 'en-US', 'keywords.txt'), 'utf8')).toBe('fast, local');

    expect(readAppleMetadataDir(dir)).toEqual(apple);
  });
});

describe('android metadata folder round-trip (supply layout)', () => {
  it('writes supply .txt files and reads them back identically', () => {
    const android = {
      info: {
        'en-US': { title: 'Hello', shortDescription: 'short', fullDescription: 'the full thing' },
      },
    };
    const dir = workDir();
    const written = writeAndroidMetadataDir(android, dir);
    expect(written).toContain(join('en-US', 'short_description.txt'));
    expect(readAndroidMetadataDir(dir)).toEqual(android);
  });
});
