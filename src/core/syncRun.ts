/**
 * The headless reconcile engine shared by `launch sync` (the CLI) and the `sync` MCP tools.
 *
 * `launch sync` answers "make App Store Connect match `launch.config.ts`" for one app at a time:
 * reconcile the product catalog (capabilities, IAPs, subscriptions, pricing) plus the textual listing,
 * screenshots, and preview videos. That per-app work is {@link reconcileJob} — a total function (it never
 * throws; a precondition failure becomes a `{ error }` outcome) so a batch over many apps reports a
 * per-app result instead of dying on the first failure.
 *
 * The CLI wraps {@link reconcileJob} in an interactive choreography (plan → print → confirm → apply); the
 * MCP server can't prompt over the stdio transport, so it calls {@link runSyncBatch} — the SAME plan-then-
 * apply passes with the human step removed (opting the server into the `write` tier IS the consent) — and
 * returns the structured {@link SyncRunReport}. Both share the one reconcile implementation here so a fix
 * lands in both surfaces at once; only the human-in-the-loop differs.
 */

import { reconcileApp, type PlannedAction, type ReconcileReport, type AscCatalogApi } from "./ascSync.js";
import {
  reconcilePreviews,
  reconcileScreenshots,
  type PreviewsApi,
  type ScreenshotsApi,
  type SubscriptionReviewScreenshot,
} from "./ascScreenshots.js";
import { fingerprintAsset } from "./screenshotAssets.js";
import { runPool, type PoolResult } from "./asyncPool.js";
import type { SyncJob } from "./syncJobs.js";

/** How many apps reconcile concurrently. Bounded so the single ASC key stays under Apple's rate ceiling. */
export const SYNC_CONCURRENCY = 4;

/**
 * The slice of the App Store Connect client a sync reconcile touches: the catalog surface plus the
 * screenshot and preview surfaces. Declared as the intersection of the three narrow reconciler interfaces
 * (rather than the concrete `AppStoreConnectClient`) so callers can hand it a test fake, and so this module
 * never depends on the full client class — the concrete client structurally satisfies it.
 */
export type SyncCatalogClient = AscCatalogApi & ScreenshotsApi & PreviewsApi;

/**
 * One app's reconcile outcome, carrying its own job so we never index a parallel array. A precondition
 * failure (e.g. no ASC app record) lands in `error`; otherwise `report` holds the planned/applied actions.
 */
export type JobOutcome = { job: SyncJob; report: ReconcileReport } | { job: SyncJob; error: string };

/** Per-app entry in a {@link SyncRunReport}: the app's handle and bundle id, plus its outcome. */
export interface SyncAppReport {
  /** The app's CLI handle (`AppDescriptor.name`). */
  app: string;
  /** The app's iOS bundle id. */
  bundleId: string;
  /** Set on a precondition failure (e.g. no ASC app record); `actions` and `summary` are then omitted. */
  error?: string;
  /** Every action with its final status (`applied`/`skipped`/`failed`), in order. Omitted when `error` is set. */
  actions?: PlannedAction[];
  /** Tally of this app's action statuses. Omitted when `error` is set. */
  summary?: { applied: number; failed: number; skipped: number };
}

/**
 * The structured result of a headless {@link runSyncBatch} — what the MCP `sync` tools return as JSON. A
 * per-app breakdown plus a roll-up across all apps, so an agent can both see what changed on each app and
 * gate on the totals (any `failed` or `planErrors` means the run needs attention).
 */
export interface SyncRunReport {
  /** Per-app outcomes, in input order. */
  apps: SyncAppReport[];
  /** Roll-up across all apps: app count, summed action statuses, and apps that failed to even plan. */
  summary: { apps: number; applied: number; failed: number; skipped: number; planErrors: number };
}

/**
 * Run the screenshot/asset pass for one app, returning its actions. Isolated in its own try/catch so a
 * screenshot failure is one failed action rather than discarding the (already-applied) catalog actions.
 * Declared subscription review screenshots are fingerprinted here (the filesystem read), recording an
 * actionable skip for any missing file before the pure reconciler runs.
 */
async function screenshotActions(
  client: ScreenshotsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<PlannedAction[]> {
  if (job.screenshots.length === 0 && job.subscriptionReviewScreenshots.length === 0) return [];
  try {
    const subscriptionReviewScreenshots: SubscriptionReviewScreenshot[] = [];
    const missing: PlannedAction[] = [];
    for (const { productId, relPath } of job.subscriptionReviewScreenshots) {
      const asset = fingerprintAsset(job.app.dir, relPath);
      if (!asset) {
        missing.push({
          description: `subscription review screenshot ${productId}: file not found at ${relPath} — skipped`,
          destructive: false,
          status: "skipped",
        });
        continue;
      }
      subscriptionReviewScreenshots.push({ productId, asset });
    }
    const actions = await reconcileScreenshots(client, {
      bundleId: job.bundleId,
      screenshots: job.screenshots,
      subscriptionReviewScreenshots,
      dryRun,
      allowDestructive,
    });
    return [...missing, ...actions];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ description: `screenshots: ${message}`, destructive: false, status: "failed", error: message }];
  }
}

