import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { reconcileApp, type AscCatalogApi, type ReconcileInput } from './ascSync.js';
import type { PlannedAction, ReconcileReport } from '../types/reconcile.js';
import {
  reconcilePreviews,
  reconcileScreenshots,
  type PreviewsApi,
  type ScreenshotsApi,
  type SubscriptionReviewScreenshot,
} from './ascScreenshots.js';
import { fingerprintAsset } from '../listing/screenshots/assets.js';
import type { SyncJob } from './syncJobs.js';
/** How many apps reconcile concurrently. Bounded so the single ASC key stays under Apple's rate ceiling. */
export const SYNC_CONCURRENCY = 4;
/**
 * The slice of the App Store Connect client a sync reconcile touches: the catalog surface plus the
 * screenshot and preview surfaces. Declared as the intersection of the three narrow reconciler interfaces
 * (rather than the concrete `AppStoreConnectClient`) so callers can hand it a test fake, and so this module
 * never depends on the full client class - the concrete client structurally satisfies it.
 */
export type SyncCatalogClient = AscCatalogApi & ScreenshotsApi & PreviewsApi;
/**
 * One app's reconcile outcome, carrying its own job so we never index a parallel array. A precondition
 * failure (e.g. no ASC app record) lands in `error`; otherwise `report` holds the planned/applied actions.
 */
export type JobOutcome =
  | {
      job: SyncJob;
      report: ReconcileReport;
    }
  | {
      job: SyncJob;
      error: string;
    };
/** Per-app entry in a {@link SyncRunReport}: the app's handle and bundle id, plus its outcome. */
export type SyncAppReport = {
  app: string;
  bundleId: string;
  error?: string;
  actions?: readonly PlannedAction[];
  summary?: {
    applied: number;
    failed: number;
    skipped: number;
  };
};
/**
 * The structured result of a headless {@link runSyncBatch} - what the MCP `sync` tools return as JSON. A
 * per-app breakdown plus a roll-up across all apps, so an agent can both see what changed on each app and
 * gate on the totals (any `failed` or `planErrors` means the run needs attention).
 */
export type SyncRunReport = {
  apps: SyncAppReport[];
  summary: {
    apps: number;
    applied: number;
    failed: number;
    skipped: number;
    planErrors: number;
  };
};
/**
 * Run the screenshot/asset pass for one app, returning its actions. Isolated in its own try/catch so a
 * screenshot failure is one failed action rather than discarding the (already-applied) catalog actions.
 * Declared subscription review screenshots are fingerprinted here (the filesystem read), recording an
 * actionable skip for any missing file before the pure reconciler runs.
 */
const failureMessage = (failure: unknown): string => {
  if (failure instanceof Error) return failure.message;
  return String(failure);
};

