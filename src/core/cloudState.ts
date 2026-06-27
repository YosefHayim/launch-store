/**
 * Machine-discovered remote-build state, persisted at `~/.launch/cloud.json`.
 *
 * Two things live here and nowhere else: the currently-live AWS host handle (so a later command can
 * reuse the paid window, show accrued cost, and release it) and the golden AMI id Launch built for
 * this machine (so subsequent allocations boot a ready toolchain instead of bootstrapping again).
 *
 * These are non-secret infra ids only — never `.env` (that's the shipped app's env), never committed,
 * and never secrets (the `.p8`/`.p12` stay in the OS keychain). The file is chmod-600 regardless.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { HostHandle } from './types.js';
import { CLOUD_STATE, LAUNCH_HOME, ensureDir } from './paths.js';

/**
 * Shape of `~/.launch/cloud.json`.
 *
 * `host` is present only while a remote host is live; `amiId` persists across sessions once Launch has
 * snapshotted a golden image (omitted when the user brings their own via `aws.amiId` in config).
 */
export interface CloudState {
  /** The live remote host, if one is currently allocated. */
  host?: HostHandle;
  /** Golden AMI id Launch created and reuses for this machine. */
  amiId?: string;
}

/** Read cloud state, tolerating a missing or malformed file (returns an empty state). */
export function readCloudState(): CloudState {
  if (!existsSync(CLOUD_STATE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CLOUD_STATE, 'utf8')) as Partial<CloudState>;
    return {
      ...(parsed.host ? { host: parsed.host } : {}),
      ...(parsed.amiId ? { amiId: parsed.amiId } : {}),
    };
  } catch {
    return {};
  }
}

/** Write cloud state back to disk (chmod 600). */
export function writeCloudState(state: CloudState): void {
  ensureDir(LAUNCH_HOME);
  writeFileSync(CLOUD_STATE, JSON.stringify(state, null, 2));
  chmodSync(CLOUD_STATE, 0o600);
}

/** The live remote host handle, or null if none is allocated. */
export function getLiveHost(): HostHandle | null {
  return readCloudState().host ?? null;
}

/** Record the live host (called right after a successful allocation). */
export function setLiveHost(host: HostHandle): void {
  writeCloudState({ ...readCloudState(), host });
}

/** Forget the live host (called after a successful teardown/release). */
export function clearLiveHost(): void {
  const { amiId } = readCloudState();
  writeCloudState(amiId ? { amiId } : {});
}

/** The golden AMI id Launch built for this machine, or null. */
export function getAmiId(): string | null {
  return readCloudState().amiId ?? null;
}

/** Persist the golden AMI id after snapshotting it, so later allocations reuse it. */
export function setAmiId(amiId: string): void {
  writeCloudState({ ...readCloudState(), amiId });
}
