// Reads a document file and replaces it by renaming a finished temporary file into place.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathExists } from '../../path-exists.ts';
import { errorMessage } from './error-message.ts';
import { isFailureTag } from './tagged-failure.ts';

export type DocumentFileFailure = Readonly<{
  _tag: 'DocumentFileFailure';
  filePath: string;
  message: string;
  cause: unknown;
}>;

function makeDocumentFileFailure(fields: {
  filePath: string;
  message: string;
  cause: unknown;
}): DocumentFileFailure {
  return { _tag: 'DocumentFileFailure', ...fields };
}

export async function readDocumentFile<Document>(
  filePath: string,
  decodeDocument: (documentText: string) => Document,
): Promise<Document | null> {
  try {
    const isFilePresent = await pathExists(filePath);

    if (isFilePresent == false) {
      return null;
    }

    const fileAsString = await readFile(filePath, 'utf8');

    return decodeDocument(fileAsString);
  } catch (cause) {
    if (isFailureTag(cause, 'DocumentFileFailure')) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw makeDocumentFileFailure({
      filePath,
      message: `Could not read ${filePath}: ${failureMessage}`,
      cause,
    });
  }
}

export async function writeDocumentFileAtomically(
  filePath: string,
  document: unknown,
): Promise<void> {
  try {
    const folderPath = dirname(filePath);

    await mkdir(folderPath, { recursive: true });

    const draftFilePath = `${filePath}.${randomUUID()}.draft`;
    const documentAsString = JSON.stringify(document, null, 2);

    await writeFile(draftFilePath, `${documentAsString}\n`);
    await rename(draftFilePath, filePath);
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    throw makeDocumentFileFailure({
      filePath,
      message: `Could not write ${filePath}: ${failureMessage}`,
      cause,
    });
  }
}
