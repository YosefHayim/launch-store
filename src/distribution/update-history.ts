// Records, activates, republishes, and rolls back an over-the-air update.

import type { CodeSigner } from '../credentials/code-sign.ts';
import type { StorageProvider } from '../types/providers.ts';
import {
  assembleRollbackDirective,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
  type StoredRollbackDirective,
  type UpdateHistoryEntry,
  type UpdateManifest,
} from './over-the-air-manifest.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

function readString(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];

  if (typeof field != 'string') {
    throw new Error(`Missing ${fieldName}.`);
  }

  return field;
}

function readOptionalString(
  record: Record<string, unknown>,
  fieldName: string,
): string | null | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (typeof field == 'string') {
    return field;
  }

  return null;
}

function isNull(field: string | null | undefined): boolean {
  return Object.is(field, null);
}

function parseJson(jsonText: string): unknown {
  return JSON.parse(jsonText);
}

function readManifestAsset(candidate: unknown): UpdateManifest['launchAsset'] {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    throw new Error('Manifest asset is malformed.');
  }

  const asset: UpdateManifest['launchAsset'] = {
    key: readString(candidateObject, 'key'),
    contentType: readString(candidateObject, 'contentType'),
    url: readString(candidateObject, 'url'),
  };
  const fileExtension = readOptionalString(candidateObject, 'fileExtension');

  const fileExtensionIsInvalid = isNull(fileExtension);

  if (fileExtensionIsInvalid) {
    throw new Error('Manifest asset extension is malformed.');
  }

  if (fileExtension == null) {
    return asset;
  }

  return { ...asset, fileExtension };
}

function isEmptyRecord(candidate: unknown): boolean {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  return Object.keys(candidateObject).length == 0;
}

function decodeManifest(jsonText: string): UpdateManifest {
  const parsed = parseJson(jsonText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw new Error('Update manifest is malformed.');
  }

  if (isEmptyRecord(parsedObject['metadata']) == false) {
    throw new Error('Update manifest metadata is malformed.');
  }

  if (isEmptyRecord(parsedObject['extra']) == false) {
    throw new Error('Update manifest extra is malformed.');
  }

  if (Array.isArray(parsedObject['assets']) == false) {
    throw new Error('Update manifest assets are malformed.');
  }

  const assets = parsedObject['assets'].map(readManifestAsset);

  return {
    id: readString(parsedObject, 'id'),
    createdAt: readString(parsedObject, 'createdAt'),
    runtimeVersion: readString(parsedObject, 'runtimeVersion'),
    launchAsset: readManifestAsset(parsedObject['launchAsset']),
    assets,
    metadata: {},
    extra: {},
  };
}

function decodeHistoryEntry(candidate: unknown): UpdateHistoryEntry {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    throw new Error('History entry is malformed.');
  }

  const kind = readString(candidateObject, 'kind');
  const isPublish = kind == 'publish';
  const isRollback = kind == 'rollback';

  if (isPublish == false) {
    if (isRollback == false) {
      throw new Error('History entry kind is malformed.');
    }
  }

  if (typeof candidateObject['active'] != 'boolean') {
    throw new Error('History entry active flag is malformed.');
  }

  if (typeof candidateObject['signed'] != 'boolean') {
    throw new Error('History entry signed flag is malformed.');
  }

  let historyKind: UpdateHistoryEntry['kind'] = 'rollback';

  if (isPublish) {
    historyKind = 'publish';
  }

  return {
    id: readString(candidateObject, 'id'),
    runtimeVersion: readString(candidateObject, 'runtimeVersion'),
    createdAt: readString(candidateObject, 'createdAt'),
    active: candidateObject['active'],
    signed: candidateObject['signed'],
    kind: historyKind,
  };
}

function decodeHistory(jsonText: string): UpdateHistoryEntry[] {
  const parsed = parseJson(jsonText);

  if (Array.isArray(parsed) == false) {
    throw new Error('Update history is malformed.');
  }

  return parsed.map(decodeHistoryEntry);
}

