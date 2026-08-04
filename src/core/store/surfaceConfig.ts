import { FileSystem } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';

const JsonObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

/** A store-surface JSON document could not be read or decoded. */
export type StoreSurfaceConfigFailure = Readonly<{
  readonly _tag: 'StoreSurfaceConfigFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeStoreSurfaceConfigFailure = Data.tagged<StoreSurfaceConfigFailure>(
  'StoreSurfaceConfigFailure',
);

type StoreSurfaceConfigSpec<StoreSurfaceConfig, EncodedConfig> = Readonly<{
  documentName: string;
  displayName: string;
  missingMessage: (configPath: string) => string;
  schema: Schema.Schema<StoreSurfaceConfig, EncodedConfig>;
}>;

const surfaceConfigFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): StoreSurfaceConfigFailure => {
  let message = explicitMessage;
  if (message === undefined) message = errorMessage(cause);
  return makeStoreSurfaceConfigFailure({ operation, message, cause });
};

/** Decode one untrusted store-surface document with its domain schema. */
export const decodeStoreSurfaceConfig = <StoreSurfaceConfig, EncodedConfig>(
  rawDocument: unknown,
  configSpec: StoreSurfaceConfigSpec<StoreSurfaceConfig, EncodedConfig>,
): Effect.Effect<StoreSurfaceConfig, StoreSurfaceConfigFailure> =>
  Effect.gen(function* () {
    const objectDocument = yield* Schema.decodeUnknown(JsonObjectSchema)(rawDocument).pipe(
      Effect.mapError((cause) =>
        surfaceConfigFailure(
          `decode ${configSpec.displayName} document`,
          cause,
          `${configSpec.documentName} must be a JSON object.`,
        ),
      ),
    );
    return yield* Schema.decodeUnknown(configSpec.schema)(objectDocument).pipe(
      Effect.mapError((cause) =>
        surfaceConfigFailure(`decode ${configSpec.displayName} fields`, cause, errorMessage(cause)),
      ),
    );
  });

/** Read and decode one store-surface JSON sidecar through Effect Platform. */
export const loadStoreSurfaceConfig = <StoreSurfaceConfig, EncodedConfig>(
  configPath: string,
  configSpec: StoreSurfaceConfigSpec<StoreSurfaceConfig, EncodedConfig>,
): Effect.Effect<StoreSurfaceConfig, StoreSurfaceConfigFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(
        Effect.mapError((cause) =>
          surfaceConfigFailure(`inspect ${configSpec.displayName}`, cause),
        ),
      );
    if (!configExists) {
      return yield* Effect.fail(
        surfaceConfigFailure(
          `read ${configSpec.displayName}`,
          configPath,
          configSpec.missingMessage(configPath),
        ),
      );
    }
    const configSource = yield* fileSystem
      .readFileString(configPath)
      .pipe(
        Effect.mapError((cause) => surfaceConfigFailure(`read ${configSpec.displayName}`, cause)),
      );
    const rawDocument = yield* Schema.decodeUnknown(Schema.parseJson())(configSource).pipe(
      Effect.mapError((cause) =>
        surfaceConfigFailure(
          `parse ${configSpec.displayName} JSON`,
          cause,
          `Invalid JSON in ${configPath}.`,
        ),
      ),
    );
    return yield* decodeStoreSurfaceConfig(rawDocument, configSpec);
  });
