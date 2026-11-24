// Checks one launch.config.ts section before Launch sends it to a store.

import { errorMessage } from '../../services/platform/error-message.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';

export type StoreSurfaceConfigSpec<Config> = Readonly<{
  documentName: string;
  displayName: string;
  decodeDocument: (rawDocument: unknown) => Config;
}>;

/** Decode one untrusted store-surface document with its domain checker. */
export function decodeStoreSurfaceConfig<Config>(
  rawDocument: unknown,
  configSpec: StoreSurfaceConfigSpec<Config>,
): Config {
  const rawDocumentObject = readPlainObject(rawDocument);

  if (rawDocumentObject == null) {
    throw new Error(`${configSpec.documentName} must be a JSON object.`, { cause: rawDocument });
  }

  try {
    return configSpec.decodeDocument(rawDocumentObject);
  } catch (cause) {
    const isAlreadyError = cause instanceof Error;

    if (isAlreadyError) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw new Error(failureMessage, { cause });
  }
}