function decodeRollbackDirective(jsonText: string): StoredRollbackDirective | null {
  try {
    const parsed = parseJson(jsonText);

    const parsedObject = readPlainObject(parsed);

    if (parsedObject == null) {
      return null;
    }

    if (typeof parsedObject['active'] != 'boolean') {
      return null;
    }

    if (typeof parsedObject['body'] != 'string') {
      return null;
    }

    const signature = readOptionalString(parsedObject, 'signature');

    const signatureIsInvalid = isNull(signature);

    if (signatureIsInvalid) {
      return null;
    }

    const directive: StoredRollbackDirective = {
      active: parsedObject['active'],
      body: parsedObject['body'],
    };

    if (signature == null) {
      return directive;
    }

    return { ...directive, signature };
  } catch (cause) {
    const isMalformed = cause != null;

    if (isMalformed) {
      return null;
    }

    return null;
  }
}

/** Read the per-channel platform history, treating only absent state as empty. */
export async function readHistory(
  storage: StorageProvider,
  channel: string,
  platform: string,
): Promise<UpdateHistoryEntry[]> {
  const historyBytes = await storage.getObject(historyIndexKey(channel, platform));

  if (historyBytes == null) {
    return [];
  }

  return decodeHistory(historyBytes.toString('utf8'));
}

/** Clear the active flag for entries with one runtime version. */
export function deactivateRuntimeVersion(
  entries: UpdateHistoryEntry[],
  runtimeVersion: string,
): UpdateHistoryEntry[] {
  return entries.map(function deactivate(entry) {
    if (entry.runtimeVersion != runtimeVersion) {
      return entry;
    }

    if (entry.active == false) {
      return entry;
    }

    return { ...entry, active: false };
  });
}

/** Find the newest, exact, or short-prefix history entry named by a CLI reference. */
export function findHistoryEntry<HistoryEntry extends UpdateHistoryEntry>(
  entries: HistoryEntry[],
  reference: string,
): HistoryEntry | undefined {
  if (reference == 'latest') {
    return entries[0];
  }

  const exactEntry = entries.find(function sameId(entry) {
    return entry.id == reference;
  });

  if (exactEntry != null) {
    return exactEntry;
  }

  return entries.find(function startsWithReference(entry) {
    return entry.id.startsWith(reference);
  });
}

async function writeHistory(
  storage: StorageProvider,
  channel: string,
  platform: string,
  entries: readonly UpdateHistoryEntry[],
): Promise<void> {
  const serialized = JSON.stringify(entries, null, 2);
  await storage.putObject(historyIndexKey(channel, platform), serialized, 'application/json');
}

async function writePublishedHistory(
  storage: StorageProvider,
  channel: string,
  platform: string,
  existingHistory: UpdateHistoryEntry[],
  entry: UpdateHistoryEntry,
): Promise<void> {
  const updatedHistory = deactivateRuntimeVersion(existingHistory, entry.runtimeVersion);

  await writeHistory(storage, channel, platform, [entry, ...updatedHistory]);
}

/** Make a newly published entry active and prepend it to history. */
export async function recordPublish(
  storage: StorageProvider,
  channel: string,
  platform: string,
  entry: UpdateHistoryEntry,
): Promise<void> {
  const existingHistory = await readHistory(storage, channel, platform);

  await writePublishedHistory(storage, channel, platform, existingHistory, entry);
}

/** Deactivate the rollback-to-embedded directive for one runtime version. */
export async function clearRollbackDirective(
  storage: StorageProvider,
  channel: string,
  platform: string,
  runtimeVersion: string,
): Promise<void> {
  const directiveKey = rollbackDirectiveKey(channel, platform, runtimeVersion);
  const directiveBytes = await storage.getObject(directiveKey);

  if (directiveBytes == null) {
    return;
  }

  const storedDirective = decodeRollbackDirective(directiveBytes.toString('utf8'));

  if (storedDirective == null) {
    const clearedDirective: StoredRollbackDirective = { active: false, body: '' };

    const serialized = JSON.stringify(clearedDirective, null, 2);

    await storage.putObject(directiveKey, serialized, 'application/json');

    return;
  }

  if (storedDirective.active == false) {
    return;
  }

  const clearedDirective: StoredRollbackDirective = { active: false, body: '' };

  const serialized = JSON.stringify(clearedDirective, null, 2);

  await storage.putObject(directiveKey, serialized, 'application/json');
}

