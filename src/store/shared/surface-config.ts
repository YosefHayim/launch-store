// Checks one launch.config.ts section before Launch sends it to a store.

import { errorMessage } from '../../services/platform/error-message.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';
import { isFailureTag } from '../../services/platform/tagged-failure.ts';

/** A store-surface JSON document could not be read or decoded. */
export type StoreSurfaceConfigFailure = Readonly<{
  readonly _tag: 'StoreSurfaceConfigFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeStoreSurfaceConfigFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): StoreSurfaceConfigFailure {
  return { _tag: 'StoreSurfaceConfigFailure', ...fields };
}

export type StoreSurfaceConfigSpec<Config> = Readonly<{
  documentName: string;
  displayName: string;
  decodeDocument: (rawDocument: unknown) => Config;
}>;

function surfaceConfigFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): StoreSurfaceConfigFailure {
  let message = explicitMessage;

  if (message == null) {
    message = errorMessage(cause);
  }

  return makeStoreSurfaceConfigFailure({ operation, message, cause });
}

/** Decode one untrusted store-surface document with its domain checker. */
export function decodeStoreSurfaceConfig<Config>(
  rawDocument: unknown,
  configSpec: StoreSurfaceConfigSpec<Config>,
): Config {
  const rawDocumentObject = readPlainObject(rawDocument);

  if (rawDocumentObject == null) {
    throw surfaceConfigFailure(
      `decode ${configSpec.displayName} document`,
      rawDocument,
      `${configSpec.documentName} must be a JSON object.`,
    );
  }

  try {
    return configSpec.decodeDocument(rawDocumentObject);
  } catch (cause) {
    if (isFailureTag(cause, 'StoreSurfaceConfigFailure')) {
      throw cause;
    }

    const failureMessage = errorMessage(cause);

    throw surfaceConfigFailure(`decode ${configSpec.displayName} fields`, cause, failureMessage);
  }
}
