import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { runOnNodePlatform } from '@testkit/platformRun.testkit.js';
import { parseStoreConfig, readAndroidMetadataDir, readAppleMetadataDir } from './storeConfig.js';
const tmpDirs: string[] = [];
const workDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'storeconfig-test-'));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe('parseStoreConfig', () => {
  it('parses the Expo apple schema plus the android extension', () => {
    const config = Effect.runSync(
      parseStoreConfig({
        configVersion: 0,
        apple: {
          info: { 'en-US': { title: 'Hello', keywords: ['a', 'b'], description: 'Desc' } },
          categories: ['PRODUCTIVITY'],
        },
        android: { info: { 'en-US': { title: 'Hello', shortDescription: 'short' } } },
      }),
    );
    expect(config.apple?.info['en-US']).toEqual({
      title: 'Hello',
      keywords: ['a', 'b'],
      description: 'Desc',
    });
    expect(config.apple?.categories).toEqual(['PRODUCTIVITY']);
    expect(config.android?.info['en-US']).toEqual({ title: 'Hello', shortDescription: 'short' });
  });
  it('rejects a non-object document', () => {
    expect(() => Effect.runSync(parseStoreConfig('nope'))).toThrow(/must be a JSON object/);
  });
  it('rejects a document with neither platform section', () => {
    expect(() => Effect.runSync(parseStoreConfig({ configVersion: 0 }))).toThrow(/neither/);
  });
  it('rejects a non-string listing field at the schema boundary', () => {
    expect(() =>
      Effect.runSync(
        parseStoreConfig({
          apple: { info: { 'en-US': { title: 'Hello', subtitle: 42 } } },
        }),
      ),
    ).toThrow(/subtitle/);
  });
});
const writeMetadataFiles = (dir: string, files: Record<string, string>): void => {
  for (const [relativePath, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, relativePath)), { recursive: true });
    writeFileSync(join(dir, relativePath), text);
  }
};
describe('apple metadata folder read (deliver layout)', () => {
  it('reads deliver .txt files into the apple section', async () => {
    const dir = workDir();
    writeMetadataFiles(dir, {
      [join('en-US', 'name.txt')]: 'Hello',
      [join('en-US', 'subtitle.txt')]: 'Sub',
      [join('en-US', 'description.txt')]: 'A great app',
      [join('en-US', 'keywords.txt')]: 'fast, local',
      [join('en-US', 'release_notes.txt')]: 'First release',
      [join('en-US', 'privacy_url.txt')]: 'https://example.com/privacy',
      [join('en-US', 'support_url.txt')]: '   ',
    });
    expect(await runOnNodePlatform(readAppleMetadataDir(dir))).toEqual({
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
    });
  });
});
describe('android metadata folder read (supply layout)', () => {
  it('reads supply .txt files into the android section', async () => {
    const dir = workDir();
    writeMetadataFiles(dir, {
      [join('en-US', 'title.txt')]: 'Hello',
      [join('en-US', 'short_description.txt')]: 'short',
      [join('en-US', 'full_description.txt')]: 'the full thing',
    });
    expect(await runOnNodePlatform(readAndroidMetadataDir(dir))).toEqual({
      info: {
        'en-US': { title: 'Hello', shortDescription: 'short', fullDescription: 'the full thing' },
      },
    });
  });
});
