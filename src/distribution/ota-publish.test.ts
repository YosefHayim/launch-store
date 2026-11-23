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
    put() {
      return Promise.reject(new Error('unused'));
    },
    list() {
      return Promise.resolve([]);
    },
    url() {
      return Promise.resolve('');
    },
    putObject(objectKey, objectContents) {
      objects.set(objectKey, objectContents.toString());

      return Promise.resolve({ id: objectKey, location: `memory://${objectKey}` });
    },
    getObject(objectKey) {
      const storedText = objects.get(objectKey);

      if (storedText == null) {
        return Promise.resolve(null);
      }

      const bufferBytes = Buffer.from(storedText);

      return Promise.resolve(bufferBytes);
    },
    publicUrl(objectKey) {
      return `https://cdn/${objectKey}`;
    },
  };
}

const fixedSigner: CodeSigner = {
  certPath: '/tmp/cert.pem',
  sign() {
    return 'sig="FAKE", keyid="main", alg="rsa-v1_5-sha256"';
  },
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
function describePublishOtaPlatform() {
  let exportDirectory: string;
  let exportMetadata: ExportMetadata;

  function preparePublishOtaPlatform() {
    const systemTemporaryDirectory = tmpdir();
    const launchOtaPath = join(systemTemporaryDirectory, 'launch-ota-');

    exportDirectory = mkdtempSync(launchOtaPath);

    const bundlePath = join(exportDirectory, 'bundle.js');

    writeFileSync(bundlePath, "console.log('bundle')");

    const logoPath = join(exportDirectory, 'logo.png');

    writeFileSync(logoPath, 'PNGDATA');
    exportMetadata = {
      fileMetadata: {
        ios: {
          bundle: 'bundle.js',
          assets: [{ path: 'logo.png', ext: 'png' }],
        },
      },
    };
  }

  beforeEach(preparePublishOtaPlatform);

  function cleanupPublishOtaPlatform() {
    resetLogger();
    rmSync(exportDirectory, { recursive: true, force: true });
  }

  afterEach(cleanupPublishOtaPlatform);

  async function uploadsAssetsManifestSignatureSnapshotAndHistory() {
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
  }

  it(
    'uploads assets, manifest, signature, snapshot, and history',
    uploadsAssetsManifestSignatureSnapshotAndHistory,
  );

  async function omitsTheSignatureObjectForAnUnsignedPublish() {
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
  }

  it(
    'omits the signature object for an unsigned publish',
    omitsTheSignatureObjectForAnUnsignedPublish,
  );

  async function warnsAndSkipsAPlatformAbsentFromTheExport() {
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
  }

  it(
    'warns and skips a platform absent from the export',
    warnsAndSkipsAPlatformAbsentFromTheExport,
  );
}

describe('publishOtaPlatform', describePublishOtaPlatform);
function describeReadExportMetadata() {
  async function failsWithAnActionableErrorWhenMetadataPieceIsMissing() {
    const systemTemporaryDirectory = tmpdir();
    const launchOtaEmptyPath = join(systemTemporaryDirectory, 'launch-ota-empty-');
    const exportDirectory = mkdtempSync(launchOtaEmptyPath);

    try {
      const exportMetadata = readExportMetadata(exportDirectory);
      await expect(exportMetadata).rejects.toMatchObject({
        _tag: 'OtaPublishFailure',
      });
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  }

  it(
    'fails with an actionable error when metadata.json is missing',
    failsWithAnActionableErrorWhenMetadataPieceIsMissing,
  );

  async function decodesValidExpoExportMetadata() {
    const systemTemporaryDirectory = tmpdir();
    const launchOtaMetaPath = join(systemTemporaryDirectory, 'launch-ota-meta-');
    const exportDirectory = mkdtempSync(launchOtaMetaPath);
    const expectedMetadata: ExportMetadata = {
      fileMetadata: { ios: { bundle: 'bundle.js', assets: [] } },
    };

    try {
      const metadataPath = join(exportDirectory, 'metadata.json');
      const serialized = JSON.stringify(expectedMetadata);

      writeFileSync(metadataPath, serialized);

      const exportMetadata = readExportMetadata(exportDirectory);

      await expect(exportMetadata).resolves.toEqual(expectedMetadata);
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  }

  it('decodes valid Expo export metadata', decodesValidExpoExportMetadata);
}

describe('readExportMetadata', describeReadExportMetadata);
