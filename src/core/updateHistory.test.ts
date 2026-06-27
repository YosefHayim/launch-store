import { describe, expect, it } from 'vitest';
import type { StorageProvider } from './types.js';
import type { CodeSigner } from './codeSign.js';
import type { UpdateHistoryEntry, UpdateManifest } from './otaManifest.js';
import {
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
} from './otaManifest.js';
import {
  clearRollbackDirective,
  deactivateRuntimeVersion,
  findHistoryEntry,
  readHistory,
  recordPublish,
  republishUpdate,
  setRollbackToEmbedded,
} from './updateHistory.js';

/** An in-memory {@link StorageProvider} so the history orchestration is testable without a real bucket. */
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

/** A signer that returns a fixed, recognizable header so signature wiring is assertable. */
const fakeSigner: CodeSigner = {
  certPath: '/tmp/cert.pem',
  sign: () => 'sig="FAKE", keyid="main", alg="rsa-v1_5-sha256"',
};

function entry(over: Partial<UpdateHistoryEntry> = {}): UpdateHistoryEntry {
  return {
    id: 'old-id',
    runtimeVersion: '1.0.0',
    createdAt: '2026-06-13T00:00:00.000Z',
    active: true,
    signed: true,
    kind: 'publish',
    ...over,
  };
}

function manifest(id: string): UpdateManifest {
  return {
    id,
    createdAt: '2026-06-13T00:00:00.000Z',
    runtimeVersion: '1.0.0',
    launchAsset: {
      key: 'bundle',
      contentType: 'application/javascript',
      url: 'https://cdn/bundle.hbc',
    },
    assets: [
      { key: 'logo', contentType: 'image/png', url: 'https://cdn/logo.png', fileExtension: '.png' },
    ],
    metadata: {},
    extra: {},
  };
}

describe('deactivateRuntimeVersion', () => {
  it('clears active only on the matching runtime version', () => {
    const result = deactivateRuntimeVersion(
      [
        entry({ id: 'a', runtimeVersion: '1.0.0', active: true }),
        entry({ id: 'b', runtimeVersion: '2.0.0', active: true }),
      ],
      '1.0.0',
    );
    expect(result.find((e) => e.id === 'a')?.active).toBe(false);
    expect(result.find((e) => e.id === 'b')?.active).toBe(true);
  });
});

describe('findHistoryEntry', () => {
  const entries = [entry({ id: 'newest-abc' }), entry({ id: 'older-def' })];
  it('resolves latest, exact id, and a short prefix', () => {
    expect(findHistoryEntry(entries, 'latest')?.id).toBe('newest-abc');
    expect(findHistoryEntry(entries, 'older-def')?.id).toBe('older-def');
    expect(findHistoryEntry(entries, 'newest')?.id).toBe('newest-abc');
    expect(findHistoryEntry(entries, 'nope')).toBeUndefined();
  });
});

describe('recordPublish', () => {
  it('prepends the new update and deactivates the prior one for the same runtime version', async () => {
    const storage = fakeStorage();
    await recordPublish(storage, 'production', 'ios', entry({ id: 'first', active: true }));
    await recordPublish(storage, 'production', 'ios', entry({ id: 'second', active: true }));
    const history = await readHistory(storage, 'production', 'ios');
    expect(history.map((e) => e.id)).toEqual(['second', 'first']);
    expect(history.find((e) => e.id === 'second')?.active).toBe(true);
    expect(history.find((e) => e.id === 'first')?.active).toBe(false);
  });

  it("keeps a different runtime version's active update untouched", async () => {
    const storage = fakeStorage();
    await recordPublish(
      storage,
      'production',
      'ios',
      entry({ id: 'rtv1', runtimeVersion: '1.0.0' }),
    );
    await recordPublish(
      storage,
      'production',
      'ios',
      entry({ id: 'rtv2', runtimeVersion: '2.0.0' }),
    );
    const history = await readHistory(storage, 'production', 'ios');
    expect(history.find((e) => e.id === 'rtv1')?.active).toBe(true);
    expect(history.find((e) => e.id === 'rtv2')?.active).toBe(true);
  });
});

