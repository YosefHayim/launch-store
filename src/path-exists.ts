// Reports whether a file or folder path is present for Launch.

import { access } from 'node:fs/promises';

export async function pathExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
  } catch (error) {
    const isError = error instanceof Error;

    if (isError == false) {
      throw new Error(`Could not read ${candidate}`, { cause: error });
    }

    const nodeError = error as NodeJS.ErrnoException;

    const isMissing = nodeError.code == 'ENOENT';

    if (isMissing) {
      return false;
    }

    throw new Error(`Could not read ${candidate}`, { cause: error });
  }

  return true;
}
