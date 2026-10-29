import { FileSystem, Path } from '@effect/platform';
import { randomUUID } from 'node:crypto';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from './errorMessage.js';

export type JsonFileFailure = Readonly<{
  readonly _tag: 'JsonFileFailure';
  readonly filePath: string;
  readonly message: string;
  readonly cause: unknown;
}>;

const makeJsonFileFailure = Data.tagged<JsonFileFailure>('JsonFileFailure');

/** Read one JSON file through a schema: null when the file is absent, a failure when it is unreadable. */
export const readJsonFile = <Document>(
  filePath: string,
  documentSchema: Schema.Schema<Document>,
): Effect.Effect<Document | null, JsonFileFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const isFilePresent = yield* fileSystem.exists(filePath);
    if (!isFilePresent) return null;
    const fileText = yield* fileSystem.readFileString(filePath);
    return yield* Schema.decodeUnknown(Schema.parseJson(documentSchema))(fileText);
  }).pipe(
    Effect.mapError((cause) =>
      makeJsonFileFailure({
        filePath,
        message: `Could not read ${filePath}: ${errorMessage(cause)}`,
        cause,
      }),
    ),
  );

/** Write a JSON document through a draft file in the same folder, then rename it over the target. */
export const writeJsonFileAtomically = (
  filePath: string,
  document: unknown,
): Effect.Effect<void, JsonFileFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const folderPath = pathService.dirname(filePath);
    yield* fileSystem.makeDirectory(folderPath, { recursive: true });
    const draftFileId = yield* Effect.sync(() => randomUUID());
    const draftFilePath = `${filePath}.${draftFileId}.draft`;
    yield* fileSystem.writeFileString(draftFilePath, `${JSON.stringify(document, null, 2)}\n`);
    yield* fileSystem.rename(draftFilePath, filePath);
  }).pipe(
    Effect.mapError((cause) =>
      makeJsonFileFailure({
        filePath,
        message: `Could not write ${filePath}: ${errorMessage(cause)}`,
        cause,
      }),
    ),
  );
