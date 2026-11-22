import { reconcileApp, type AscCatalogApi, type ReconcileInput } from '../apple/ascSync.ts';
import type { PlannedAction, ReconcileReport } from '../../types/reconcile.ts';
import {
  reconcilePreviews,
  reconcileScreenshots,
  type PreviewsApi,
  type ScreenshotsApi,
  type SubscriptionReviewScreenshot,
} from '../apple/ascScreenshots.ts';
import { fingerprintAsset } from '../../listing/screenshots/assets.ts';
import type { SyncJob } from './syncJobs.ts';

/** How many apps reconcile concurrently. Bounded so the single ASC key stays under Apple's rate ceiling. */
const SYNC_CONCURRENCY = 4;

/**
 * The slice of the App Store Connect client a sync reconcile touches: the catalog surface plus the
 * screenshot and preview surfaces.
 */
type SyncCatalogClient = AscCatalogApi & ScreenshotsApi & PreviewsApi;

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
type SyncAppReport = {
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
 * The structured result of a headless {@link runSyncBatch}. A per-app breakdown plus a roll-up across
 * all apps.
 */
type SyncRunReport = {
  apps: SyncAppReport[];
  summary: {
    apps: number;
    applied: number;
    failed: number;
    skipped: number;
    planErrors: number;
  };
};

function failureMessage(failure: unknown): string {
  if (failure instanceof Error) {
    return failure.message;
  }

  return String(failure);
}

async function mapWithConcurrency<Item, Mapped>(
  items: readonly Item[],
  concurrency: number,
  mapItem: (item: Item) => Promise<Mapped>,
): Promise<Mapped[]> {
  const mapped: Mapped[] = [];
  let nextIndex = 0;

  async function takeNext(): Promise<void> {
    const currentIndex = nextIndex;
    nextIndex += 1;
    const item = items[currentIndex];

    if (item == null) {
      return;
    }

    mapped[currentIndex] = await mapItem(item);
    await takeNext();
  }

  const workerCount = Math.min(concurrency, items.length);
  const workers: Promise<void>[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(takeNext());
  }

  await Promise.all(workers);

  return mapped;
}

function hasNoScreenshotWork(job: SyncJob): boolean {
  if (job.screenshots.length > 0) {
    return false;
  }

  if (job.subscriptionReviewScreenshots.length > 0) {
    return false;
  }

  return true;
}

function failedAssetAction(label: string, failure: unknown): PlannedAction {
  const message = failureMessage(failure);

  return {
    description: `${label}: ${message}`,
    destructive: false,
    status: 'failed',
    error: message,
  };
}

/**
 * Run the screenshot/asset pass for one app, returning its actions. Isolated so a screenshot failure
 * is one failed action rather than discarding the catalog actions.
 */
async function screenshotActions(
  client: ScreenshotsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<PlannedAction[]> {
  if (hasNoScreenshotWork(job)) {
    return [];
  }

  try {
    const subscriptionReviewScreenshots: SubscriptionReviewScreenshot[] = [];
    const missingActions: PlannedAction[] = [];

    for (const reviewScreenshot of job.subscriptionReviewScreenshots) {
      const asset = await fingerprintAsset(job.app.dir, reviewScreenshot.relPath);

      if (asset == null) {
        missingActions.push({
          description: `subscription review screenshot ${reviewScreenshot.productId}: file not found at ${reviewScreenshot.relPath} - skipped`,
          destructive: false,
          status: 'skipped',
        });
        continue;
      }

      subscriptionReviewScreenshots.push({ productId: reviewScreenshot.productId, asset });
    }

    const screenshotReconcileActions = await reconcileScreenshots(client, {
      bundleId: job.bundleId,
      screenshots: job.screenshots,
      subscriptionReviewScreenshots,
      dryRun,
      allowDestructive,
    });

    return [...missingActions, ...screenshotReconcileActions];
  } catch (failure) {
    return [failedAssetAction('screenshots', failure)];
  }
}

/**
 * Run the app-preview-video pass for one app, returning its actions. Isolated so a preview failure
 * is one recorded action, not a lost report.
 */
async function previewActions(
  client: PreviewsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<PlannedAction[]> {
  if (job.previews.length == 0) {
    return [];
  }

  try {
    return await reconcilePreviews(client, {
      bundleId: job.bundleId,
      previews: job.previews,
      dryRun,
      allowDestructive,
    });
  } catch (failure) {
    return [failedAssetAction('previews', failure)];
  }
}

/**
 * The screenshot + preview-video asset reconcile for one app, as a single ordered action list.
 * A pass failure is captured as a `failed` action, never thrown.
 */
export async function reconcileAssetActions(
  client: ScreenshotsApi & PreviewsApi,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<PlannedAction[]> {
  const screenshotReconcileActions = await screenshotActions(client, job, dryRun, allowDestructive);
  const previewReconcileActions = await previewActions(client, job, dryRun, allowDestructive);

  return [...screenshotReconcileActions, ...previewReconcileActions];
}

/** Reconcile one job, never throwing: a thrown precondition becomes `{ error }` so the pool stays whole. */
async function reconcileJob(
  client: SyncCatalogClient,
  job: SyncJob,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<JobOutcome> {
  try {
    const reconcileInput: ReconcileInput = {
      bundleId: job.bundleId,
      capabilities: job.capabilities,
      products: job.products,
      dryRun,
      allowDestructive,
    };

    if (job.listing != null) {
      reconcileInput.listing = job.listing;
    }

    const report = await reconcileApp(client, reconcileInput);
    const assetActions = await reconcileAssetActions(client, job, dryRun, allowDestructive);

    return {
      job,
      report: {
        ...report,
        actions: [...report.actions, ...assetActions],
      },
    };
  } catch (failure) {
    return {
      job,
      error: failureMessage(failure),
    };
  }
}

/** Tally a report's action statuses for the run summary. */
function summarize(report: ReconcileReport): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of report.actions) {
    if (action.status == 'applied') {
      applied += 1;
      continue;
    }

    if (action.status == 'failed') {
      failed += 1;
      continue;
    }

    if (action.status == 'skipped') {
      skipped += 1;
    }
  }

  return { applied, failed, skipped };
}

/** Project a list of per-app outcomes into the structured run report. */
export function summarizeRun(outcomes: readonly JobOutcome[]): SyncRunReport {
  const apps: SyncAppReport[] = [];
  const roll = { apps: outcomes.length, applied: 0, failed: 0, skipped: 0, planErrors: 0 };

  for (const outcome of outcomes) {
    const head = { app: outcome.job.app.name, bundleId: outcome.job.bundleId };

    if ('error' in outcome) {
      roll.planErrors += 1;
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

function isPlannedAction(action: PlannedAction): boolean {
  return action.status == 'planned';
}

/** Whether a plan outcome found real work - at least one `planned` action to apply. */
function hasPlannedAction(outcome: JobOutcome): boolean {
  if ('report' in outcome == false) {
    return false;
  }

  return outcome.report.actions.some(isPlannedAction);
}

function appliedOutcomeFor(byJob: Map<SyncJob, JobOutcome>) {
  return function overlayPlan(plan: JobOutcome): JobOutcome {
    const appliedOutcome = byJob.get(plan.job);

    if (appliedOutcome == null) {
      return plan;
    }

    return appliedOutcome;
  };
}

/** Overlay each plan outcome with its apply-pass result (matched by job). */
export function mergeOutcomes(
  plans: readonly JobOutcome[],
  applied: readonly JobOutcome[],
): JobOutcome[] {
  const byJob = new Map<SyncJob, JobOutcome>(
    applied.map(function outcomeByJob(outcome: JobOutcome) {
      return [outcome.job, outcome] as const;
    }),
  );

  return plans.map(appliedOutcomeFor(byJob));
}

/**
 * Reconcile a batch of jobs headlessly: a read-only plan pass, then an apply pass over only the jobs
 * that planned real work, both behind the bounded pool. Never prompts.
 */
export async function runSyncBatch(
  client: SyncCatalogClient,
  jobs: readonly SyncJob[],
  allowDestructive: boolean,
): Promise<SyncRunReport> {
  async function planJob(job: SyncJob): Promise<JobOutcome> {
    return reconcileJob(client, job, true, allowDestructive);
  }

  async function applyJob(job: SyncJob): Promise<JobOutcome> {
    return reconcileJob(client, job, false, allowDestructive);
  }

  const plans = await mapWithConcurrency(jobs, SYNC_CONCURRENCY, planJob);
  const jobsToApply: SyncJob[] = [];

  for (const planOutcome of plans) {
    if (hasPlannedAction(planOutcome)) {
      jobsToApply.push(planOutcome.job);
    }
  }

  const applied = await mapWithConcurrency(jobsToApply, SYNC_CONCURRENCY, applyJob);

  return summarizeRun(mergeOutcomes(plans, applied));
}
