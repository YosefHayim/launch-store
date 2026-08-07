import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { resolveAccountCredentialsDirectory, type LaunchPathsService } from '../services/paths.js';

/** Persisted record of the distribution certificate Launch created and backed up. */
export type CertRecord = {
  id: string;
  serial: string;
  p12Path: string;
};

/** Persisted record of one bundle's App Store provisioning profile. */
export type ProfileRecord = {
  id: string;
  uuid: string;
  name: string;
  path: string;
  teamId: string;
};

/** On-disk credential metadata (`~/.launch/credentials/index.json`). No secrets - paths + ids only. */
export type CredentialsIndex = {
  certificate?: CertRecord;
  profiles: Record<string, ProfileRecord>;
};

export type AppleSigningPlatform =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | Path.Path;

const CertRecordSchema: Schema.Schema<CertRecord> = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    serial: Schema.String,
    p12Path: Schema.String,
  }),
);

const ProfileRecordSchema: Schema.Schema<ProfileRecord> = Schema.mutable(
  Schema.Struct({
    id: Schema.String,
    uuid: Schema.String,
    name: Schema.String,
    path: Schema.String,
    teamId: Schema.String,
  }),
);

export const CredentialsIndexSchema: Schema.Schema<CredentialsIndex> = Schema.mutable(
  Schema.Struct({
    certificate: Schema.optionalWith(CertRecordSchema, { exact: true }),
    profiles: Schema.mutable(Schema.Record({ key: Schema.String, value: ProfileRecordSchema })),
  }),
);

export const emptyCredentialsIndex = (): CredentialsIndex => ({ profiles: {} });

export type AppleSigningFailure = Readonly<{
  readonly _tag: 'AppleSigningFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeAppleSigningFailure = Data.tagged<AppleSigningFailure>('AppleSigningFailure');

/** Absolute path to one account's signing index. */
export const indexPath = (
  keyId: string,
): Effect.Effect<string, never, LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    return pathService.join(credentialsDirectory, 'index.json');
  });

/** Read an account's credentials index, tolerating a missing or malformed file. */
export const readIndex = (
  keyId: string,
): Effect.Effect<CredentialsIndex, never, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsIndexPath = yield* indexPath(keyId);
    const indexExists = yield* fileSystem
      .exists(credentialsIndexPath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!indexExists) return emptyCredentialsIndex();
    return yield* fileSystem.readFileString(credentialsIndexPath).pipe(
      Effect.flatMap((indexText) => Effect.try(() => JSON.parse(indexText))),
      Effect.flatMap(Schema.decodeUnknown(CredentialsIndexSchema)),
      Effect.orElseSucceed(emptyCredentialsIndex),
    );
  });

/** Write an account's credentials index back to disk. */
export const writeIndex = (
  keyId: string,
  credentialsIndex: CredentialsIndex,
): Effect.Effect<void, unknown, FileSystem.FileSystem | LaunchPathsService | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const credentialsDirectory = yield* resolveAccountCredentialsDirectory(keyId);
    yield* fileSystem.makeDirectory(credentialsDirectory, { recursive: true });
    const credentialsIndexPath = yield* indexPath(keyId);
    yield* fileSystem.writeFileString(
      credentialsIndexPath,
      JSON.stringify(credentialsIndex, null, 2),
    );
  });
