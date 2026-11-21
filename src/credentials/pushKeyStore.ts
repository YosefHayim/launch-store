import { FileSystem } from '@effect/platform';
import { Clock, Effect, Schema } from 'effect';
import type { Path } from '@effect/platform';
import {
  resolveLaunchHomeDirectory,
  resolvePushKeysFilePath,
  type LaunchPathsService,
} from '../services/platform/paths.js';
import { getSecret, setSecret } from './storedSecret.js';
import { decodeP8, encodeP8 } from './accounts.js';
import type { LaunchSecretStoreService } from '../services/credentials/secretStore.js';
import type { MutableDeep } from '../types/mutable.js';

/**
 * One imported APNs authentication key (`.p8`) in Launch's push-key vault (`~/.launch/push-keys.json`).
 *
 * An APNs auth key is how a backend sends push notifications to your app. Unlike the App Store Connect
 * key, Apple exposes NO API to create one - it's a download-once, portal-only key (Certificates, IDs &
 * Profiles -> Keys), capped at 2 per account - so Launch can only *import* and safeguard a key you've
 * already downloaded, never mint one. Launch never *uses* these keys (push is a backend/runtime concern);
 * the vault exists so a download-once secret isn't lost. This record is non-secret metadata only - the
 * `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`. An APNs key is team-wide, not per-app.
 */
type ApnsKeyRecord = Readonly<{
  keyId: string;
  teamId?: string;
  label?: string;
  importedAt: string;
}>;

/** Secret-store account holding one APNs key's `.p8` PEM, namespaced by Key ID. */
const apnsAccount = (keyId: string): string => {
  return `apns-p8:${keyId}`;
};
/** ISO-8601 stamp for `importedAt`. */
const currentTimestamp = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((epochMilliseconds) => new Date(epochMilliseconds).toISOString()),
  );
const ApnsKeyRecordSchema: Schema.Schema<ApnsKeyRecord> = Schema.mutable(
  Schema.Struct({
    keyId: Schema.String,
    teamId: Schema.optionalWith(Schema.String, { exact: true }),
    label: Schema.optionalWith(Schema.String, { exact: true }),
    importedAt: Schema.String,
  }),
);
const PushKeyFileSchema = Schema.Struct({
  keys: Schema.mutable(Schema.Array(ApnsKeyRecordSchema)),
});
type PushKeyStorageRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;
/** Read the vault index, returning an empty list when the file is absent or malformed. */
export const listPushKeys = (): Effect.Effect<
  readonly ApnsKeyRecord[],
  never,
  PushKeyStorageRequirements
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pushKeysFilePath = yield* resolvePushKeysFilePath();
    const indexExists = yield* fileSystem
      .exists(pushKeysFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!indexExists) return [];
    return yield* fileSystem.readFileString(pushKeysFilePath).pipe(
      Effect.flatMap((indexText) => Effect.try(() => JSON.parse(indexText))),
      Effect.flatMap(Schema.decodeUnknown(PushKeyFileSchema)),
      Effect.map((pushKeyFile) => pushKeyFile.keys),
      Effect.orElseSucceed(() => []),
    );
  });
/** Write the vault index back to disk (pretty-printed; non-secret metadata only). */
const writePushKeys = (
  keys: readonly ApnsKeyRecord[],
): Effect.Effect<void, unknown, PushKeyStorageRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const launchHomeDirectory = yield* resolveLaunchHomeDirectory();
    const pushKeysFilePath = yield* resolvePushKeysFilePath();
    yield* fileSystem.makeDirectory(launchHomeDirectory, { recursive: true });
    yield* fileSystem.writeFileString(pushKeysFilePath, JSON.stringify({ keys }, null, 2));
  });
/** Find a vaulted key by Key ID, case-insensitively (Apple's Key IDs are upper-case). */
export const findPushKey = (
  keyId: string,
): Effect.Effect<ApnsKeyRecord | undefined, never, PushKeyStorageRequirements> =>
  Effect.gen(function* () {
    const needle = keyId.trim().toLowerCase();
    const pushKeys = yield* listPushKeys();
    return pushKeys.find((pushKey) => pushKey.keyId.toLowerCase() === needle);
  });
/** Inputs to {@link importPushKey}. */
type ImportPushKeyInput = {
  keyId: string;
  p8: string;
  teamId?: string;
  label?: string;
};
/**
 * Import (or replace) an APNs key: the `.p8` goes to the OS secret store, the metadata to the vault
 * index. Re-importing an existing Key ID updates it in place (keeping its original `importedAt`), so
 * re-importing with a new label or team never creates a duplicate.
 */
export const importPushKey = (
  input: ImportPushKeyInput,
): Effect.Effect<ApnsKeyRecord, unknown, LaunchSecretStoreService | PushKeyStorageRequirements> =>
  Effect.gen(function* () {
    yield* setSecret(apnsAccount(input.keyId), encodeP8(input.p8));
    const keys = yield* listPushKeys();
    const existing = keys.find((key) => key.keyId === input.keyId);
    const timestamp = yield* currentTimestamp();
    let importedAt = existing?.importedAt;
    if (importedAt === undefined) importedAt = timestamp;
    const record: MutableDeep<ApnsKeyRecord> = {
      keyId: input.keyId,
      importedAt,
    };
    if (input.teamId !== undefined) record.teamId = input.teamId;
    if (input.label !== undefined) record.label = input.label;
    let storedKeys = [...keys, record];
    if (existing) {
      storedKeys = keys.map((key) => {
        if (key.keyId === input.keyId) return record;
        return key;
      });
    }
    yield* writePushKeys(storedKeys);
    return record;
  });
/** Load one APNs key's `.p8` PEM from the secret store, or null if absent - the export path. */
export const loadPushKey = (
  keyId: string,
): Effect.Effect<string | null, unknown, LaunchSecretStoreService> =>
  Effect.gen(function* () {
    const stored = yield* getSecret(apnsAccount(keyId));
    if (stored) return decodeP8(stored);
    return null;
  });
