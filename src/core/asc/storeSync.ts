/**
 * Shared **store-sync reconcile vocabulary** for the per-feature App Store Connect reconcilers —
 * `walletIds`, `euDistribution`, `releaseAttrs`, `appClips`, `gameCenter`, and their siblings. Each
 * builds a list of {@link PlannedAction}s in a read-only PLAN pass, prints it, then performs them in an
 * APPLY pass, and every one needs the same primitives: a {@link ReconcileContext} to thread, an
 * {@link act} that records-then-runs (capturing failures so one bad item never aborts the walk), a
 * {@link skip} for a sub-area that can't be acted on yet, and a {@link summarize} tally for the run
 * footer. They live here so there's one copy instead of one per feature.
 *
 * This is the *simple* twin of the richer generic `act<T>` in `core/ascSync.ts`: these feature
 * reconcilers only ever create/update (never destructive) and don't need the created resource's id back,
 * so they take the smaller, void-returning {@link act}. `ascSync.ts` keeps its destructive-aware,
 * value-returning `act<T>` for the catalog reconciler. {@link PlannedAction} (its shape) is re-exported
 * here so a reconciler imports the whole vocabulary from one place.
 */

import type { PlannedAction } from "../ascSync.js";

export type { PlannedAction };

/**
 * Mutable per-run context threaded through a reconcile walk: the actions collected so far — which become
 * the plan in a dry-run and the applied summary after — plus the dry-run flag {@link act} consults.
 */
export interface ReconcileContext {
  /** Actions recorded so far, in order. */
  actions: PlannedAction[];
  /** Rehearse only: record each action as `planned` and perform no writes. */
  dryRun: boolean;
}

/**
 * Record an action and, unless this is a dry-run, perform it. A thrown error is captured on the action
 * (status `failed`) rather than propagated, so one bad item never aborts the rest of the walk. These
 * reconcilers are never destructive, so — unlike `ascSync`'s generic `act<T>` — there's no
 * `destructive` / `allowDestructive` gate and no return value.
 */
export async function act(ctx: ReconcileContext, description: string, run: () => Promise<void>): Promise<void> {
  const action: PlannedAction = { description, destructive: false, status: "planned" };
  ctx.actions.push(action);
  if (ctx.dryRun) return;
  try {
    await run();
    action.status = "applied";
  } catch (error) {
    action.status = "failed";
    action.error = error instanceof Error ? error.message : String(error);
  }
}

/** Record a sub-area we can't act on yet (e.g. no editable version, or the clip's build isn't uploaded) as a skip with a reason. */
export function skip(ctx: ReconcileContext, description: string): void {
  ctx.actions.push({ description, destructive: false, status: "skipped" });
}

/** Tally a reconcile report's action statuses for the run-summary footer (applied / failed / skipped). */
export function summarize(actions: PlannedAction[]): { applied: number; failed: number; skipped: number } {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === "applied") applied++;
    else if (action.status === "failed") failed++;
    else if (action.status === "skipped") skipped++;
  }
  return { applied, failed, skipped };
}
