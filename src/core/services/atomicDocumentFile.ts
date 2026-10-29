import { FileSystem, Path } from '@effect/platform';
import { randomUUID } from 'node:crypto';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from './errorMessage.js';

export type DocumentFileFailure = Readonly<{
  readonly _tag: 'DocumentFileFailure';
  readonly filePath: string;
  readonly message: string;
  readonly cause: unknown;
}>;

const makeDocumentFileFailure = Data.tagged<DocumentFileFailure>('DocumentFileFailure');

export const readDocumentFile = <Document>(
  filePath: string,
  documentSchema: Schema.Schema<Document>,
): Effect.Effect<Document | null, DocumentFileFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const isFilePresent = yield* fileSystem.exists(filePath);
    const isFileMissing = !isFilePresent;
    if (isFileMissing) return null;
    const fileAsString = yield* fileSystem.readFileString(filePath);
    const decodeDocument = Schema.decodeUnknown(Schema.parseJson(documentSchema));
    return yield* decodeDocument(fileAsString);
  }).pipe(
    Effect.mapError((cause) =>
      makeDocumentFileFailure({
        filePath,
        message: `Could not read ${filePath}: ${errorMessage(cause)}`,
        cause,
      }),
    ),
  );

export const writeDocumentFileAtomically = (
  filePath: string,
  document: unknown,
): Effect.Effect<void, DocumentFileFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const folderPath = pathService.dirname(filePath);
    yield* fileSystem.makeDirectory(folderPath, { recursive: true });
    const draftFileId = yield* Effect.sync(() => randomUUID());
    const draftFilePath = `${filePath}.${draftFileId}.draft`;
    const documentAsString = JSON.stringify(document, null, 2);
    yield* fileSystem.writeFileString(draftFilePath, `${documentAsString}\n`);
    yield* fileSystem.rename(draftFilePath, filePath);
  }).pipe(
    Effect.mapError((cause) =>
      makeDocumentFileFailure({
        filePath,
        message: `Could not write ${filePath}: ${errorMessage(cause)}`,
        cause,
      }),
    ),
  );
