/**
 * Remembered interactive build picks, persisted at `~/.launch/last-run.json`.
 *
 * After a successful build Launch records the choices a re-run would otherwise re-ask — which app was
 * built, and the version-bump kind — so the next `launch build` defaults to them instead of prompting
 * from scratch. The app pick is pre-selected (you still confirm it); the bump auto-applies (override with
 * `--bump`). This is host-local convenience only: a default you want to *commit and share* belongs in the
 * declarative `launch.config.ts`, never here — which is why this file is auto-written and gitignore-able.
 *
 * Non-secret and tolerant: a missing or malformed file reads as "nothing remembered," so a corrupted
 * state can only ever cost one extra prompt, never a crash. Writes merge (read-modify-write) so recording
 * one app's bump never clobbers another's.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LAST_RUN_FILE, ensureDir } from "./paths.js";
import type { BumpKind } from "./version.js";

/** What a single app remembers between runs. Sparse — only fields the user actually chose appear. */
interface AppMemory {
  /** The version-bump kind last applied for this app, auto-applied next time. Absent ⇒ prompt. */
  bump?: BumpKind;
}

/**
 * Shape of `~/.launch/last-run.json`. `lastApp` is global (the picker pre-selects it across the repo);
 * per-app memory is keyed by the app handle ({@link import("./types.js").AppDescriptor.name}).
 */
export interface LastRunState {
  /** The app built most recently — pre-selected as the default in a multi-app picker. */
  lastApp?: string;
  /** Per-app remembered picks, keyed by app handle. */
  apps: Record<string, AppMemory>;
}

/** Read remembered picks, tolerating a missing or malformed file (returns an empty, well-formed state). */
export function readLastRun(file: string = LAST_RUN_FILE): LastRunState {
  if (!existsSync(file)) return { apps: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LastRunState>;
    const state: LastRunState = { apps: parsed.apps ?? {} };
    if (parsed.lastApp) state.lastApp = parsed.lastApp;
    return state;
  } catch {
    return { apps: {} };
  }
}

/** The app built most recently, or undefined when nothing's been built yet. */
export function readLastApp(file: string = LAST_RUN_FILE): string | undefined {
  return readLastRun(file).lastApp;
}

/** The bump kind last applied for an app, or undefined when it has no remembered pick. */
export function readLastBump(appName: string, file: string = LAST_RUN_FILE): BumpKind | undefined {
  return readLastRun(file).apps[appName]?.bump;
}

/**
 * Record one successful build's picks. Always marks `appName` as the last app; updates that app's
 * remembered bump only when a kind was actually applied (a "Custom…" version or a non-prompting
 * `--yes`/CI run passes `undefined`, leaving any prior bump untouched). Merges over existing state.
 */
export function rememberLastRun(appName: string, bump?: BumpKind, file: string = LAST_RUN_FILE): void {
  const state = readLastRun(file);
  state.lastApp = appName;
  if (bump) state.apps[appName] = { ...state.apps[appName], bump };
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(state, null, 2));
}