const screenshotActions = (
  client: ScreenshotsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Effect.Effect<PlannedAction[], never, FileSystem.FileSystem | Path.Path> => {
  if (job.screenshots.length === 0 && job.subscriptionReviewScreenshots.length === 0)
    return Effect.succeed([]);
  return Effect.gen(function* () {
    const subscriptionReviewScreenshots: SubscriptionReviewScreenshot[] = [];
    const missingActions: PlannedAction[] = [];
    for (const { productId, relPath } of job.subscriptionReviewScreenshots) {
      const asset = yield* fingerprintAsset(job.app.dir, relPath);
      if (asset === null) {
        missingActions.push({
          description: `subscription review screenshot ${productId}: file not found at ${relPath} - skipped`,
          destructive: false,
          status: 'skipped',
        });
        continue;
      }
      subscriptionReviewScreenshots.push({ productId, asset });
    }
    const screenshotReconcileActions = yield* reconcileScreenshots(client, {
      bundleId: job.bundleId,
      screenshots: job.screenshots,
      subscriptionReviewScreenshots,
      dryRun,
      allowDestructive,
    });
    return [...missingActions, ...screenshotReconcileActions];
  }).pipe(
    Effect.catchAll((failure) => {
      const message = failureMessage(failure);
      return Effect.succeed([
        {
          description: `screenshots: ${message}`,
          destructive: false,
          status: 'failed' as const,
          error: message,
        },
      ]);
    }),
  );
};
/**
 * Run the app-preview-video pass for one app, returning its actions. Isolated in its own try/catch (like
 * {@link screenshotActions}) so a preview failure is one recorded action, not a lost report. Previews are
 * fingerprinted at discovery, so this pass is a pure reconcile with no filesystem read.
 */
const previewActions = (
  client: PreviewsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Effect.Effect<PlannedAction[]> => {
  if (job.previews.length === 0) return Effect.succeed([]);
  return reconcilePreviews(client, {
    bundleId: job.bundleId,
    previews: job.previews,
    dryRun,
    allowDestructive,
  }).pipe(
    Effect.catchAll((failure) => {
      const message = failureMessage(failure);
      return Effect.succeed([
        {
          description: `previews: ${message}`,
          destructive: false,
          status: 'failed' as const,
          error: message,
        },
      ]);
    }),
  );
};
/**
 * The screenshot + preview-video asset reconcile for one app, as a single ordered action list. This is the
 * asset half of {@link reconcileJob}, factored out so `launch plan`'s screenshots surface can dry-run
 * exactly the passes `launch sync` applies - including the subscription-review-screenshot fingerprinting and
 * per-pass error isolation - without re-deriving them. Catalog and listing are intentionally excluded; each
 * is its own plan surface. Total: a pass failure is captured as a `failed` action, never thrown.
 */
export const reconcileAssetActions = (
  client: ScreenshotsApi & PreviewsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Effect.Effect<PlannedAction[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const screenshotReconcileActions = yield* screenshotActions(
      client,
      job,
      dryRun,
      allowDestructive,
    );
    const previewReconcileActions = yield* previewActions(client, job, dryRun, allowDestructive);
    return [...screenshotReconcileActions, ...previewReconcileActions];
  });
/** Reconcile one job, never throwing: a thrown precondition becomes `{ error }` so the pool stays whole. */
export const reconcileJob = (
  client: SyncCatalogClient,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Effect.Effect<JobOutcome, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const reconcileInput: ReconcileInput = {
      bundleId: job.bundleId,
      capabilities: job.capabilities,
      products: job.products,
      dryRun,
      allowDestructive,
    };
    if (job.listing) reconcileInput.listing = job.listing;
    const report = yield* reconcileApp(client, reconcileInput);
    const assetActions = yield* reconcileAssetActions(client, job, dryRun, allowDestructive);
    return {
      job,
      report: {
        ...report,
        actions: [...report.actions, ...assetActions],
      },
    };
  }).pipe(
    Effect.catchAll((failure) =>
      Effect.succeed({
        job,
        error: failureMessage(failure),
      }),
    ),
  );
/** Tally a report's action statuses for the run summary. */
export const summarize = (
  report: ReconcileReport,
): {
  applied: number;
  failed: number;
  skipped: number;
} => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of report.actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
};
/** Project a list of per-app outcomes into the structured {@link SyncRunReport} the MCP tools return. */
export const summarizeRun = (outcomes: readonly JobOutcome[]): SyncRunReport => {
  const apps: SyncAppReport[] = [];
  const roll = { apps: outcomes.length, applied: 0, failed: 0, skipped: 0, planErrors: 0 };
  for (const outcome of outcomes) {
    const head = { app: outcome.job.app.name, bundleId: outcome.job.bundleId };
    if ('error' in outcome) {
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
};
/** Whether a plan outcome found real work - at least one `planned` action to apply. */
const hasPlannedAction = (outcome: JobOutcome): boolean => {
  return (
    'report' in outcome && outcome.report.actions.some((action) => action.status === 'planned')
  );
};
/** Overlay each plan outcome with its apply-pass result (matched by job), leaving already-in-sync apps as planned. */
export const mergeOutcomes = (
  plans: readonly JobOutcome[],
  applied: readonly JobOutcome[],
): JobOutcome[] => {
  const byJob = new Map<SyncJob, JobOutcome>(applied.map((outcome) => [outcome.job, outcome]));
  return plans.map((plan) => {
    const appliedOutcome = byJob.get(plan.job);
    if (appliedOutcome === undefined) return plan;
    return appliedOutcome;
  });
};
/**
 * Reconcile a batch of jobs headlessly: a read-only PLAN pass over all jobs, then an APPLY pass over only
 * the jobs that planned real work, both behind the bounded {@link SYNC_CONCURRENCY} pool. The MCP `sync`
 * tools call this; it makes the writes (no `--dry-run` arm - `plan`/`drift` already cover rehearsal) and
 * never prompts. `allowDestructive` permits capability removals - the `dangerous`-tier tool passes `true`,
 * the `write`-tier tool passes `false`.
 */
export const runSyncBatch = (
  client: SyncCatalogClient,
  jobs: readonly SyncJob[],
  allowDestructive: boolean,
): Effect.Effect<SyncRunReport, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const plans = yield* Effect.forEach(
      jobs,
      (job) => reconcileJob(client, job, true, allowDestructive),
      { concurrency: SYNC_CONCURRENCY },
    );
    const jobsToApply: SyncJob[] = [];
    for (const planOutcome of plans) {
      if (hasPlannedAction(planOutcome)) jobsToApply.push(planOutcome.job);
    }
    const applied = yield* Effect.forEach(
      jobsToApply,
      (job) => reconcileJob(client, job, false, allowDestructive),
      { concurrency: SYNC_CONCURRENCY },
    );
    return summarizeRun(mergeOutcomes(plans, applied));
  });
