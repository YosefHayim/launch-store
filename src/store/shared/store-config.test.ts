import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseStoreConfig, readAndroidMetadataDir, readAppleMetadataDir } from './store-config.ts';
const tmpDirs: string[] = [];
function workDir(): string {
  const systemTemporaryDirectory = tmpdir();
  const storeconfigTestPath = join(systemTemporaryDirectory, 'storeconfig-test-');
  const dir = mkdtempSync(storeconfigTestPath);

  tmpDirs.push(dir);

  return dir;
}
function cleanup() {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterEach(cleanup);
function describeParseStorePiece() {
  function parsesTheExpoAppleSchemaPlusTheAndroidExtension() {
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
  }

  it(
    'parses the Expo apple schema plus the android extension',
    parsesTheExpoAppleSchemaPlusTheAndroidExtension,
  );

  function rejectsANonObjectDocument() {
    function callParseStorePiece() {
      return parseStoreConfig('nope');
    }

    expect(callParseStorePiece).toThrow(/must be a JSON object/);
  }

  it('rejects a non-object document', rejectsANonObjectDocument);

  function rejectsADocumentWithNeitherPlatformSection() {
    function callParseStorePiece2() {
      return parseStoreConfig({ configVersion: 0 });
    }

    expect(callParseStorePiece2).toThrow(/neither/);
  }

  it(
    'rejects a document with neither platform section',
    rejectsADocumentWithNeitherPlatformSection,
  );

  function rejectsANonStringListingFieldAtTheSchemaBoundary() {
    function callParseStorePiece3() {
      return parseStoreConfig({
        apple: { info: { 'en-US': { title: 'Hello', subtitle: 42 } } },
      });
    }

    expect(callParseStorePiece3).toThrow(/subtitle/);
  }

  it(
    'rejects a non-string listing field at the schema boundary',
    rejectsANonStringListingFieldAtTheSchemaBoundary,
  );
}

describe('parseStoreConfig', describeParseStorePiece);
function writeMetadataFiles(dir: string, files: Record<string, string>): void {
  for (const [relativePath, text] of Object.entries(files)) {
    const joinedPath = join(dir, relativePath);
    const parentDirectory = dirname(joinedPath);
    mkdirSync(parentDirectory, { recursive: true });
    writeFileSync(join(dir, relativePath), text);
  }
}
function describeAppleMetadataFolderReadDeliverLayout() {
  async function readsDeliverTxtFilesIntoTheAppleSection() {
    const dir = workDir();
    const namePath = join('en-US', 'name.txt');
    const subtitlePath = join('en-US', 'subtitle.txt');
    const descriptionPath = join('en-US', 'description.txt');
    const keywordsPath = join('en-US', 'keywords.txt');
    const releaseNotesPath = join('en-US', 'release_notes.txt');
    const privacyUrlPath = join('en-US', 'privacy_url.txt');
    const supportUrlPath = join('en-US', 'support_url.txt');

    writeMetadataFiles(dir, {
      [namePath]: 'Hello',
      [subtitlePath]: 'Sub',
      [descriptionPath]: 'A great app',
      [keywordsPath]: 'fast, local',
      [releaseNotesPath]: 'First release',
      [privacyUrlPath]: 'https://example.com/privacy',
      [supportUrlPath]: '   ',
    });

    const appleMetadataDir = await readAppleMetadataDir(dir);

    expect(appleMetadataDir).toEqual({
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
  }

  it('reads deliver .txt files into the apple section', readsDeliverTxtFilesIntoTheAppleSection);
}

describe(
  'apple metadata folder read (deliver layout)',
  describeAppleMetadataFolderReadDeliverLayout,
);
function describeAndroidMetadataFolderReadSupplyLayout() {
  async function readsSupplyTxtFilesIntoTheAndroidSection() {
    const dir = workDir();
    const titlePath = join('en-US', 'title.txt');
    const shortDescriptionPath = join('en-US', 'short_description.txt');
    const fullDescriptionPath = join('en-US', 'full_description.txt');

    writeMetadataFiles(dir, {
      [titlePath]: 'Hello',
      [shortDescriptionPath]: 'short',
      [fullDescriptionPath]: 'the full thing',
    });

    const androidMetadataDir = await readAndroidMetadataDir(dir);

    expect(androidMetadataDir).toEqual({
      info: {
        'en-US': { title: 'Hello', shortDescription: 'short', fullDescription: 'the full thing' },
      },
    });
  }

  it('reads supply .txt files into the android section', readsSupplyTxtFilesIntoTheAndroidSection);
}

describe(
  'android metadata folder read (supply layout)',
  describeAndroidMetadataFolderReadSupplyLayout,
);
