import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeSigner } from '../credentials/code-sign.ts';
import { createLogger, resetLogger, useLoggerSink } from '../services/platform/logger.ts';
import type { StorageProvider } from '../types/providers.ts';
import {
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
} from './ota-manifest.ts';
import { type ExportMetadata, publishOtaPlatform, readExportMetadata } from './ota-publish.ts';

type MemoryStorage = StorageProvider &
  Readonly<{
    readonly objects: Map<string, string>;
  }>;

function makeMemoryStorage(): MemoryStorage {
  const objects = new Map<string, string>();

  return {
    objects,
    name: 'memory',
    put: () => Promise.reject(new Error('unused')),
    list: () => Promise.resolve([]),
    url: () => Promise.resolve(''),
    putObject: (objectKey, objectContents) => {
      objects.set(objectKey, objectContents.toString());

      return Promise.resolve({ id: objectKey, location: `memory://${objectKey}` });
    },
    getObject: (objectKey) => {
      const storedText = objects.get(objectKey);

      if (storedText == null) {
        return Promise.resolve(null);
      }

      return Promise.resolve(Buffer.from(storedText));
    },
    publicUrl: (objectKey) => `https://cdn/${objectKey}`,
  };
}

const fixedSigner: CodeSigner = {
  certPath: '/tmp/cert.pem',
  sign: () => 'sig="FAKE", keyid="main", alg="rsa-v1_5-sha256"',
};

function runPublish(
  publishInput: Parameters<typeof publishOtaPlatform>[0],
  terminalWrites: string[] = [],
) {
  useLoggerSink(function captureWrite(text: string) {
    terminalWrites.push(text);
  });
  const logger = createLogger(false);

  return publishOtaPlatform(publishInput, logger);
}

describe('publishOtaPlatform', () => {
  let exportDirectory: string;
  let exportMetadata: ExportMetadata;

  beforeEach(() => {
    exportDirectory = mkdtempSync(join(tmpdir(), 'launch-ota-'));
    writeFileSync(join(exportDirectory, 'bundle.js'), "console.log('bundle')");
    writeFileSync(join(exportDirectory, 'logo.png'), 'PNGDATA');
    exportMetadata = {
      fileMetadata: {
        ios: {
          bundle: 'bundle.js',
          assets: [{ path: 'logo.png', ext: 'png' }],
        },
      },
    };
  });

  afterEach(() => {
    resetLogger();
    rmSync(exportDirectory, { recursive: true, force: true });
  });

  it('uploads assets, manifest, signature, snapshot, and history', async () => {
    const storage = makeMemoryStorage();
    const publishDetails = await runPublish({
      storage,
      distDir: exportDirectory,
      metadata: exportMetadata,
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      signer: fixedSigner,
    });

    expect(publishDetails.published).toBe(true);
    expect(publishDetails.assetCount).toBe(1);
    expect(publishDetails.prefix).toBe('updates/production/ios/1.0.0');
    expect(publishDetails.manifestId).toBeDefined();
    const manifestId = publishDetails.manifestId;

    if (manifestId == null) {
      throw new Error('Expected a manifest identifier');
    }

    expect(manifestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const objectKeys = [...storage.objects.keys()];
    expect(objectKeys).toContain('updates/production/ios/1.0.0/bundle.js');
    expect(objectKeys).toContain('updates/production/ios/1.0.0/logo.png');
    expect(objectKeys).toContain(manifestKey('production', 'ios', '1.0.0'));
    expect(objectKeys).toContain(manifestSignatureKey('production', 'ios', '1.0.0'));
    expect(objectKeys).toContain(historySnapshotKey('production', 'ios', '1.0.0', manifestId));

    const historyText = storage.objects.get(historyIndexKey('production', 'ios'));

    if (historyText == null) {
      throw new Error('Expected an update history index');
    }

    const historyEntries = JSON.parse(historyText) as { signed: boolean }[];
    expect(historyEntries).toHaveLength(1);
    expect(historyEntries[0]?.signed).toBe(true);
  });

  it('omits the signature object for an unsigned publish', async () => {
    const storage = makeMemoryStorage();
    await runPublish({
      storage,
      distDir: exportDirectory,
      metadata: exportMetadata,
      platform: 'ios',
      channel: 'production',
      runtimeVersion: '1.0.0',
      signer: null,
    });
    expect([...storage.objects.keys()]).not.toContain(
      manifestSignatureKey('production', 'ios', '1.0.0'),
    );
  });

  it('warns and skips a platform absent from the export', async () => {
    const storage = makeMemoryStorage();
    const terminalWrites: string[] = [];
    const publishDetails = await runPublish(
      {
        storage,
        distDir: exportDirectory,
        metadata: exportMetadata,
        platform: 'android',
        channel: 'production',
        runtimeVersion: '1.0.0',
        signer: fixedSigner,
      },
      terminalWrites,
    );
    expect(publishDetails.published).toBe(false);
    expect(storage.objects.size).toBe(0);
    expect(terminalWrites.join('')).toContain('[WARN] No android bundle');
  });
});

describe('readExportMetadata', () => {
  it('fails with an actionable error when metadata.json is missing', async () => {
    const exportDirectory = mkdtempSync(join(tmpdir(), 'launch-ota-empty-'));

    try {
      await expect(readExportMetadata(exportDirectory)).rejects.toMatchObject({
        _tag: 'OtaPublishFailure',
      });
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  });

  it('decodes valid Expo export metadata', async () => {
    const exportDirectory = mkdtempSync(join(tmpdir(), 'launch-ota-meta-'));
    const expectedMetadata: ExportMetadata = {
      fileMetadata: { ios: { bundle: 'bundle.js', assets: [] } },
    };

    try {
      writeFileSync(join(exportDirectory, 'metadata.json'), JSON.stringify(expectedMetadata));
      await expect(readExportMetadata(exportDirectory)).resolves.toEqual(expectedMetadata);
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  });
});
