import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CodeSigner } from '../credentials/codeSign.js';
import { createLogger, makeLaunchLoggerTest } from '../services/logger.js';
import type { StorageProvider } from '../types/providers.js';
import {
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
} from './otaManifest.js';
import { type ExportMetadata, publishOtaPlatform, readExportMetadata } from './otaPublish.js';

type MemoryStorage = StorageProvider &
  Readonly<{
    readonly objects: Map<string, string>;
  }>;

/** Build an in-memory object store with Effect-returning provider methods. */
const makeMemoryStorage = (): MemoryStorage => {
  const objects = new Map<string, string>();
  return {
    objects,
    name: 'memory',
    put: () => Effect.dieMessage('unused'),
    list: () => Effect.succeed([]),
    url: () => Effect.succeed(''),
    putObject: (objectKey, objectContents) =>
      Effect.sync(() => {
        objects.set(objectKey, objectContents.toString());
        return { id: objectKey, location: `memory://${objectKey}` };
      }),
    getObject: (objectKey) =>
      Effect.sync(() => {
        const storedText = objects.get(objectKey);
        if (storedText === undefined) return null;
        return Buffer.from(storedText);
      }),
    publicUrl: (objectKey) => `https://cdn/${objectKey}`,
  };
};

const fixedSigner: CodeSigner = {
  certPath: '/tmp/cert.pem',
  sign: () => 'sig="FAKE", keyid="main", alg="rsa-v1_5-sha256"',
};

/** Run an OTA publish with platform services and a captured test logger. */
const runPublish = (
  input: Parameters<typeof publishOtaPlatform>[0],
  terminalWrites: string[] = [],
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const logger = yield* createLogger(false);
      return yield* publishOtaPlatform(input, logger);
    }).pipe(
      Effect.provide(makeLaunchLoggerTest(terminalWrites)),
      Effect.provide(NodeContext.layer),
    ),
  );

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
    if (manifestId === undefined) throw new Error('Expected a manifest identifier');
    const objectKeys = [...storage.objects.keys()];
    expect(objectKeys).toContain('updates/production/ios/1.0.0/bundle.js');
    expect(objectKeys).toContain('updates/production/ios/1.0.0/logo.png');
    expect(objectKeys).toContain(manifestKey('production', 'ios', '1.0.0'));
    expect(objectKeys).toContain(manifestSignatureKey('production', 'ios', '1.0.0'));
    expect(objectKeys).toContain(historySnapshotKey('production', 'ios', '1.0.0', manifestId));

    const historyText = storage.objects.get(historyIndexKey('production', 'ios'));
    if (historyText === undefined) throw new Error('Expected an update history index');
    const historyEntries = Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ signed: Schema.Boolean })),
    )(JSON.parse(historyText));
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
      const metadataRead = await Effect.runPromise(
        readExportMetadata(exportDirectory).pipe(Effect.either, Effect.provide(NodeContext.layer)),
      );
      expect(metadataRead).toMatchObject({
        _tag: 'Left',
        left: { _tag: 'OtaPublishFailure' },
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
      const parsedMetadata = await Effect.runPromise(
        readExportMetadata(exportDirectory).pipe(Effect.provide(NodeContext.layer)),
      );
      expect(parsedMetadata).toEqual(expectedMetadata);
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  });
});
