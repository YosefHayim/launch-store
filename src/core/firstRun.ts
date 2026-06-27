/**
 * First-run UX state, persisted at `~/.launch/state.json`.
 *
 * The no-args `launch` front door plays a one-time walkthrough (see `tour.ts`) the very first time a
 * user runs it interactively. This module is the marker that makes it *once*: it records when the tour
 * was shown so every later `launch` goes straight to the wizard menu. Users can always replay it with
 * `launch demo`.
 *
 * Non-secret and host-local — a single timestamp, nothing else. Missing or malformed file reads as
 * "never seen," so a corrupted state can only ever cost one extra tour, never a crash.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STATE_FILE, LAUNCH_HOME, ensureDir } from './paths.js';

/**
 * Shape of `~/.launch/state.json` — small "offered once, remember" UX flags, each an ISO-8601 timestamp
 * (a distinct value rather than a bare boolean so it doubles as a debugging breadcrumb).
 *
 * `tourSeenAt` is set the first time the walkthrough plays; its presence is the "has seen the tour"
 * signal. `ccacheOfferDeclinedAt` is set when a build's inline "install ccache?" offer is declined, so
 * later builds show only a quiet one-line notice instead of re-prompting.
 */
export interface FirstRunState {
  /** When the first-run tour was shown, ISO-8601. Absent until it plays once. */
  tourSeenAt?: string;
  /** When the inline ccache install offer was declined, ISO-8601. Absent until declined once. */
  ccacheOfferDeclinedAt?: string;
}

/** Read first-run state, tolerating a missing or malformed file (returns an empty state). */
export function readFirstRunState(): FirstRunState {
  if (!existsSync(STATE_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<FirstRunState>;
    const state: FirstRunState = {};
    if (parsed.tourSeenAt) state.tourSeenAt = parsed.tourSeenAt;
    if (parsed.ccacheOfferDeclinedAt) state.ccacheOfferDeclinedAt = parsed.ccacheOfferDeclinedAt;
    return state;
  } catch {
    return {};
  }
}

/** Merge one field into `state.json`, preserving the others (so two unrelated flags never clobber). */
function patchFirstRunState(patch: Partial<FirstRunState>): void {
  ensureDir(LAUNCH_HOME);
  writeFileSync(STATE_FILE, JSON.stringify({ ...readFirstRunState(), ...patch }, null, 2));
}

/** Whether the first-run tour has already been shown on this machine. */
export function hasSeenTour(): boolean {
  return readFirstRunState().tourSeenAt !== undefined;
}

/** Record that the tour has been shown, so `launch` (no args) won't auto-play it again. */
export function markTourSeen(): void {
  patchFirstRunState({ tourSeenAt: new Date().toISOString() });
}

/** Whether the user has declined the inline ccache install offer (→ show the quiet notice, don't re-prompt). */
export function ccacheOfferDeclined(): boolean {
  return readFirstRunState().ccacheOfferDeclinedAt !== undefined;
}

/** Record that the inline ccache offer was declined, so future builds never prompt for it again. */
export function markCcacheOfferDeclined(): void {
  patchFirstRunState({ ccacheOfferDeclinedAt: new Date().toISOString() });
}
