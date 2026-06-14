/**
 * The APNs push-key vault — Launch's safe store for the `.p8` authentication keys a backend uses to
 * send push notifications.
 *
 * Apple has NO API to create an APNs auth key (it's a download-once, portal-only key, capped at 2 per
 * account), so Launch can't mint one — it can only safeguard a key you already downloaded. This module
 * is the single source of truth for the vault: non-secret metadata ({@link ApnsKeyRecord}) lives in
 * `~/.launch/push-keys.json`; each key's `.p8` PEM stays in the OS secret store under `apns-p8:<keyId>`,
 * never on disk. Launch never *uses* these keys (push happens from your backend); it vaults, lists, and
 * re-exports them so a download-once secret isn't lost. The `.p8` is base64-encoded via the same
 * {@link encodeP8}/{@link decodeP8} the ASC key uses, so a multi-line PEM round-trips on every OS backend.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ApnsKeyRecord } from "./types.js";
import { LAUNCH_HOME, PUSH_KEYS_FILE, ensureDir } from "./paths.js";
import { getSecret, setSecret } from "./keychain.js";
import { decodeP8, encodeP8 } from "./accounts.js";

/** Secret-store account holding one APNs key's `.p8` PEM, namespaced by Key ID. */
function apnsAccount(keyId: string): string {
  return `apns-p8:${keyId}`;
}

/** ISO-8601 stamp for `importedAt`. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Read the vault index, returning an empty list when the file is absent or malformed. */
export function listPushKeys(): ApnsKeyRecord[] {
  if (!existsSync(PUSH_KEYS_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(PUSH_KEYS_FILE, "utf8")) as { keys?: ApnsKeyRecord[] };
    return Array.isArray(parsed.keys) ? parsed.keys : [];
  } catch {
    return [];
  }
}

/** Write the vault index back to disk (pretty-printed; non-secret metadata only). */
function writePushKeys(keys: ApnsKeyRecord[]): void {
  ensureDir(LAUNCH_HOME);
  writeFileSync(PUSH_KEYS_FILE, JSON.stringify({ keys }, null, 2));
}

/** Find a vaulted key by Key ID, case-insensitively (Apple's Key IDs are upper-case). */
export function findPushKey(keyId: string): ApnsKeyRecord | undefined {
  const needle = keyId.trim().toLowerCase();
  return listPushKeys().find((key) => key.keyId.toLowerCase() === needle);
}

/** Inputs to {@link importPushKey}. */
export interface ImportPushKeyInput {
  keyId: string;
  /** PEM contents of the `.p8`. Stored (base64) in the OS secret store, never on disk. */
  p8: string;
  teamId?: string;
  label?: string;
}

/**
 * Import (or replace) an APNs key: the `.p8` goes to the OS secret store, the metadata to the vault
 * index. Re-importing an existing Key ID updates it in place (keeping its original `importedAt`), so
 * re-importing with a new label or team never creates a duplicate.
 */
export async function importPushKey(input: ImportPushKeyInput): Promise<ApnsKeyRecord> {
  await setSecret(apnsAccount(input.keyId), encodeP8(input.p8));
  const keys = listPushKeys();
  const existing = keys.find((key) => key.keyId === input.keyId);
  const record: ApnsKeyRecord = {
    keyId: input.keyId,
    importedAt: existing?.importedAt ?? nowIso(),
    ...(input.teamId ? { teamId: input.teamId } : {}),
    ...(input.label ? { label: input.label } : {}),
  };
  writePushKeys(existing ? keys.map((key) => (key.keyId === input.keyId ? record : key)) : [...keys, record]);
  return record;
}

/** Load one APNs key's `.p8` PEM from the secret store, or null if absent — the export path. */
export async function loadPushKey(keyId: string): Promise<string | null> {
  const stored = await getSecret(apnsAccount(keyId));
  return stored ? decodeP8(stored) : null;
}
