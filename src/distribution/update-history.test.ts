import { describe, expect, it } from 'vitest';
import { expectDefined } from '../testkit/assertions-testkit.ts';
import type { CodeSigner } from '../credentials/code-sign.ts';
import type { StorageProvider } from '../types/providers.ts';
import {
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  type UpdateHistoryEntry,
  type UpdateManifest,
} from './ota-manifest.ts';
import {
  activateUpdate,
  clearRollbackDirective,
  deactivateRuntimeVersion,
  findHistoryEntry,
  readHistory,
  recordPublish,
  republishUpdate,
  setRollbackToEmbedded,
} from './update-history.ts';

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

      const bufferBytes = Buffer.from(storedText);
      return Promise.resolve(bufferBytes);
    },
    publicUrl: (objectKey) => `https://cdn/${objectKey}`,
  };
}

const fixedSigner: CodeSigner = {
  certPath: '/tmp/cert.pem',
  sign: () => 'sig="FAKE", keyid="main", alg="rsa-v1_5-sha256"',
};

function makeHistoryEntry(overrides: Partial<UpdateHistoryEntry> = {}): UpdateHistoryEntry {
  return {
    id: 'old-id',
    runtimeVersion: '1.0.0',
    createdAt: '2026-06-13T00:00:00.000Z',
    active: true,
    signed: false,
    kind: 'publish',
    ...overrides,
  };
}

function makeManifest(manifestId: string): UpdateManifest {
  return {
    id: manifestId,
    createdAt: '2026-06-13T00:00:00.000Z',
    runtimeVersion: '1.0.0',
    launchAsset: {
      key: 'bundle.hbc',
      contentType: 'application/javascript',
      url: 'https://cdn/bundle.hbc',
    },
    assets: [],
    metadata: {},
    extra: {},
  };
}

describe('history lookup', () => {
  it('deactivates only active entries for the selected runtime version', () => {
    const historyEntries = [
      makeHistoryEntry({ id: 'one' }),
      makeHistoryEntry({ id: 'two', runtimeVersion: '2.0.0' }),
      makeHistoryEntry({ id: 'three', active: false }),
    ];
    const updatedEntries = deactivateRuntimeVersion(historyEntries, '1.0.0');
    expect(updatedEntries.map((historyEntry) => historyEntry.active)).toEqual([false, true, false]);
  });

  it('resolves latest, exact, and short identifier references', () => {
    const historyEntries = [makeHistoryEntry({ id: 'abcdef' }), makeHistoryEntry({ id: '123456' })];
    const findHistory = findHistoryEntry(historyEntries, 'latest');
    expect(findHistory?.id).toBe('abcdef');
    expect(findHistoryEntry(historyEntries, '123456')?.id).toBe('123456');
    expect(findHistoryEntry(historyEntries, 'abc')?.id).toBe('abcdef');
    expect(findHistoryEntry(historyEntries, 'missing')).toBeUndefined();
  });
});

describe('recordPublish', () => {
  it('prepends the publish and deactivates the previous matching runtime', async () => {
    const storage = makeMemoryStorage();
    const makeHistory = makeHistoryEntry({ id: 'first' });
    await recordPublish(storage, 'production', 'ios', makeHistory);
    await recordPublish(storage, 'production', 'ios', makeHistoryEntry({ id: 'second' }));
    const historyEntries = await readHistory(storage, 'production', 'ios');
    expect(historyEntries.map((historyEntry) => historyEntry.id)).toEqual(['second', 'first']);
    expect(historyEntries.find((historyEntry) => historyEntry.id == 'second')?.active).toBe(true);
    expect(historyEntries.find((historyEntry) => historyEntry.id == 'first')?.active).toBe(false);
  });

  it('keeps active entries for other runtime versions', async () => {
    const storage = makeMemoryStorage();
    const makeHistory = makeHistoryEntry({ id: 'runtime-one' });
    await recordPublish(storage, 'production', 'ios', makeHistory);
    await recordPublish(
      storage,
      'production',
      'ios',
      makeHistoryEntry({ id: 'runtime-two', runtimeVersion: '2.0.0' }),
    );
    const historyEntries = await readHistory(storage, 'production', 'ios');
    expect(historyEntries.every((historyEntry) => historyEntry.active)).toBe(true);
  });

  it('preserves malformed history and refuses to overwrite it', async () => {
    const storage = makeMemoryStorage();
    storage.objects.set('updates/production/ios/history.json', '{broken');
    const makeHistory = makeHistoryEntry();
    const publish = recordPublish(storage, 'production', 'ios', makeHistory);
    await expect(publish).rejects.toThrow();
    expect(storage.objects.get('updates/production/ios/history.json')).toBe('{broken');
  });
});

