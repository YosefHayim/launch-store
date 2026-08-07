import { Data, Effect, Schema } from 'effect';
import type { CodeSigner } from '../credentials/codeSign.js';
import type { StorageProvider } from '../types/providers.js';
import {
  assembleRollbackDirective,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  type StoredRollbackDirective,
  type UpdateHistoryEntry,
  type UpdateManifest,
} from './otaManifest.js';

const ManifestAssetSchema = Schema.mutable(
  Schema.Struct({
    key: Schema.String,
    contentType: Schema.String,
    url: Schema.String,
    fileExtension: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const UpdateManifestSchema: Schema.Schema<UpdateManifest> = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    createdAt: Schema.String,
    runtimeVersion: Schema.String,
    launchAsset: ManifestAssetSchema,
    assets: Schema.mutable(Schema.Array(ManifestAssetSchema)),
    metadata: Schema.Record({ key: Schema.String, value: Schema.Never }),
    extra: Schema.Record({ key: Schema.String, value: Schema.Never }),
  }),
);

const UpdateHistoryEntrySchema: Schema.Schema<UpdateHistoryEntry> = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    runtimeVersion: Schema.String,
    createdAt: Schema.String,
    active: Schema.Boolean,
    signed: Schema.Boolean,
    kind: Schema.Literal('publish', 'rollback'),
  }),
);

const UpdateHistorySchema = Schema.mutable(Schema.Array(UpdateHistoryEntrySchema));

const StoredRollbackDirectiveSchema: Schema.Schema<StoredRollbackDirective> = Schema.mutable(
  Schema.Struct({
    active: Schema.Boolean,
    body: Schema.String,
    signature: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

/** A persisted update snapshot is absent or does not match the manifest contract. */
export type UpdateHistoryFailure = Readonly<{
  readonly _tag: 'UpdateHistoryFailure';
  readonly message: string;
}>;

export const makeUpdateHistoryFailure = Data.tagged<UpdateHistoryFailure>('UpdateHistoryFailure');

/** Decode JSON text with the schema that owns its persisted shape. */
const decodeJson = <DecodedValue, EncodedValue>(
  jsonText: string,
  schema: Schema.Schema<DecodedValue, EncodedValue>,
): Effect.Effect<DecodedValue, unknown> => Schema.decodeUnknown(Schema.parseJson(schema))(jsonText);

/** Read the per-channel platform history, treating absent or malformed state as empty. */
export const readHistory = (
  storage: StorageProvider,
  channel: string,
  platform: string,
): Effect.Effect<UpdateHistoryEntry[], unknown> =>
  Effect.gen(function* () {
    const historyBytes = yield* storage.getObject(historyIndexKey(channel, platform));
    if (historyBytes === null) return [];
    return yield* decodeJson(historyBytes.toString('utf8'), UpdateHistorySchema).pipe(
      Effect.orElseSucceed(() => []),
    );
  });

/** Clear the active flag for entries with one runtime version. */
export const deactivateRuntimeVersion = (
  entries: UpdateHistoryEntry[],
  runtimeVersion: string,
): UpdateHistoryEntry[] =>
  entries.map((entry) => {
    if (entry.runtimeVersion !== runtimeVersion) return entry;
    if (!entry.active) return entry;
    return { ...entry, active: false };
  });

/** Find the newest, exact, or short-prefix history entry named by a CLI reference. */
export const findHistoryEntry = <HistoryEntry extends UpdateHistoryEntry>(
  entries: HistoryEntry[],
  reference: string,
): HistoryEntry | undefined => {
  if (reference === 'latest') return entries[0];
  const exactEntry = entries.find((entry) => entry.id === reference);
  if (exactEntry !== undefined) return exactEntry;
  return entries.find((entry) => entry.id.startsWith(reference));
};

/** Persist the complete history index as readable JSON. */
const writeHistory = (
  storage: StorageProvider,
  channel: string,
  platform: string,
  entries: readonly UpdateHistoryEntry[],
): Effect.Effect<void, unknown> =>
  storage
    .putObject(
      historyIndexKey(channel, platform),
      JSON.stringify(entries, null, 2),
      'application/json',
    )
    .pipe(Effect.asVoid);

/** Make a newly published entry active and prepend it to history. */
export const recordPublish = (
  storage: StorageProvider,
  channel: string,
  platform: string,
  entry: UpdateHistoryEntry,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const existingHistory = yield* readHistory(storage, channel, platform);
    const updatedHistory = deactivateRuntimeVersion(existingHistory, entry.runtimeVersion);
    yield* writeHistory(storage, channel, platform, [entry, ...updatedHistory]);
  });

/** Deactivate the rollback-to-embedded directive for one runtime version. */
export const clearRollbackDirective = (
  storage: StorageProvider,
  channel: string,
  platform: string,
  runtimeVersion: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const directiveKey = rollbackDirectiveKey(channel, platform, runtimeVersion);
    const directiveBytes = yield* storage.getObject(directiveKey);
    if (directiveBytes === null) return;

    const storedDirective = yield* decodeJson(
      directiveBytes.toString('utf8'),
      StoredRollbackDirectiveSchema,
    ).pipe(Effect.option);
    if (storedDirective._tag === 'Some' && !storedDirective.value.active) return;

    const clearedDirective: StoredRollbackDirective = { active: false, body: '' };
    yield* storage.putObject(
      directiveKey,
      JSON.stringify(clearedDirective, null, 2),
      'application/json',
    );
  });

/** Write the active manifest, its immutable snapshot, and optional signature. */
export const writeActiveManifest = (
  storage: StorageProvider,
  channel: string,
  platform: string,
  updateManifest: UpdateManifest,
  signer: CodeSigner | null,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const manifestText = JSON.stringify(updateManifest);
    yield* storage.putObject(
      manifestKey(channel, platform, updateManifest.runtimeVersion),
      manifestText,
      'application/json',
    );
    yield* storage.putObject(
      historySnapshotKey(channel, platform, updateManifest.runtimeVersion, updateManifest.id),
      manifestText,
      'application/json',
    );
    if (signer === null) return;
    yield* storage.putObject(
      manifestSignatureKey(channel, platform, updateManifest.runtimeVersion),
      signer.sign(manifestText),
      'text/plain',
    );
  });

