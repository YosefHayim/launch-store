import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { expectDefined } from '@testkit/assertions.testkit.js';
import type { CodeSigner } from '../credentials/codeSign.js';
import type { StorageProvider } from '../types/providers.js';
import {
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  type UpdateHistoryEntry,
  type UpdateManifest,
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

/** Build a history entry with concise overrides for each scenario. */
const makeHistoryEntry = (overrides: Partial<UpdateHistoryEntry> = {}): UpdateHistoryEntry => ({
  id: 'old-id',
  runtimeVersion: '1.0.0',
  createdAt: '2026-06-13T00:00:00.000Z',
  active: true,
  signed: false,
  kind: 'publish',
  ...overrides,
});

/** Build a persisted manifest snapshot for rollback tests. */
const makeManifest = (manifestId: string): UpdateManifest => ({
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
});

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
    expect(findHistoryEntry(historyEntries, 'latest')?.id).toBe('abcdef');
    expect(findHistoryEntry(historyEntries, '123456')?.id).toBe('123456');
    expect(findHistoryEntry(historyEntries, 'abc')?.id).toBe('abcdef');
    expect(findHistoryEntry(historyEntries, 'missing')).toBeUndefined();
  });
});

describe('recordPublish', () => {
  it('prepends the publish and deactivates the previous matching runtime', async () => {
    const storage = makeMemoryStorage();
    await Effect.runPromise(
      recordPublish(storage, 'production', 'ios', makeHistoryEntry({ id: 'first' })),
    );
    await Effect.runPromise(
      recordPublish(storage, 'production', 'ios', makeHistoryEntry({ id: 'second' })),
    );
    const historyEntries = await Effect.runPromise(readHistory(storage, 'production', 'ios'));
    expect(historyEntries.map((historyEntry) => historyEntry.id)).toEqual(['second', 'first']);
    expect(historyEntries.find((historyEntry) => historyEntry.id === 'second')?.active).toBe(true);
    expect(historyEntries.find((historyEntry) => historyEntry.id === 'first')?.active).toBe(false);
  });

  it('keeps active entries for other runtime versions', async () => {
    const storage = makeMemoryStorage();
    await Effect.runPromise(
      recordPublish(storage, 'production', 'ios', makeHistoryEntry({ id: 'runtime-one' })),
    );
    await Effect.runPromise(
      recordPublish(
        storage,
        'production',
        'ios',
        makeHistoryEntry({ id: 'runtime-two', runtimeVersion: '2.0.0' }),
      ),
    );
    const historyEntries = await Effect.runPromise(readHistory(storage, 'production', 'ios'));
    expect(historyEntries.every((historyEntry) => historyEntry.active)).toBe(true);
  });

  it('treats malformed history as empty', async () => {
    const storage = makeMemoryStorage();
    storage.objects.set('updates/production/ios/history.json', '{broken');
    const historyEntries = await Effect.runPromise(readHistory(storage, 'production', 'ios'));
    expect(historyEntries).toEqual([]);
  });
});

describe('republishUpdate', () => {
  it('writes a fresh active snapshot, signature, and rollback history entry', async () => {
    const storage = makeMemoryStorage();
    const channel = 'production';
    const platform = 'ios';
    storage.objects.set(
      historySnapshotKey(channel, platform, '1.0.0', 'old-id'),
      JSON.stringify(makeManifest('old-id')),
    );
    await Effect.runPromise(
      recordPublish(storage, channel, platform, makeHistoryEntry({ id: 'old-id' })),
    );
    await Effect.runPromise(
      recordPublish(storage, channel, platform, makeHistoryEntry({ id: 'bad-id' })),
    );

    const republishedUpdate = await Effect.runPromise(
      republishUpdate({
        storage,
        channel,
        platform,
        target: makeHistoryEntry({ id: 'old-id' }),
        newId: 'rollback-id',
        createdAt: '2026-06-14T12:00:00.000Z',
        signer: fixedSigner,
      }),
    );

    expect(republishedUpdate.manifest.id).toBe('rollback-id');
    expect(republishedUpdate.manifest.launchAsset.url).toBe('https://cdn/bundle.hbc');
    expect(republishedUpdate.entry.kind).toBe('rollback');
    const activeManifestText = expectDefined(
      storage.objects.get(manifestKey(channel, platform, '1.0.0')),
      'active manifest',
    );
    const activeManifest = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String }))(
      JSON.parse(activeManifestText),
    );
    expect(activeManifest.id).toBe('rollback-id');
    expect(storage.objects.has(historySnapshotKey(channel, platform, '1.0.0', 'rollback-id'))).toBe(
      true,
    );
    expect(storage.objects.get(manifestSignatureKey(channel, platform, '1.0.0'))).toContain(
      'sig="FAKE"',
    );
    const historyEntries = await Effect.runPromise(readHistory(storage, channel, platform));
    expect(historyEntries[0]?.id).toBe('rollback-id');
    expect(historyEntries.find((historyEntry) => historyEntry.id === 'bad-id')?.active).toBe(false);
  });

  it('fails with a typed error when the target snapshot is absent', async () => {
    const storage = makeMemoryStorage();
    const republishAttempt = await Effect.runPromise(
      republishUpdate({
        storage,
        channel: 'production',
        platform: 'ios',
        target: makeHistoryEntry({ id: 'ghost' }),
        newId: 'rollback-id',
        createdAt: '2026-06-14T12:00:00.000Z',
        signer: null,
      }).pipe(Effect.either),
    );
    expect(republishAttempt).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'UpdateHistoryFailure' },
    });
  });
});

describe('rollback directive', () => {
  it('writes an active signed directive', async () => {
    const storage = makeMemoryStorage();
    await Effect.runPromise(
      setRollbackToEmbedded({
        storage,
        channel: 'production',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        commitTime: '2026-06-14T12:00:00.000Z',
        signer: fixedSigner,
      }),
    );
    const directiveText = expectDefined(
      storage.objects.get(rollbackDirectiveKey('production', 'ios', '1.0.0')),
      'rollback directive',
    );
    const storedDirective = Schema.decodeUnknownSync(
      Schema.Struct({
        active: Schema.Boolean,
        signature: Schema.String,
        body: Schema.String,
      }),
    )(JSON.parse(directiveText));
    expect(storedDirective.active).toBe(true);
    expect(storedDirective.signature).toContain('sig="FAKE"');
    expect(JSON.parse(storedDirective.body)).toEqual({
      type: 'rollBackToEmbedded',
      parameters: { commitTime: '2026-06-14T12:00:00.000Z' },
    });
  });

  it('deactivates an active directive and does nothing when absent', async () => {
    const storage = makeMemoryStorage();
    await Effect.runPromise(clearRollbackDirective(storage, 'production', 'ios', '1.0.0'));
    const directiveKey = rollbackDirectiveKey('production', 'ios', '1.0.0');
    expect(storage.objects.has(directiveKey)).toBe(false);

    await Effect.runPromise(
      setRollbackToEmbedded({
        storage,
        channel: 'production',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        commitTime: '2026-06-14T12:00:00.000Z',
        signer: null,
      }),
    );
    await Effect.runPromise(clearRollbackDirective(storage, 'production', 'ios', '1.0.0'));
    const clearedText = expectDefined(storage.objects.get(directiveKey), 'cleared directive');
    const clearedDirective = Schema.decodeUnknownSync(Schema.Struct({ active: Schema.Boolean }))(
      JSON.parse(clearedText),
    );
    expect(clearedDirective.active).toBe(false);
  });
});
