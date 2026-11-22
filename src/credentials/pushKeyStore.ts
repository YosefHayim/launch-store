import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathExists } from '@/path-exists.js';
import { LaunchSecretStore } from '@/services/credentials/secretStore.js';
import { resolveLaunchHomeDirectory, resolvePushKeysFilePath } from '@/services/platform/paths.js';
import { decodeP8, encodeP8 } from './accounts.js';

/**
 * One imported APNs authentication key (`.p8`) in Launch's push-key vault (`~/.launch/push-keys.json`).
 *
 * An APNs auth key is how a backend sends push notifications to your app. Unlike the App Store Connect
 * key, Apple exposes NO API to create one - it's a download-once, portal-only key (Certificates, IDs &
 * Profiles -> Keys), capped at 2 per account - so Launch can only *import* and safeguard a key you've
 * already downloaded, never mint one. Launch never *uses* these keys (push is a backend/runtime concern);
 * the vault exists so a download-once secret isn't lost. This record is non-secret metadata only - the
 * `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`. An APNs key is team-wide, not per-app.
 */
type ApnsKeyRecord = Readonly<{
  keyId: string;
  teamId?: string;
  label?: string;
  importedAt: string;
}>;

/** Secret-store account holding one APNs key's `.p8` PEM, namespaced by Key ID. */
function apnsAccount(keyId: string): string {
  return `apns-p8:${keyId}`;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate != 'object') {
    return false;
  }

  return candidate != null;
}

function readRequiredString(document: Record<string, unknown>, fieldName: string): string | null {
  const field = document[fieldName];

  if (typeof field != 'string') {
    return null;
  }

  return field;
}

function readOptionalString(
  document: Record<string, unknown>,
  fieldName: string,
): { status: 'missing' | 'invalid' | 'present'; text: string } {
  if (fieldName in document == false) {
    return { status: 'missing', text: '' };
  }

  const field = document[fieldName];

  if (typeof field != 'string') {
    return { status: 'invalid', text: '' };
  }

  return { status: 'present', text: field };
}

function decodeApnsKeyRecord(candidate: unknown): ApnsKeyRecord | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const keyId = readRequiredString(candidate, 'keyId');

  if (keyId == null) {
    return null;
  }

  const importedAt = readRequiredString(candidate, 'importedAt');

  if (importedAt == null) {
    return null;
  }

  const teamId = readOptionalString(candidate, 'teamId');

  if (teamId.status == 'invalid') {
    return null;
  }

  const label = readOptionalString(candidate, 'label');

  if (label.status == 'invalid') {
    return null;
  }

  const record: { keyId: string; importedAt: string; teamId?: string; label?: string } = {
    keyId,
    importedAt,
  };

  if (teamId.status == 'present') {
    record.teamId = teamId.text;
  }

  if (label.status == 'present') {
    record.label = label.text;
  }

  return record;
}

function decodePushKeyFile(candidate: unknown): readonly ApnsKeyRecord[] | null {
  if (isRecord(candidate) == false) {
    return null;
  }

  const keysField = candidate['keys'];

  if (Array.isArray(keysField) == false) {
    return null;
  }

  const keys: ApnsKeyRecord[] = [];

  for (const keyField of keysField) {
    const key = decodeApnsKeyRecord(keyField);

    if (key == null) {
      return null;
    }

    keys.push(key);
  }

  return keys;
}

/** Read the vault index, returning an empty list when the file is absent or malformed. */
export async function listPushKeys(): Promise<readonly ApnsKeyRecord[]> {
  const pushKeysFilePath = resolvePushKeysFilePath();
  const indexExists = await pathExists(pushKeysFilePath);

  if (indexExists == false) {
    return [];
  }

  try {
    const indexText = await readFile(pushKeysFilePath, 'utf8');
    const parsedIndex: unknown = JSON.parse(indexText);
    const keys = decodePushKeyFile(parsedIndex);

    if (keys == null) {
      return [];
    }

    return keys;
  } catch (error) {
    const isUnreadable = error != null;

    if (isUnreadable) {
      return [];
    }

    return [];
  }
}

/** Write the vault index back to disk (pretty-printed; non-secret metadata only). */
async function writePushKeys(keys: readonly ApnsKeyRecord[]): Promise<void> {
  const launchHomeDirectory = resolveLaunchHomeDirectory();
  await mkdir(launchHomeDirectory, { recursive: true });
  const indexText = JSON.stringify({ keys }, null, 2);
  await writeFile(resolvePushKeysFilePath(), indexText);
}

/** Find a vaulted key by Key ID, case-insensitively (Apple's Key IDs are upper-case). */
export async function findPushKey(keyId: string): Promise<ApnsKeyRecord | undefined> {
  const needle = keyId.trim().toLowerCase();
  const pushKeys = await listPushKeys();

  function hasKeyId(pushKey: ApnsKeyRecord): boolean {
    return pushKey.keyId.toLowerCase() == needle;
  }

  return pushKeys.find(hasKeyId);
}

/** Inputs to {@link importPushKey}. */
type ImportPushKeyRequest = {
  keyId: string;
  p8: string;
  teamId?: string;
  label?: string;
};

/**
 * Import (or replace) an APNs key: the `.p8` goes to the OS secret store, the metadata to the vault
 * index. Re-importing an existing Key ID updates it in place (keeping its original `importedAt`), so
 * re-importing with a new label or team never creates a duplicate.
 */
export async function importPushKey(importRequest: ImportPushKeyRequest): Promise<ApnsKeyRecord> {
  await LaunchSecretStore.storeSecret(apnsAccount(importRequest.keyId), encodeP8(importRequest.p8));

  const keys = await listPushKeys();

  function hasSameKeyId(pushKey: ApnsKeyRecord): boolean {
    return pushKey.keyId == importRequest.keyId;
  }

  const existing = keys.find(hasSameKeyId);
  let importedAt = currentTimestamp();

  if (existing != null) {
    importedAt = existing.importedAt;
  }

  const record: { keyId: string; importedAt: string; teamId?: string; label?: string } = {
    keyId: importRequest.keyId,
    importedAt,
  };

  if (importRequest.teamId != null) {
    record.teamId = importRequest.teamId;
  }

  if (importRequest.label != null) {
    record.label = importRequest.label;
  }

  function replaceExisting(pushKey: ApnsKeyRecord): ApnsKeyRecord {
    if (pushKey.keyId == importRequest.keyId) {
      return record;
    }

    return pushKey;
  }

  let storedKeys: readonly ApnsKeyRecord[] = [...keys, record];

  if (existing != null) {
    storedKeys = keys.map(replaceExisting);
  }

  await writePushKeys(storedKeys);

  return record;
}

/** Load one APNs key's `.p8` PEM from the secret store, or null if absent - the export path. */
export async function loadPushKey(keyId: string): Promise<string | null> {
  const stored = await LaunchSecretStore.readSecret(apnsAccount(keyId));

  if (stored == null) {
    return null;
  }

  if (stored == '') {
    return null;
  }

  return decodeP8(stored);
}