describe('republishUpdate', () => {
  it('writes a fresh active manifest + snapshot + signed sig and records a rollback entry', async () => {
    const storage = fakeStorage();
    const channel = 'production';
    const platform = 'ios';
    await storage.putObject(
      historySnapshotKey(channel, platform, '1.0.0', 'old-id'),
      JSON.stringify(manifest('old-id')),
      'application/json',
    );
    await recordPublish(storage, channel, platform, entry({ id: 'old-id', active: true }));
    // a newer, currently-active update sits on top
    await storage.putObject(
      historySnapshotKey(channel, platform, '1.0.0', 'bad-id'),
      JSON.stringify(manifest('bad-id')),
      'application/json',
    );
    await recordPublish(storage, channel, platform, entry({ id: 'bad-id', active: true }));

    const { manifest: republished, entry: created } = await republishUpdate({
      storage,
      channel,
      platform,
      target: entry({ id: 'old-id' }),
      newId: 'rollback-id',
      createdAt: '2026-06-14T12:00:00.000Z',
      signer: fakeSigner,
    });

    expect(republished.id).toBe('rollback-id');
    expect(republished.createdAt).toBe('2026-06-14T12:00:00.000Z');
    expect(republished.launchAsset.url).toBe('https://cdn/bundle.hbc'); // assets carried over from the snapshot

    const active = JSON.parse(
      storage.objects.get(manifestKey(channel, platform, '1.0.0'))!,
    ) as UpdateManifest;
    expect(active.id).toBe('rollback-id');
    expect(storage.objects.has(historySnapshotKey(channel, platform, '1.0.0', 'rollback-id'))).toBe(
      true,
    );
    expect(storage.objects.get(manifestSignatureKey(channel, platform, '1.0.0'))).toContain(
      'sig="FAKE"',
    );

    expect(created.kind).toBe('rollback');
    const history = await readHistory(storage, channel, platform);
    expect(history[0]?.id).toBe('rollback-id');
    expect(history[0]?.active).toBe(true);
    expect(history.find((e) => e.id === 'bad-id')?.active).toBe(false);
  });

  it('throws when the target snapshot is missing', async () => {
    const storage = fakeStorage();
    await expect(
      republishUpdate({
        storage,
        channel: 'production',
        platform: 'ios',
        target: entry({ id: 'ghost' }),
        newId: 'x',
        createdAt: '2026-06-14T12:00:00.000Z',
        signer: null,
      }),
    ).rejects.toThrow(/No snapshot/);
  });
});

describe('rollback directive', () => {
  it('writes an active, signed rollBackToEmbedded directive served verbatim', async () => {
    const storage = fakeStorage();
    await setRollbackToEmbedded({
      storage,
      channel: 'production',
      platform: 'ios',
      runtimeVersion: '1.0.0',
      commitTime: '2026-06-14T12:00:00.000Z',
      signer: fakeSigner,
    });
    const stored = JSON.parse(
      storage.objects.get(rollbackDirectiveKey('production', 'ios', '1.0.0'))!,
    );
    expect(stored.active).toBe(true);
    expect(stored.signature).toContain('sig="FAKE"');
    expect(JSON.parse(stored.body)).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-06-14T12:00:00.000Z' },
    });
  });

  it('clearRollbackDirective deactivates an active directive and no-ops when absent', async () => {
    const storage = fakeStorage();
    await clearRollbackDirective(storage, 'production', 'ios', '1.0.0'); // absent → no write
    expect(storage.objects.has(rollbackDirectiveKey('production', 'ios', '1.0.0'))).toBe(false);

    await setRollbackToEmbedded({
      storage,
      channel: 'production',
      platform: 'ios',
      runtimeVersion: '1.0.0',
      commitTime: '2026-06-14T12:00:00.000Z',
      signer: null,
    });
    await clearRollbackDirective(storage, 'production', 'ios', '1.0.0');
    const cleared = JSON.parse(
      storage.objects.get(rollbackDirectiveKey('production', 'ios', '1.0.0'))!,
    );
    expect(cleared.active).toBe(false);
  });
});
