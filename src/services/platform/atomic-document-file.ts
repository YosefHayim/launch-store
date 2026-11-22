import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathExists } from '../../path-exists.ts';
import { errorMessage } from './error-message.ts';

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

function isDocumentFileFailure(cause: unknown): cause is DocumentFileFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'DocumentFileFailure';
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
    if (isDocumentFileFailure(cause)) {
      throw cause;
    }

    throw makeDocumentFileFailure({
      filePath,
      message: `Could not read ${filePath}: ${errorMessage(cause)}`,
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
    throw makeDocumentFileFailure({
      filePath,
      message: `Could not write ${filePath}: ${errorMessage(cause)}`,
      cause,
    });
  }
}