describe('activateUpdate', () => {
  it('leaves the active manifest untouched when history is malformed', async () => {
    const storage = makeMemoryStorage();
    storage.objects.set('updates/production/ios/history.json', '{broken');
    const manifest = makeManifest('new-id');
    await expect(
      activateUpdate({
        storage,
        channel: 'production',
        platform: 'ios',
        updateManifest: manifest,
        kind: 'publish',
        signer: null,
      }),
    ).rejects.toThrow();
    expect(storage.objects.has(manifestKey('production', 'ios', '1.0.0'))).toBe(false);
  });
});

describe('republishUpdate', () => {
  it('writes a fresh active snapshot, signature, and rollback history entry', async () => {
    const storage = makeMemoryStorage();
    const channel = 'production';
    const platform = 'ios';
    const manifest = makeManifest('old-id');
    const serialized = JSON.stringify(manifest);
    storage.objects.set(historySnapshotKey(channel, platform, '1.0.0', 'old-id'), serialized);
    const makeHistory = makeHistoryEntry({ id: 'old-id' });
    await recordPublish(storage, channel, platform, makeHistory);
    await recordPublish(storage, channel, platform, makeHistoryEntry({ id: 'bad-id' }));

    const republishedUpdate = await republishUpdate({
      storage,
      channel,
      platform,
      target: makeHistoryEntry({ id: 'old-id' }),
      newId: 'rollback-id',
      createdAt: '2026-06-14T12:00:00.000Z',
      signer: fixedSigner,
    });

    expect(republishedUpdate.manifest.id).toBe('rollback-id');
    expect(republishedUpdate.manifest.launchAsset.url).toBe('https://cdn/bundle.hbc');
    expect(republishedUpdate.entry.kind).toBe('rollback');
    const activeManifestText = expectDefined(
      storage.objects.get(manifestKey(channel, platform, '1.0.0')),
      'active manifest',
    );
    const activeManifest = JSON.parse(activeManifestText) as { id: string };
    expect(activeManifest.id).toBe('rollback-id');
    expect(storage.objects.has(historySnapshotKey(channel, platform, '1.0.0', 'rollback-id'))).toBe(
      true,
    );
    expect(storage.objects.get(manifestSignatureKey(channel, platform, '1.0.0'))).toContain(
      'sig="FAKE"',
    );
    const historyEntries = await readHistory(storage, channel, platform);
    expect(historyEntries[0]?.id).toBe('rollback-id');
    expect(historyEntries.find((historyEntry) => historyEntry.id == 'bad-id')?.active).toBe(false);
  });

  it('fails with a typed error when the target snapshot is absent', async () => {
    const storage = makeMemoryStorage();
    const makeHistory = makeHistoryEntry({ id: 'ghost' });
    await expect(
      republishUpdate({
        storage,
        channel: 'production',
        platform: 'ios',
        target: makeHistory,
        newId: 'rollback-id',
        createdAt: '2026-06-14T12:00:00.000Z',
        signer: null,
      }),
    ).rejects.toMatchObject({ _tag: 'UpdateHistoryFailure' });
  });
});

describe('rollback directive', () => {
  it('writes an active signed directive', async () => {
    const storage = makeMemoryStorage();
    await setRollbackToEmbedded({
      storage,
      channel: 'production',
      platform: 'ios',
      runtimeVersion: '1.0.0',
      commitTime: '2026-06-14T12:00:00.000Z',
      signer: fixedSigner,
    });
    const directiveText = expectDefined(
      storage.objects.get(rollbackDirectiveKey('production', 'ios', '1.0.0')),
      'rollback directive',
    );
    const storedDirective = JSON.parse(directiveText) as {
      active: boolean;
      signature: string;
      body: string;
    };
    expect(storedDirective.active).toBe(true);
    expect(storedDirective.signature).toContain('sig="FAKE"');
    const parsed = JSON.parse(storedDirective.body);
    expect(parsed).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-06-14T12:00:00.000Z' },
    });
  });

  it('deactivates an active directive and does nothing when absent', async () => {
    const storage = makeMemoryStorage();
    await clearRollbackDirective(storage, 'production', 'ios', '1.0.0');
    const directiveKey = rollbackDirectiveKey('production', 'ios', '1.0.0');
    expect(storage.objects.has(directiveKey)).toBe(false);

    await setRollbackToEmbedded({
      storage,
      channel: 'production',
      platform: 'ios',
      runtimeVersion: '1.0.0',
      commitTime: '2026-06-14T12:00:00.000Z',
      signer: null,
    });
    await clearRollbackDirective(storage, 'production', 'ios', '1.0.0');
    const clearedText = expectDefined(storage.objects.get(directiveKey), 'cleared directive');
    const clearedDirective = JSON.parse(clearedText) as { active: boolean };
    expect(clearedDirective.active).toBe(false);
  });
});
