// Reads the key id from an App Store Connect AuthKey file name and checks that it matches.

import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

// AuthKey_<KEYID>.p8, with a Key ID of at least 8 letters or digits.
const AUTH_KEY_FILENAME = /^AuthKey_([A-Z0-9]{8,})\.p8$/i;

function keyIdentifiersConflict(
  normalizedKeyId: string | undefined,
  filenameKeyId: string | null,
): boolean {
  if (normalizedKeyId == null) {
    return false;
  }

  if (filenameKeyId == null) {
    return false;
  }

  return normalizedKeyId != filenameKeyId;
}

/** Read an uppercase Apple Key ID from an `AuthKey_<KEYID>.p8` filename. */
export function extractKeyId(p8Path: string): string | null {
  const fileName = basename(p8Path);
  const capturedKeyId = AUTH_KEY_FILENAME.exec(fileName)?.[1];

  if (capturedKeyId == null) {
    return null;
  }

  return capturedKeyId.toUpperCase();
}

/** List matching Apple key files in one directory, returning an empty list when unavailable. */
export async function findAuthKeyFiles(directoryPath: string): Promise<readonly string[]> {
  let directoryNames: string[];

  try {
    directoryNames = await readdir(directoryPath);
  } catch (error) {
    // A missing search directory means there are no keys there yet.
    const isDirectoryUnavailable = error != null;

    if (isDirectoryUnavailable) {
      return [];
    }

    return [];
  }

  function isAuthKeyFile(fileName: string): boolean {
    return AUTH_KEY_FILENAME.test(fileName);
  }

  function joinAuthKey(fileName: string): string {
    return join(directoryPath, fileName);
  }

  return directoryNames.filter(isAuthKeyFile).sort().reverse().map(joinAuthKey);
}

/** Reconcile a flag or environment Key ID with the ID carried by Apple's filename. */
export function reconcileKeyId(
  explicitKeyId: string | undefined,
  filenameKeyId: string | null,
): string | undefined {
  let normalizedKeyId: string | undefined;

  if (explicitKeyId != null) {
    normalizedKeyId = explicitKeyId.trim().toUpperCase();
  }

  const identifiersConflict = keyIdentifiersConflict(normalizedKeyId, filenameKeyId);

  if (identifiersConflict) {
    throw new Error(`Key ID ${normalizedKeyId} does not match AuthKey_${filenameKeyId}.p8.`);
  }

  if (normalizedKeyId != null) {
    return normalizedKeyId;
  }

  if (filenameKeyId != null) {
    return filenameKeyId;
  }

  return undefined;
}
