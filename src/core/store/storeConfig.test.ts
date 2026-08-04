import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import {
  parseStoreConfig,
  readAndroidMetadataDir,
  readAppleMetadataDir,
  writeAndroidMetadataDir,
  writeAppleMetadataDir,
} from './storeConfig.js';
const tmpDirs: string[] = [];
const workDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'storeconfig-test-'));
  tmpDirs.push(dir);
  return dir;
};
const runMetadataRead = <StoreConfiguration>(
  metadataRead: Effect.Effect<
    StoreConfiguration,
    unknown,
    import('@effect/platform/FileSystem').FileSystem | import('@effect/platform/Path').Path
  >,
) => Effect.runPromise(metadataRead.pipe(Effect.provide(NodeContext.layer)));
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
describe('apple metadata folder round-trip (deliver layout)', () => {
  it('writes deliver .txt files and reads them back identically', async () => {
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
    const written = await runMetadataRead(writeAppleMetadataDir(apple, dir));
    // keywords land comma-joined in deliver's keywords.txt; the title goes to name.txt.
    expect(written).toContain(join('en-US', 'name.txt'));
    expect(written).toContain(join('en-US', 'keywords.txt'));
    expect(readFileSync(join(dir, 'en-US', 'keywords.txt'), 'utf8')).toBe('fast, local');
    expect(await runMetadataRead(readAppleMetadataDir(dir))).toEqual(apple);
  });
});
describe('android metadata folder round-trip (supply layout)', () => {
  it('writes supply .txt files and reads them back identically', async () => {
    const android = {
      info: {
        'en-US': { title: 'Hello', shortDescription: 'short', fullDescription: 'the full thing' },
      },
    };
    const dir = workDir();
    const written = await runMetadataRead(writeAndroidMetadataDir(android, dir));
    expect(written).toContain(join('en-US', 'short_description.txt'));
    expect(await runMetadataRead(readAndroidMetadataDir(dir))).toEqual(android);
  });
});
