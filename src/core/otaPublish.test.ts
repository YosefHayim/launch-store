import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from './types.js';
import type { CodeSigner } from './codeSign.js';
import { createLogger } from './logger.js';
import {
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
} from './otaManifest.js';
import { publishOtaPlatform, readExportMetadata, type ExportMetadata } from './otaPublish.js';

/** An in-memory {@link StorageProvider} so the publish path is testable without a real bucket. */
function fakeStorage(): StorageProvider & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    name: 'fake',
    put: () => Promise.reject(new Error('unused')),
    list: () => Promise.resolve([]),
    url: () => Promise.resolve(''),
    putObject: (key, body) => {
      objects.set(key, body.toString());
      return Promise.resolve({ id: key, location: `mem://${key}` });
    },
    getObject: (key) => {
      const value = objects.get(key);
      return Promise.resolve(value === undefined ? null : Buffer.from(value));
    },
    publicUrl: (key) => `https://cdn/${key}`,
  };
}

const fakeSigner: CodeSigner = {
  certPath: '/tmp/cert.pem',
  sign: () => 'sig="FAKE", keyid="main", alg="rsa-v1_5-sha256"',
};

const log = createLogger(false);

describe('publishOtaPlatform', () => {
  let distDir: string;
  let metadata: ExportMetadata;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), 'launch-ota-'));
    writeFileSync(join(distDir, 'bundle.js'), "console.log('bundle')");
    writeFileSync(join(distDir, 'logo.png'), 'PNGDATA');
    metadata = {
      fileMetadata: { ios: { bundle: 'bundle.js', assets: [{ path: 'logo.png', ext: 'png' }] } },
    };
  });
  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  it('uploads bundle, manifest, snapshot, and history; signs when a signer is given', async () => {
    const storage = fakeStorage();
    const result = await publishOtaPlatform(
      {
        storage,
        distDir,
        metadata,
        platform: 'ios',
        channel: 'production',
        runtimeVersion: '1.0.0',
        signer: fakeSigner,
      },
      log,
    );

    expect(result.published).toBe(true);
    expect(result.assetCount).toBe(1);
    expect(result.prefix).toBe('updates/production/ios/1.0.0');
    expect(result.manifestId).toBeTruthy();

    const keys = [...storage.objects.keys()];
    expect(keys).toContain('updates/production/ios/1.0.0/bundle.js');
    expect(keys).toContain('updates/production/ios/1.0.0/logo.png');
    expect(keys).toContain(manifestKey('production', 'ios', '1.0.0'));
    expect(keys).toContain(manifestSignatureKey('production', 'ios', '1.0.0'));
    expect(keys).toContain(
      historySnapshotKey('production', 'ios', '1.0.0', result.manifestId ?? ''),
    );

    const history = JSON.parse(
      storage.objects.get(historyIndexKey('production', 'ios')) ?? '[]',
    ) as {
      signed: boolean;
    }[];
    expect(history).toHaveLength(1);
    expect(history[0]?.signed).toBe(true);
  });

  it('publishes unsigned (no signature object) when signer is null', async () => {
    const storage = fakeStorage();
    await publishOtaPlatform(
      {
        storage,
        distDir,
        metadata,
        platform: 'ios',
        channel: 'production',
        runtimeVersion: '1.0.0',
        signer: null,
      },
      log,
    );
    expect([...storage.objects.keys()]).not.toContain(
      manifestSignatureKey('production', 'ios', '1.0.0'),
    );
  });

  it('skips (published: false) and never writes when the export has no bundle for the platform', async () => {
    const storage = fakeStorage();
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const result = await publishOtaPlatform(
      {
        storage,
        distDir,
        metadata,
        platform: 'android',
        channel: 'production',
        runtimeVersion: '1.0.0',
        signer: fakeSigner,
      },
      log,
    );
    expect(result.published).toBe(false);
    expect(storage.objects.size).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('readExportMetadata', () => {
  it('throws an actionable error when metadata.json is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-ota-empty-'));
    try {
      expect(() => readExportMetadata(dir)).toThrow(/metadata\.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses a valid metadata.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-ota-meta-'));
    try {
      writeFileSync(join(dir, 'metadata.json'), JSON.stringify(metadataFixture()));
      expect(readExportMetadata(dir)).toEqual(metadataFixture());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function metadataFixture(): ExportMetadata {
  return { fileMetadata: { ios: { bundle: 'b.js', assets: [] } } };
}