export type ActivateUpdateInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly updateManifest: UpdateManifest;
  readonly kind: UpdateHistoryEntry['kind'];
  readonly signer: CodeSigner | null;
}>;

/**
 * Persist the active manifest + snapshot, record history, and clear any rollback-to-embedded
 * directive. Shared by first publish and snapshot republish.
 */
export const activateUpdate = (
  input: ActivateUpdateInput,
): Effect.Effect<UpdateHistoryEntry, unknown> =>
  Effect.gen(function* () {
    const { storage, channel, platform, updateManifest, kind, signer } = input;
    yield* writeActiveManifest(storage, channel, platform, updateManifest, signer);
    const historyEntry: UpdateHistoryEntry = {
      id: updateManifest.id,
      runtimeVersion: updateManifest.runtimeVersion,
      createdAt: updateManifest.createdAt,
      active: true,
      signed: signer !== null,
      kind,
    };
    yield* recordPublish(storage, channel, platform, historyEntry);
    yield* clearRollbackDirective(storage, channel, platform, updateManifest.runtimeVersion);
    return historyEntry;
  });

export type RepublishUpdateInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly target: UpdateHistoryEntry;
  readonly newId: string;
  readonly createdAt: string;
  readonly signer: CodeSigner | null;
}>;

/** Outcome of republishing an immutable snapshot as the active update. */
export type RepublishedUpdate = Readonly<{
  readonly manifest: UpdateManifest;
  readonly entry: UpdateHistoryEntry;
}>;

/** Republish an immutable snapshot as the active rollback update. */
export const republishUpdate = (
  input: RepublishUpdateInput,
): Effect.Effect<RepublishedUpdate, unknown> =>
  Effect.gen(function* () {
    const { storage, channel, platform, target, newId, createdAt, signer } = input;
    const snapshotKey = historySnapshotKey(channel, platform, target.runtimeVersion, target.id);
    const snapshotBytes = yield* storage.getObject(snapshotKey);
    if (snapshotBytes === null) {
      return yield* Effect.fail(
        makeUpdateHistoryFailure({
          message: `No snapshot for update ${target.id} (runtime ${target.runtimeVersion}).`,
        }),
      );
    }

    const previousManifest = yield* decodeJson(
      snapshotBytes.toString('utf8'),
      UpdateManifestSchema,
    ).pipe(
      Effect.mapError(() =>
        makeUpdateHistoryFailure({
          message: `Snapshot for update ${target.id} is malformed.`,
        }),
      ),
    );
    const updateManifest: UpdateManifest = {
      ...previousManifest,
      id: newId,
      createdAt,
    };
    const historyEntry = yield* activateUpdate({
      storage,
      channel,
      platform,
      updateManifest,
      kind: 'rollback',
      signer,
    });
    return { manifest: updateManifest, entry: historyEntry };
  });

export type SetRollbackToEmbeddedInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly commitTime: string;
  readonly signer: CodeSigner | null;
}>;

/** Publish a rollback directive that sends clients to the embedded bundle. */
export const setRollbackToEmbedded = (
  input: SetRollbackToEmbeddedInput,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const { storage, channel, platform, runtimeVersion, commitTime, signer } = input;
    const directiveText = JSON.stringify(assembleRollbackDirective(commitTime));
    let storedDirective: StoredRollbackDirective = {
      active: true,
      body: directiveText,
    };
    if (signer !== null) {
      storedDirective = {
        ...storedDirective,
        signature: signer.sign(directiveText),
      };
    }

    yield* storage.putObject(
      rollbackDirectiveKey(channel, platform, runtimeVersion),
      JSON.stringify(storedDirective, null, 2),
      'application/json',
    );
  });
