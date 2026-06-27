/**
 * The OTA update lifecycle store — the read/write layer behind `launch updates list / view / rollback`.
 *
 * `launch update` publishes a single active `manifest.json` per (channel, platform, runtime version) and,
 * via this module, also records an append-only **history**: a per-(channel, platform) index object plus an
 * immutable snapshot of each manifest. That history is what makes a bad OTA inspectable and reversible —
 * `list`/`view` read it, and `rollback` republishes a prior snapshot as a brand-new active update.
 *
 * Everything goes through the configured {@link StorageProvider}'s `getObject`/`putObject`, so whichever
 * bucket hosts the channel is the one that answers. The pure helpers (deactivate / find) are split out so
 * the index bookkeeping is unit-testable without a real bucket. Time + ids are passed in by the caller
 * (never generated here) so the orchestration stays deterministic under test.
 */

import type { StorageProvider } from './types.js';
import type { CodeSigner } from './codeSign.js';
import {
  type StoredRollbackDirective,
  type UpdateHistoryEntry,
  type UpdateManifest,
  assembleRollbackDirective,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  rollbackDirectiveKey,
} from './otaManifest.js';

/** Read the per-(channel, platform) history index, newest first; `[]` when absent or unreadable. */
export async function readHistory(
  storage: StorageProvider,
  channel: string,
  platform: string,
): Promise<UpdateHistoryEntry[]> {
  const raw = await storage.getObject(historyIndexKey(channel, platform));
  if (!raw) return [];
  try {
    return JSON.parse(raw.toString('utf8')) as UpdateHistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * Clear the `active` flag on every entry for `runtimeVersion` — exactly one update is active per runtime
 * version at a time (it's the one served as that rtv's `manifest.json`). Pure; other rtvs are untouched.
 */
export function deactivateRuntimeVersion(
  entries: UpdateHistoryEntry[],
  runtimeVersion: string,
): UpdateHistoryEntry[] {
  return entries.map((entry) =>
    entry.runtimeVersion === runtimeVersion && entry.active ? { ...entry, active: false } : entry,
  );
}

/**
 * Resolve a `view`/`rollback` reference against history (newest first): `latest` → the newest entry,
 * else an exact id match, else a unique short-id prefix. Pure; undefined when nothing matches.
 */
export function findHistoryEntry<T extends UpdateHistoryEntry>(
  entries: T[],
  ref: string,
): T | undefined {
  if (ref === 'latest') return entries[0];
  return (
    entries.find((entry) => entry.id === ref) ?? entries.find((entry) => entry.id.startsWith(ref))
  );
}

/** Write the history index back (pretty-printed JSON). The single place the index object is persisted. */
async function writeHistory(
  storage: StorageProvider,
  channel: string,
  platform: string,
  entries: UpdateHistoryEntry[],
): Promise<void> {
  await storage.putObject(
    historyIndexKey(channel, platform),
    JSON.stringify(entries, null, 2),
    'application/json',
  );
}

/**
 * Record a freshly-published update: make it the active entry for its runtime version (deactivating the
 * prior one) and prepend it to the index. Called by `launch update` after it writes the manifest + snapshot.
 */
export async function recordPublish(
  storage: StorageProvider,
  channel: string,
  platform: string,
  entry: UpdateHistoryEntry,
): Promise<void> {
  const history = deactivateRuntimeVersion(
    await readHistory(storage, channel, platform),
    entry.runtimeVersion,
  );
  history.unshift(entry);
  await writeHistory(storage, channel, platform, history);
}

/**
 * Clear any active rollback-to-embedded directive for a runtime version — a fresh publish (or a republish)
 * supersedes a prior `--to-embedded`. The {@link StorageProvider} seam has no delete, so "clear" writes an
 * inactive marker the worker treats as no directive. A no-op when none is active.
 */
export async function clearRollbackDirective(
  storage: StorageProvider,
  channel: string,
  platform: string,
  runtimeVersion: string,
): Promise<void> {
  const key = rollbackDirectiveKey(channel, platform, runtimeVersion);
  const raw = await storage.getObject(key);
  if (!raw) return;
  try {
    if (!(JSON.parse(raw.toString('utf8')) as StoredRollbackDirective).active) return;
  } catch {
    /* unreadable marker — fall through and overwrite it with a clean inactive one */
  }
  const cleared: StoredRollbackDirective = { active: false, body: '' };
  await storage.putObject(key, JSON.stringify(cleared, null, 2), 'application/json');
}

/**
 * Republish a prior update as the active one (the default `launch updates rollback`): read the target's
 * immutable snapshot, stamp it with a fresh `id` + `createdAt` (so clients see a newer update and pull the
 * known-good bundle whose assets are still in the bucket), write it back as the active manifest (re-signed
 * when the original was signed), snapshot it, record it as a `rollback` entry, and clear any embedded
 * directive. Throws if the target snapshot is missing.
 */
export async function republishUpdate(args: {
  storage: StorageProvider;
  channel: string;
  platform: string;
  target: UpdateHistoryEntry;
  newId: string;
  createdAt: string;
  signer: CodeSigner | null;
}): Promise<{ manifest: UpdateManifest; entry: UpdateHistoryEntry }> {
  const { storage, channel, platform, target, newId, createdAt, signer } = args;
  const rtv = target.runtimeVersion;

  const snapshot = await storage.getObject(historySnapshotKey(channel, platform, rtv, target.id));
  if (!snapshot) {
    throw new Error(
      `No snapshot for update ${target.id} (rtv ${rtv}) — its history record can't be rolled back to.`,
    );
  }
  const previous = JSON.parse(snapshot.toString('utf8')) as UpdateManifest;
  const manifest: UpdateManifest = { ...previous, id: newId, createdAt };
  const body = JSON.stringify(manifest);

  await storage.putObject(manifestKey(channel, platform, rtv), body, 'application/json');
  await storage.putObject(
    historySnapshotKey(channel, platform, rtv, newId),
    body,
    'application/json',
  );
  if (signer) {
    await storage.putObject(
      manifestSignatureKey(channel, platform, rtv),
      signer.sign(body),
      'text/plain',
    );
  }

  const entry: UpdateHistoryEntry = {
    id: newId,
    runtimeVersion: rtv,
    createdAt,
    active: true,
    signed: Boolean(signer),
    kind: 'rollback',
  };
  await recordPublish(storage, channel, platform, entry);
  await clearRollbackDirective(storage, channel, platform, rtv);
  return { manifest, entry };
}

/**
 * Publish a signed `rollBackToEmbedded` directive for a runtime version (`launch updates rollback
 * --to-embedded`): clients drop to the bundle baked into the binary. The directive body is signed and
 * stored verbatim so the worker can serve the exact signed bytes (it holds no key). Cleared by the next
 * publish/republish.
 */
export async function setRollbackToEmbedded(args: {
  storage: StorageProvider;
  channel: string;
  platform: string;
  runtimeVersion: string;
  commitTime: string;
  signer: CodeSigner | null;
}): Promise<void> {
  const { storage, channel, platform, runtimeVersion, commitTime, signer } = args;
  const body = JSON.stringify(assembleRollbackDirective(commitTime));
  const directive: StoredRollbackDirective = {
    active: true,
    body,
    ...(signer ? { signature: signer.sign(body) } : {}),
  };
  await storage.putObject(
    rollbackDirectiveKey(channel, platform, runtimeVersion),
    JSON.stringify(directive, null, 2),
    'application/json',
  );
}
