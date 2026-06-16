/**
 * The readiness-probe registry — the same "implement an interface + register it" seam the provider,
 * adopter, and surface-planner registries use, scoped to the readiness layer. The orchestrator walks
 * {@link selectReadinessProbes} and never names a concrete probe, so adding a check (or a whole new
 * command's worth of checks) is a new probe file plus one {@link registerReadinessProbe} line in
 * {@link registerBuiltinProbes} — the orchestrator and every existing command are untouched.
 */

import type { ReadinessCategory, ReadinessProbe } from "./types.js";
import { appRecordProbe } from "./probes/appRecord.js";
import { subscriptionGroupProbe } from "./probes/subscriptionGroup.js";
import { playAppProbe } from "./probes/playApp.js";
import { playFirstUploadProbe } from "./probes/playFirstUpload.js";
import { playInternalTrackProbe } from "./probes/playInternalTrack.js";

/** Registered probes, keyed by id so re-registering one replaces it (idempotent built-in wiring). */
const PROBES = new Map<string, ReadinessProbe>();

/** Register (or replace) a readiness probe by its id. */
export function registerReadinessProbe(probe: ReadinessProbe): void {
  PROBES.set(probe.id, probe);
}

/** Every registered probe, in registration order. */
export function listReadinessProbes(): ReadinessProbe[] {
  return [...PROBES.values()];
}

/**
 * The probes tagged with `category`, in registration order — how a command selects its slice
 * (store doctor passes `account`, iap doctor `iap`, …). A probe tagged with several categories appears
 * in each one's selection.
 */
export function selectReadinessProbes(category: ReadinessCategory): ReadinessProbe[] {
  return listReadinessProbes().filter((probe) => probe.categories.includes(category));
}

/**
 * Register the built-in probes. Idempotent: safe to call from a command entry and from tests without
 * duplicating. The trust-layer account probes wire in here; the audit and iap-doctor probes join them as
 * those commands land.
 */
export function registerBuiltinProbes(): void {
  registerReadinessProbe(appRecordProbe);
  registerReadinessProbe(subscriptionGroupProbe);
  registerReadinessProbe(playAppProbe);
  registerReadinessProbe(playFirstUploadProbe);
  registerReadinessProbe(playInternalTrackProbe);
}
