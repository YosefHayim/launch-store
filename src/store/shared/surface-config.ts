import { readFile } from 'node:fs/promises';
import { pathExists } from '../../path-exists.ts';
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
  missingMessage: (configPath: string) => string;
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

    throw surfaceConfigFailure(
      `decode ${configSpec.displayName} fields`,
      cause,
      errorMessage(cause),
    );
  }
}

/** Read and decode one store-surface JSON sidecar. */
export async function loadStoreSurfaceConfig<Config>(
  configPath: string,
  configSpec: StoreSurfaceConfigSpec<Config>,
): Promise<Config> {
  let configExists = false;

  try {
    configExists = await pathExists(configPath);
  } catch (cause) {
    throw surfaceConfigFailure(`inspect ${configSpec.displayName}`, cause);
  }

  if (configExists == false) {
    throw surfaceConfigFailure(
      `read ${configSpec.displayName}`,
      configPath,
      configSpec.missingMessage(configPath),
    );
  }

  let configSource = '';

  try {
    configSource = await readFile(configPath, 'utf8');
  } catch (cause) {
    throw surfaceConfigFailure(`read ${configSpec.displayName}`, cause);
  }

  let rawDocument: unknown;

  try {
    rawDocument = JSON.parse(configSource);
  } catch (cause) {
    throw surfaceConfigFailure(
      `parse ${configSpec.displayName} JSON`,
      cause,
      `Invalid JSON in ${configPath}.`,
    );
  }

  return decodeStoreSurfaceConfig(rawDocument, configSpec);
}
