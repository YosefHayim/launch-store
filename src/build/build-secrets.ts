// Stores build secrets in the keychain and fills them in before a build runs.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LaunchSecretStore } from '../services/credentials/secret-store.ts';
import { resolveSecretsFilePath } from '../services/platform/paths.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** Non-secret coordinates for one app/profile environment secret. */
export type SecretRef = Readonly<{
  app: string;
  profile: string | null;
  name: string;
}>;

type SecretsIndex = Readonly<{ secrets: readonly SecretRef[] }>;

const EMPTY_SECRETS_INDEX: SecretsIndex = { secrets: [] };

/** Resolve the secret-store account for one scoped build secret. */
function secretAccount(secretReference: SecretRef): string {
  let profile = '*';

  const hasProfile = secretReference.profile != null;

  if (hasProfile) {
    profile = secretReference.profile;
  }

  return `build-secret:${secretReference.app}:${profile}:${secretReference.name}`;
}

/** Compare two secret coordinates by their natural key. */
function sameSecret(left: SecretRef, right: SecretRef): boolean {
  const isSameApp = left.app == right.app;

  if (isSameApp == false) {
    return false;
  }

  const isSameProfile = left.profile == right.profile;

  if (isSameProfile == false) {
    return false;
  }

  return left.name == right.name;
}

function decodeSecretRef(candidate: unknown): SecretRef | null {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return null;
  }

  const appName = candidateObject['app'];
  const appIsString = typeof appName == 'string';

  if (appIsString == false) {
    return null;
  }

  const secretName = candidateObject['name'];
  const nameIsString = typeof secretName == 'string';

  if (nameIsString == false) {
    return null;
  }

  const hasProfile = Object.hasOwn(candidateObject, 'profile');

  if (hasProfile == false) {
    return null;
  }

  const profile = candidateObject['profile'];
  const profileIsNull = profile == null;
  const profileIsString = typeof profile == 'string';

  if (profileIsNull) {
    return { app: appName, profile: null, name: secretName };
  }

  if (profileIsString == false) {
    return null;
  }

  return { app: appName, profile, name: secretName };
}

function decodeSecretsIndex(decoded: unknown): SecretsIndex | null {
  const decodedObject = readPlainObject(decoded);

  if (decodedObject == null) {
    return null;
  }

  const secretList = decodedObject['secrets'];
  const isList = Array.isArray(secretList);

  if (isList == false) {
    return null;
  }

  const secretReferences: SecretRef[] = [];

  for (const candidate of secretList) {
    const secretReference = decodeSecretRef(candidate);
    const isValid = secretReference != null;

    if (isValid == false) {
      return null;
    }

    secretReferences.push(secretReference);
  }

  return { secrets: secretReferences };
}

/** Read and decode the non-secret index, degrading missing or malformed files to an empty index. */
async function readIndex(): Promise<SecretsIndex> {
  const indexPath = resolveSecretsFilePath();

  try {
    var encodedIndex = await readFile(indexPath, 'utf8');
  } catch {
    return EMPTY_SECRETS_INDEX;
  }

  try {
    var decodedIndex: unknown = JSON.parse(encodedIndex);
  } catch {
    return EMPTY_SECRETS_INDEX;
  }

  const secretIndex = decodeSecretsIndex(decodedIndex);

  const isInvalid = secretIndex == null;

  if (isInvalid) {
    return EMPTY_SECRETS_INDEX;
  }

  return secretIndex;
}

/** Persist the non-secret index, creating its parent directory first. */
async function writeIndex(secretIndex: SecretsIndex): Promise<void> {
  const indexPath = resolveSecretsFilePath();
  const parentDirectory = path.dirname(indexPath);

  await mkdir(parentDirectory, { recursive: true });

  const serialized = JSON.stringify(secretIndex, null, 2);

  await writeFile(indexPath, serialized);
}

function belongsToApp(appName: string): (secretReference: SecretRef) => boolean {
  return function secretBelongsToApp(secretReference: SecretRef): boolean {
    return secretReference.app == appName;
  };
}

/** List recorded secret coordinates, optionally restricted to one app. */
export async function listSecretRefs(appName?: string): Promise<readonly SecretRef[]> {
  const secretIndex = await readIndex();
  const hasAppFilter = appName != null;

  if (hasAppFilter == false) {
    return secretIndex.secrets;
  }

  return secretIndex.secrets.filter(belongsToApp(appName));
}

function matchesReference(secretReference: SecretRef): (existingReference: SecretRef) => boolean {
  return function existingMatches(existingReference: SecretRef): boolean {
    return sameSecret(existingReference, secretReference);
  };
}

/** Store a secret value and add its coordinates to the index once. */
export async function setBuildSecret(
  secretReference: SecretRef,
  secretText: string,
): Promise<void> {
  await LaunchSecretStore.storeSecret(secretAccount(secretReference), secretText);

  const secretIndex = await readIndex();

  const alreadyRecorded = secretIndex.secrets.some(matchesReference(secretReference));

  if (alreadyRecorded) {
    return;
  }

  await writeIndex({ secrets: [...secretIndex.secrets, secretReference] });
}

function isDifferentSecret(secretReference: SecretRef): (existingReference: SecretRef) => boolean {
  return function existingDiffers(existingReference: SecretRef): boolean {
    return sameSecret(existingReference, secretReference) == false;
  };
}

/** Delete a secret value and remove its coordinates from the index. */
export async function removeBuildSecret(secretReference: SecretRef): Promise<boolean> {
  await LaunchSecretStore.deleteSecret(secretAccount(secretReference));

  const secretIndex = await readIndex();
  const remainingReferences = secretIndex.secrets.filter(isDifferentSecret(secretReference));

  const existed = remainingReferences.length != secretIndex.secrets.length;

  if (existed) {
    await writeIndex({ secrets: remainingReferences });
  }

  return existed;
}

function isAppWide(secretReference: SecretRef): boolean {
  return secretReference.profile == null;
}

function matchesProfile(profileName: string): (secretReference: SecretRef) => boolean {
  return function profileMatches(secretReference: SecretRef): boolean {
    return secretReference.profile == profileName;
  };
}

/** Select app-wide secrets first and profile-specific overrides second. */
export function effectiveRefs(
  secretReferences: readonly SecretRef[],
  appName: string,
  profileName: string,
): readonly SecretRef[] {
  const appReferences = secretReferences.filter(belongsToApp(appName));

  return [...appReferences.filter(isAppWide), ...appReferences.filter(matchesProfile(profileName))];
}

/** Resolve keychain values for one build, with profile-specific values overriding app-wide values. */
export async function resolveBuildSecrets(
  appName: string,
  profileName: string,
): Promise<Record<string, string>> {
  const secretReferences = await listSecretRefs();
  const environmentValues: Record<string, string> = {};

  for (const secretReference of effectiveRefs(secretReferences, appName, profileName)) {
    const secretText = await LaunchSecretStore.readSecret(secretAccount(secretReference));

    const hasSecret = secretText != null;

    if (hasSecret) {
      environmentValues[secretReference.name] = secretText;
    }
  }

  return environmentValues;
}
