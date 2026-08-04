import { FileSystem, type Path } from '@effect/platform';
import { Effect, Schema } from 'effect';
import type { HostHandle } from '../types/remote.js';
import {
  resolveCloudStateFilePath,
  resolveLaunchHomeDirectory,
  type LaunchPathsService,
} from '../services/paths.js';

export type CloudState = {
  host?: HostHandle;
  amiId?: string;
};

const SshTargetSchema = Schema.mutable(
  Schema.Struct({
    host: Schema.String,
    user: Schema.String,
    port: Schema.Number,
    identityFile: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
const HostHandleSchema: Schema.Schema<HostHandle> = Schema.mutable(
  Schema.Struct({
    provider: Schema.String,
    ssh: SshTargetSchema,
    allocatedAt: Schema.String,
    instanceId: Schema.optionalWith(Schema.String, { exact: true }),
    hostId: Schema.optionalWith(Schema.String, { exact: true }),
    region: Schema.optionalWith(Schema.String, { exact: true }),
    instanceType: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
const CloudStateSchema: Schema.Schema<CloudState> = Schema.mutable(
  Schema.Struct({
    host: Schema.optionalWith(HostHandleSchema, { exact: true }),
    amiId: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
type CloudStateRequirements = FileSystem.FileSystem | LaunchPathsService | Path.Path;

/** Reads cloud state, treating absent or malformed state as empty. */
export const readCloudState = (): Effect.Effect<CloudState, never, CloudStateRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const cloudStateFilePath = yield* resolveCloudStateFilePath();
    const stateExists = yield* fileSystem
      .exists(cloudStateFilePath)
      .pipe(Effect.orElseSucceed(() => false));
    if (!stateExists) return {};
    return yield* fileSystem.readFileString(cloudStateFilePath).pipe(
      Effect.flatMap((stateText) => Effect.try(() => JSON.parse(stateText))),
      Effect.flatMap(Schema.decodeUnknown(CloudStateSchema)),
      Effect.orElseSucceed(() => ({})),
    );
  });

/** Writes cloud state with owner-only permissions. */
export const writeCloudState = (
  cloudState: CloudState,
): Effect.Effect<void, unknown, CloudStateRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const launchHomeDirectory = yield* resolveLaunchHomeDirectory();
    const cloudStateFilePath = yield* resolveCloudStateFilePath();
    yield* fileSystem.makeDirectory(launchHomeDirectory, { recursive: true });
    yield* fileSystem.writeFileString(cloudStateFilePath, JSON.stringify(cloudState, null, 2));
    yield* fileSystem.chmod(cloudStateFilePath, 0o600);
  });

/** Reads the live remote host handle. */
export const getLiveHost = (): Effect.Effect<HostHandle | null, never, CloudStateRequirements> =>
  readCloudState().pipe(
    Effect.map((cloudState) => {
      if (cloudState.host === undefined) return null;
      return cloudState.host;
    }),
  );

/** Records a newly allocated remote host. */
export const setLiveHost = (
  hostHandle: HostHandle,
): Effect.Effect<void, unknown, CloudStateRequirements> =>
  Effect.gen(function* () {
    const cloudState = yield* readCloudState();
    yield* writeCloudState({ ...cloudState, host: hostHandle });
  });

/** Clears the live host while preserving a reusable AMI. */
export const clearLiveHost = (): Effect.Effect<void, unknown, CloudStateRequirements> =>
  Effect.gen(function* () {
    const cloudState = yield* readCloudState();
    if (cloudState.amiId === undefined) {
      yield* writeCloudState({});
      return;
    }
    yield* writeCloudState({ amiId: cloudState.amiId });
  });

/** Reads the cached golden AMI identifier. */
export const getAmiId = (): Effect.Effect<string | null, never, CloudStateRequirements> =>
  readCloudState().pipe(
    Effect.map((cloudState) => {
      if (cloudState.amiId === undefined) return null;
      return cloudState.amiId;
    }),
  );

/** Records the reusable golden AMI identifier. */
export const setAmiId = (amiId: string): Effect.Effect<void, unknown, CloudStateRequirements> =>
  Effect.gen(function* () {
    const cloudState = yield* readCloudState();
    yield* writeCloudState({ ...cloudState, amiId });
  });