/**
 * Run the app-preview-video pass for one app, returning its actions. Isolated in its own try/catch (like
 * {@link screenshotActions}) so a preview failure is one recorded action, not a lost report. Previews are
 * fingerprinted at discovery, so this pass is a pure reconcile with no filesystem read.
 */
async function previewActions(
  client: PreviewsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<PlannedAction[]> {
  if (job.previews.length === 0) return [];
  try {
    return await reconcilePreviews(client, {
      bundleId: job.bundleId,
      previews: job.previews,
      dryRun,
      allowDestructive,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{ description: `previews: ${message}`, destructive: false, status: "failed", error: message }];
  }
}

/**
 * The screenshot + preview-video asset reconcile for one app, as a single ordered action list. This is the
 * asset half of {@link reconcileJob}, factored out so `launch plan`'s screenshots surface can dry-run
 * exactly the passes `launch sync` applies — including the subscription-review-screenshot fingerprinting and
 * per-pass error isolation — without re-deriving them. Catalog and listing are intentionally excluded; each
 * is its own plan surface. Total: a pass failure is captured as a `failed` action, never thrown.
 */
export async function reconcileAssetActions(
  client: ScreenshotsApi & PreviewsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<PlannedAction[]> {
  return [
    ...(await screenshotActions(client, job, dryRun, allowDestructive)),
    ...(await previewActions(client, job, dryRun, allowDestructive)),
  ];
}

/** Reconcile one job, never throwing: a thrown precondition becomes `{ error }` so the pool stays whole. */
export async function reconcileJob(
  client: SyncCatalogClient,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<JobOutcome> {
  try {
    const report = await reconcileApp(client, {
      bundleId: job.bundleId,
      capabilities: job.capabilities,
      products: job.products,
      ...(job.listing ? { listing: job.listing } : {}),
      dryRun,
      allowDestructive,
    });
    report.actions.push(...(await reconcileAssetActions(client, job, dryRun, allowDestructive)));
    return { job, report };
  } catch (error) {
    return { job, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Tally a report's action statuses for the run summary. */
export function summarize(report: ReconcileReport): { applied: number; failed: number; skipped: number } {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of report.actions) {
    if (action.status === "applied") applied++;
    else if (action.status === "failed") failed++;
    else if (action.status === "skipped") skipped++;
  }
  return { applied, failed, skipped };
}

/** Project a list of per-app outcomes into the structured {@link SyncRunReport} the MCP tools return. */
export function summarizeRun(outcomes: readonly JobOutcome[]): SyncRunReport {
  const apps: SyncAppReport[] = [];
  const roll = { apps: outcomes.length, applied: 0, failed: 0, skipped: 0, planErrors: 0 };
  for (const outcome of outcomes) {
    const head = { app: outcome.job.app.name, bundleId: outcome.job.bundleId };
    if ("error" in outcome) {
      roll.planErrors++;
      apps.push({ ...head, error: outcome.error });
      continue;
    }
    const summary = summarize(outcome.report);
    roll.applied += summary.applied;
    roll.failed += summary.failed;
    roll.skipped += summary.skipped;
    apps.push({ ...head, actions: outcome.report.actions, summary });
  }
  return { apps, summary: roll };
}

/** Whether a plan outcome found real work — at least one `planned` action to apply. */
function hasPlannedAction(outcome: JobOutcome): boolean {
  return "report" in outcome && outcome.report.actions.some((action) => action.status === "planned");
}

/** Unwrap a pool's results, dropping any non-`ok` entry (reconcileJob is total, so this never fires today). */
function poolValues(results: readonly PoolResult<JobOutcome>[]): JobOutcome[] {
  return results.flatMap((result) => (result.ok ? [result.value] : []));
}

/** Overlay each plan outcome with its apply-pass result (matched by job), leaving already-in-sync apps as planned. */
export function mergeOutcomes(plans: readonly JobOutcome[], applied: readonly JobOutcome[]): JobOutcome[] {
  const byJob = new Map<SyncJob, JobOutcome>(applied.map((outcome) => [outcome.job, outcome]));
  return plans.map((plan) => byJob.get(plan.job) ?? plan);
}

/**
 * Reconcile a batch of jobs headlessly: a read-only PLAN pass over all jobs, then an APPLY pass over only
 * the jobs that planned real work, both behind the bounded {@link SYNC_CONCURRENCY} pool. The MCP `sync`
 * tools call this; it makes the writes (no `--dry-run` arm — `plan`/`drift` already cover rehearsal) and
 * never prompts. `allowDestructive` permits capability removals — the `dangerous`-tier tool passes `true`,
 * the `write`-tier tool passes `false`.
 */
export async function runSyncBatch(
  client: SyncCatalogClient,
  jobs: readonly SyncJob[],
  allowDestructive: boolean,
): Promise<SyncRunReport> {
  const plans = poolValues(
    await runPool(jobs, SYNC_CONCURRENCY, (job) => reconcileJob(client, job, true, allowDestructive)),
  );
  const toApply = plans.flatMap((outcome) => (hasPlannedAction(outcome) ? [outcome.job] : []));
  const applied = poolValues(
    await runPool(toApply, SYNC_CONCURRENCY, (job) => reconcileJob(client, job, false, allowDestructive)),
  );
  return summarizeRun(mergeOutcomes(plans, applied));
}
