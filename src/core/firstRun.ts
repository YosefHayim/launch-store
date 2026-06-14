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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { STATE_FILE, LAUNCH_HOME, ensureDir } from "./paths.js";

/**
 * Shape of `~/.launch/state.json`.
 *
 * `tourSeenAt` is an ISO-8601 timestamp set the first time the walkthrough plays; its presence is the
 * "has seen the tour" signal. Kept as a distinct field (not a bare boolean) so the value is also a
 * useful breadcrumb when debugging onboarding.
 */
export interface FirstRunState {
  /** When the first-run tour was shown, ISO-8601. Absent until it plays once. */
  tourSeenAt?: string;
}

/** Read first-run state, tolerating a missing or malformed file (returns an empty state). */
export function readFirstRunState(): FirstRunState {
  if (!existsSync(STATE_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<FirstRunState>;
    return parsed.tourSeenAt ? { tourSeenAt: parsed.tourSeenAt } : {};
  } catch {
    return {};
  }
}

/** Whether the first-run tour has already been shown on this machine. */
export function hasSeenTour(): boolean {
  return readFirstRunState().tourSeenAt !== undefined;
}

/** Record that the tour has been shown, so `launch` (no args) won't auto-play it again. */
export function markTourSeen(): void {
  ensureDir(LAUNCH_HOME);
  writeFileSync(STATE_FILE, JSON.stringify({ tourSeenAt: new Date().toISOString() }, null, 2));
}