async function writeActiveManifest(
  storage: StorageProvider,
  channel: string,
  platform: string,
  updateManifest: UpdateManifest,
  signer: CodeSigner | null,
): Promise<void> {
  const manifestText = JSON.stringify(updateManifest);

  await storage.putObject(
    manifestKey(channel, platform, updateManifest.runtimeVersion),
    manifestText,
    'application/json',
  );
  await storage.putObject(
    historySnapshotKey(channel, platform, updateManifest.runtimeVersion, updateManifest.id),
    manifestText,
    'application/json',
  );

  if (signer == null) {
    return;
  }

  await storage.putObject(
    manifestSignatureKey(channel, platform, updateManifest.runtimeVersion),
    signer.sign(manifestText),
    'text/plain',
  );
}

type ActivateUpdateInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly updateManifest: UpdateManifest;
  readonly kind: UpdateHistoryEntry['kind'];
  readonly signer: CodeSigner | null;
}>;

/** Persist the active manifest + snapshot, record history */
export async function activateUpdate(input: ActivateUpdateInput): Promise<UpdateHistoryEntry> {
  const { storage, channel, platform, updateManifest, kind, signer } = input;
  const existingHistory = await readHistory(storage, channel, platform);

  await writeActiveManifest(storage, channel, platform, updateManifest, signer);

  const historyEntry: UpdateHistoryEntry = {
    id: updateManifest.id,
    runtimeVersion: updateManifest.runtimeVersion,
    createdAt: updateManifest.createdAt,
    active: true,
    signed: signer != null,
    kind,
  };

  await writePublishedHistory(storage, channel, platform, existingHistory, historyEntry);
  await clearRollbackDirective(storage, channel, platform, updateManifest.runtimeVersion);

  return historyEntry;
}

type RepublishUpdateInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly target: UpdateHistoryEntry;
  readonly newId: string;
  readonly createdAt: string;
  readonly signer: CodeSigner | null;
}>;

type RepublishedUpdate = Readonly<{
  readonly manifest: UpdateManifest;
  readonly entry: UpdateHistoryEntry;
}>;

/** Republish an immutable snapshot as the active rollback update. */
export async function republishUpdate(input: RepublishUpdateInput): Promise<RepublishedUpdate> {
  const { storage, channel, platform, target, newId, createdAt, signer } = input;
  const snapshotKey = historySnapshotKey(channel, platform, target.runtimeVersion, target.id);
  const snapshotBytes = await storage.getObject(snapshotKey);

  if (snapshotBytes == null) {
    throw new Error(`No snapshot for update ${target.id} (runtime ${target.runtimeVersion}).`);
  }

  try {
    var previousManifest = decodeManifest(snapshotBytes.toString('utf8'));
  } catch (cause) {
    const isMalformed = cause != null;

    if (isMalformed) {
      throw new Error(`Snapshot for update ${target.id} is malformed.`);
    }

    throw new Error(`Snapshot for update ${target.id} is malformed.`);
  }

  const updateManifest: UpdateManifest = {
    ...previousManifest,
    id: newId,
    createdAt,
  };
  const historyEntry = await activateUpdate({
    storage,
    channel,
    platform,
    updateManifest,
    kind: 'rollback',
    signer,
  });

  return { manifest: updateManifest, entry: historyEntry };
}

type SetRollbackToEmbeddedInput = Readonly<{
  readonly storage: StorageProvider;
  readonly channel: string;
  readonly platform: string;
  readonly runtimeVersion: string;
  readonly commitTime: string;
  readonly signer: CodeSigner | null;
}>;

/** Publish a rollback directive that sends clients to the embedded bundle. */
export async function setRollbackToEmbedded(input: SetRollbackToEmbeddedInput): Promise<void> {
  const { storage, channel, platform, runtimeVersion, commitTime, signer } = input;
  const directiveText = JSON.stringify(assembleRollbackDirective(commitTime));
  let storedDirective: StoredRollbackDirective = {
    active: true,
    body: directiveText,
  };

  if (signer != null) {
    storedDirective = {
      ...storedDirective,
      signature: signer.sign(directiveText),
    };
  }

  const serialized = JSON.stringify(storedDirective, null, 2);

  await storage.putObject(
    rollbackDirectiveKey(channel, platform, runtimeVersion),
    serialized,
    'application/json',
  );
}
