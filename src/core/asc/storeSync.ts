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

import { errorMessage } from "../errorMessage.js";
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
    action.error = errorMessage(error);
  }
}

/**
 * Record a planned action and return its handle so the caller marks it `applied`/`failed` after running.
 * The manual-status twin of {@link act} (which records-then-runs in one call): use this when a single
 * logical step writes more than once — e.g. create-then-publish — and each write needs its own status.
 */
export function plan(ctx: ReconcileContext, description: string): PlannedAction {
  const action: PlannedAction = { description, destructive: false, status: "planned" };
  ctx.actions.push(action);
  return action;
}

/**
 * The actionable error a **write-path** reconciler throws when an app has no App Store Connect record:
 * Apple has no API to create the app, so the user must create it once in the portal, then re-run the
 * command. Keyed by `command` (e.g. `"accessibility"`) so the message names the exact `launch` subcommand
 * to retry. Read-only commands use {@link appRecordNotFound} instead.
 */
export function appRecordMissing(bundleId: string, command: string): Error {
  return new Error(
    `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
      `(Apple has no API to create the app record), then re-run \`launch ${command}\`.`,
  );
}

/**
 * The error a **read-path** command throws when an app has no App Store Connect record. Unlike
 * {@link appRecordMissing} it offers no "create then re-run" remedy — a report can't proceed without an
 * existing app — so it asks the user to confirm the bundle id and their access instead.
 */
export function appRecordNotFound(bundleId: string): Error {
  return new Error(
    `No App Store Connect app record for ${bundleId}. Confirm the bundle id and that this account ` +
      `can access the app (Apple has no API to create an app record — it's created once in App Store Connect).`,
  );
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
