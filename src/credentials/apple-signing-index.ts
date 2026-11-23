// Reads and writes the local index of signing certificates and profiles, with no secrets in it.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';
import { resolveAccountCredentialsDirectory } from '../services/platform/paths.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** Persisted record of the distribution certificate Launch created and backed up. */
export type CertRecord = {
  id: string;
  serial: string;
  p12Path: string;
};

/** Persisted record of one bundle's App Store provisioning profile. */
type ProfileRecord = {
  id: string;
  uuid: string;
  name: string;
  path: string;
  teamId: string;
};

/** On-disk credential metadata (`~/.launch/credentials/index.json`). No secrets - paths + ids only. */
export type CredentialsIndex = {
  certificate?: CertRecord;
  profiles: Record<string, ProfileRecord>;
};

function emptyCredentialsIndex(): CredentialsIndex {
  return { profiles: {} };
}

export type AppleSigningFailure = Readonly<{
  readonly _tag: 'AppleSigningFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

export function makeAppleSigningFailure(fields: {
  message: string;
  cause?: unknown;
}): AppleSigningFailure {
  if (fields.cause == null) {
    return { _tag: 'AppleSigningFailure', message: fields.message };
  }

  return { _tag: 'AppleSigningFailure', message: fields.message, cause: fields.cause };
}

function readRequiredString(document: Record<string, unknown>, fieldName: string): string | null {
  const field = document[fieldName];

  if (typeof field != 'string') {
    return null;
  }

  return field;
}

function decodeCertRecord(candidate: unknown): CertRecord | null {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return null;
  }

  const id = readRequiredString(candidateObject, 'id');

  if (id == null) {
    return null;
  }

  const serial = readRequiredString(candidateObject, 'serial');

  if (serial == null) {
    return null;
  }

  const p12Path = readRequiredString(candidateObject, 'p12Path');

  if (p12Path == null) {
    return null;
  }

  return { id, serial, p12Path };
}

function decodeProfileRecord(candidate: unknown): ProfileRecord | null {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return null;
  }

  const id = readRequiredString(candidateObject, 'id');

  if (id == null) {
    return null;
  }

  const uuid = readRequiredString(candidateObject, 'uuid');

  if (uuid == null) {
    return null;
  }

  const name = readRequiredString(candidateObject, 'name');

  if (name == null) {
    return null;
  }

  const path = readRequiredString(candidateObject, 'path');

  if (path == null) {
    return null;
  }

  const teamId = readRequiredString(candidateObject, 'teamId');

  if (teamId == null) {
    return null;
  }

  return { id, uuid, name, path, teamId };
}

/** Decode an account signing index, or null when the document is not that shape. */
export function decodeCredentialsIndex(candidate: unknown): CredentialsIndex | null {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return null;
  }

  const profilesField = candidateObject['profiles'];

  const profilesFieldObject = readPlainObject(profilesField);

  if (profilesFieldObject == null) {
    return null;
  }

  const profiles: Record<string, ProfileRecord> = {};

  for (const profileName of Object.keys(profilesFieldObject)) {
    const profile = decodeProfileRecord(profilesFieldObject[profileName]);

    if (profile == null) {
      return null;
    }

    profiles[profileName] = profile;
  }

  const hasCertificateField = 'certificate' in candidateObject;

  if (hasCertificateField == false) {
    return { profiles };
  }

  const certificate = decodeCertRecord(candidateObject['certificate']);

  if (certificate == null) {
    return null;
  }

  return { certificate, profiles };
}

/** Absolute path to one account's signing index. */
function indexPath(keyId: string): string {
  const accountCredentialsDirectory = resolveAccountCredentialsDirectory(keyId);
  return join(accountCredentialsDirectory, 'index.json');
}

/** Read an account's credentials index, tolerating a missing or malformed file. */
export async function readIndex(keyId: string): Promise<CredentialsIndex> {
  const credentialsIndexPath = indexPath(keyId);
  const indexExists = await pathExists(credentialsIndexPath);

  if (indexExists == false) {
    return emptyCredentialsIndex();
  }

  try {
    const indexText = await readFile(credentialsIndexPath, 'utf8');
    const parsedIndex: unknown = JSON.parse(indexText);
    const credentialsIndex = decodeCredentialsIndex(parsedIndex);

    if (credentialsIndex == null) {
      return emptyCredentialsIndex();
    }

    return credentialsIndex;
  } catch (error) {
    // A half-written or unreadable index is treated as empty so signing can be created again.
    const isUnreadable = error != null;

    if (isUnreadable) {
      return emptyCredentialsIndex();
    }

    return emptyCredentialsIndex();
  }
}

/** Write an account's credentials index back to disk. */
export async function writeIndex(keyId: string, credentialsIndex: CredentialsIndex): Promise<void> {
  const credentialsDirectory = resolveAccountCredentialsDirectory(keyId);
  await mkdir(credentialsDirectory, { recursive: true });
  const indexText = JSON.stringify(credentialsIndex, null, 2);
  await writeFile(indexPath(keyId), indexText);
}
