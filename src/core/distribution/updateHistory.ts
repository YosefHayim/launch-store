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
): Effect.Effect<DecodedValue, unknown> =>
  Effect.try(() => JSON.parse(jsonText)).pipe(Effect.flatMap(Schema.decodeUnknown(schema)));

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
  entries: UpdateHistoryEntry[],
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

export type RepublishUpdateInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly target: UpdateHistoryEntry;
  readonly newId: string;
  readonly createdAt: string;
  readonly signer: CodeSigner | null;
}>;

/** Republish an immutable snapshot as the active rollback update. */
export const republishUpdate = (
  input: RepublishUpdateInput,
): Effect.Effect<{ manifest: UpdateManifest; entry: UpdateHistoryEntry }, unknown> =>
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
    const manifest: UpdateManifest = { ...previousManifest, id: newId, createdAt };
    const manifestText = JSON.stringify(manifest);

    yield* storage.putObject(
      manifestKey(channel, platform, target.runtimeVersion),
      manifestText,
      'application/json',
    );
    yield* storage.putObject(
      historySnapshotKey(channel, platform, target.runtimeVersion, newId),
      manifestText,
      'application/json',
    );
    if (signer !== null) {
      yield* storage.putObject(
        manifestSignatureKey(channel, platform, target.runtimeVersion),
        signer.sign(manifestText),
        'text/plain',
      );
    }

    const historyEntry: UpdateHistoryEntry = {
      id: newId,
      runtimeVersion: target.runtimeVersion,
      createdAt,
      active: true,
      signed: signer !== null,
      kind: 'rollback',
    };
    yield* recordPublish(storage, channel, platform, historyEntry);
    yield* clearRollbackDirective(storage, channel, platform, target.runtimeVersion);
    return { manifest, entry: historyEntry };
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
    const storedDirective: StoredRollbackDirective = {
      active: true,
      body: directiveText,
    };
    if (signer !== null) storedDirective.signature = signer.sign(directiveText);

    yield* storage.putObject(
      rollbackDirectiveKey(channel, platform, runtimeVersion),
      JSON.stringify(storedDirective, null, 2),
      'application/json',
    );
  });
