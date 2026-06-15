/**
 * `launch sync` — reconcile App Store Connect product configuration (capabilities, in-app purchases,
 * subscriptions, pricing), textual store-listing copy, screenshots, AND app preview videos to match
 * config, across every discovered app at once.
 *
 * This fills the gap EAS leaves: `eas build`/`submit` ship the binary, but nothing declaratively manages
 * IAPs, subscriptions, capability flags, per-locale listing copy, or screenshots — those are hand-work in
 * the App Store Connect UI. `launch sync` makes them declarative: products from `launch.config.ts`, the
 * App Store listing from each app's `store.config.json` (the same file `launch metadata` uses), and
 * screenshots from each app's `screenshots/<locale>/<displayType>/` folder.
 *
 * Flow: build a per-app job list (capabilities from each app's `app.json` entitlements, products from
 * `config.products[bundleId]`, listing from `store.config.json`, screenshots from `<app>/screenshots/`),
 * run a read-only PLAN pass over all apps in parallel, print it, confirm, then run the APPLY pass. Apps
 * run behind a bounded pool sharing the one ASC key, each isolated so one app's failure never aborts the
 * batch. `--dry-run` stops after the plan; `--allow-destructive` permits capability removals; `--yes`
 * skips the prompt for CI.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { runPool } from "../../core/asyncPool.js";
import { reconcileApp, type PlannedAction, type ReconcileReport } from "../../core/ascSync.js";
import {
  reconcilePreviews,
  reconcileScreenshots,
  type SubscriptionReviewScreenshot,
} from "../../core/ascScreenshots.js";
import { fingerprintAsset } from "../../core/screenshotAssets.js";
import { buildJobs, selectApps, type SyncJob } from "../../core/syncJobs.js";

/** How many apps reconcile concurrently. Bounded so the single ASC key stays under Apple's rate ceiling. */
const SYNC_CONCURRENCY = 4;

/** CLI options for `launch sync`. */
interface SyncOptions {
  /** Comma-separated app handles to limit the run to. Omit to sync every app with something to do. */
  app?: string;
  /** Show the plan and exit, making no changes. */
  dryRun?: boolean;
  /** Permit destructive actions (capability removals). Off by default. */
  allowDestructive?: boolean;
  /** Skip the confirmation prompt (for CI / non-interactive use). */
  yes?: boolean;
}

/**
 * One app's reconcile outcome, carrying its own job so we never index a parallel array. A precondition
 * failure (e.g. no ASC app record) lands in `error`; otherwise `report` holds the planned/applied actions.
 */
type JobOutcome = { job: SyncJob; report: ReconcileReport } | { job: SyncJob; error: string };

/** Reconcile one job, never throwing: a thrown precondition becomes `{ error }` so the pool stays whole. */
async function reconcileJob(
  client: AppStoreConnectClient,
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
    await appendScreenshotActions(client, job, report, dryRun, allowDestructive);
    await appendPreviewActions(client, job, report, dryRun, allowDestructive);
    return { job, report };
  } catch (error) {
    return { job, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Run the screenshot/asset pass for one app and append its actions to the catalog report. Isolated in its
 * own try/catch so a screenshot failure is recorded as one failed action rather than discarding the
 * (already-applied) catalog actions. Declared subscription review screenshots are fingerprinted here
 * (the filesystem read), recording an actionable skip for any missing file before the pure reconciler runs.
 */
async function appendScreenshotActions(
  client: AppStoreConnectClient,
  job: SyncJob,
  report: ReconcileReport,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<void> {
  if (job.screenshots.length === 0 && job.subscriptionReviewScreenshots.length === 0) return;
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
    report.actions.push(...missing, ...actions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.actions.push({
      description: `screenshots: ${message}`,
      destructive: false,
      status: "failed",
      error: message,
    });
  }
}

/**
 * Run the app-preview-video pass for one app and append its actions to the report. Isolated in its own
 * try/catch (like {@link appendScreenshotActions}) so a preview failure is one recorded action, not a lost
 * report. Previews are fingerprinted at discovery, so this pass is a pure reconcile with no filesystem read.
 */
async function appendPreviewActions(
  client: AppStoreConnectClient,
  job: SyncJob,
  report: ReconcileReport,
  dryRun: boolean,
  allowDestructive: boolean,
): Promise<void> {
  if (job.previews.length === 0) return;
  try {
    const actions = await reconcilePreviews(client, {
      bundleId: job.bundleId,
      previews: job.previews,
      dryRun,
      allowDestructive,
    });
    report.actions.push(...actions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.actions.push({
      description: `previews: ${message}`,
      destructive: false,
      status: "failed",
      error: message,
    });
  }
}

/** The leading glyph for an action line: `-` for destructive, `+` otherwise. */
function glyph(destructive: boolean): string {
  return destructive ? "-" : "+";
}

/** Tally a report's action statuses for the run summary. */
function summarize(report: ReconcileReport): { applied: number; failed: number; skipped: number } {
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

/** Attach the `sync` command to the program. */
export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description(
      "reconcile App Store Connect products (capabilities, IAPs, subscriptions, pricing), store-listing copy, screenshots, and app previews from config",
    )
    .option("-a, --app <names>", "comma-separated app handles to sync (default: all apps with something to sync)")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("--allow-destructive", "permit destructive actions such as removing a capability", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (options: SyncOptions) => {
      const log = createLogger(false);
      const { config, apps } = await loadConfig();
      const jobs = buildJobs(selectApps(apps, options.app), config);

      if (jobs.length === 0) {
        log.info(
          "Nothing to sync — no apps with capabilities, products, a store.config.json listing, a screenshots/ folder, or a previews/ folder. Add a `products` entry, run `launch metadata pull`, drop screenshots under `<app>/screenshots/<locale>/<displayType>/`, or app previews under `<app>/previews/<locale>/<previewType>/`.",
        );
        return;
      }

      const ascKey = await loadActiveAscKey();
      if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
      const client = new AppStoreConnectClient(ascKey);

      for (const job of jobs) {
        if (job.unmapped.length > 0) {
          log.warn(`${job.app.name}: unrecognized entitlement(s) — handle in the portal: ${job.unmapped.join(", ")}`);
        }
      }

      // PLAN pass — read-only, all apps in parallel. reconcileJob never throws, so every result is `ok`.
      const allowDestructive = options.allowDestructive === true;
      const planResults = await runPool(jobs, SYNC_CONCURRENCY, (job) =>
        reconcileJob(client, job, true, allowDestructive),
      );
      const plans = planResults.flatMap((result) => (result.ok ? [result.value] : []));

      let mutationCount = 0;
      let planErrors = 0;
      log.gap();
      for (const plan of plans) {
        if ("error" in plan) {
          planErrors++;
          log.error(`${plan.job.app.name} (${plan.job.bundleId}): ${plan.error}`);
          continue;
        }
        const actions = plan.report.actions;
        mutationCount += actions.filter((action) => action.status === "planned").length;
        if (actions.length === 0) {
          log.step(plan.job.app.name, "already in sync");
          continue;
        }
        log.notice(
          `${plan.job.app.name} (${plan.job.bundleId})`,
          ...actions.map((action) =>
            action.status === "skipped"
              ? `• ${action.description}`
              : `${glyph(action.destructive)} ${action.description}`,
          ),
        );
      }

      if (mutationCount === 0) {
        log.gap();
        if (planErrors > 0) {
          log.error(`${planErrors} app(s) could not be planned (see above).`);
          process.exitCode = 1;
        } else {
          log.step("sync", "everything is already in sync");
        }
        return;
      }

      log.gap();
      log.info(`${mutationCount} change(s) across ${jobs.length} app(s).`);

      if (options.dryRun === true) {
        log.info("Dry run — no changes made. Re-run without --dry-run to apply.");
        if (planErrors > 0) process.exitCode = 1;
        return;
      }

      if (options.yes !== true) {
        if (!process.stdout.isTTY) {
          throw new Error("Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).");
        }
        const proceed = await confirm({ message: `Apply ${mutationCount} change(s) to App Store Connect?` });
        if (isCancel(proceed) || !proceed) {
          cancel("Aborted — no changes made.");
          return;
        }
      }

      // APPLY pass — only apps that planned OK and have real work.
      const toApply = plans.flatMap((plan) =>
        "report" in plan && plan.report.actions.some((action) => action.status === "planned") ? [plan.job] : [],
      );
      const applyResults = await runPool(toApply, SYNC_CONCURRENCY, (job) =>
        reconcileJob(client, job, false, allowDestructive),
      );
      const applied = applyResults.flatMap((result) => (result.ok ? [result.value] : []));

      let failures = planErrors;
      const rows: string[] = [];
      for (const outcome of applied) {
        if ("error" in outcome) {
          failures++;
          rows.push(`✗ ${outcome.job.app.name}: ${outcome.error}`);
          continue;
        }
        const summary = summarize(outcome.report);
        failures += summary.failed;
        rows.push(
          `${summary.failed > 0 ? "✗" : "✓"} ${outcome.job.app.name}: ${summary.applied} applied, ${summary.failed} failed, ${summary.skipped} skipped`,
        );
        for (const action of outcome.report.actions) {
          if (action.status === "failed") rows.push(`    ✗ ${action.description} — ${action.error ?? "failed"}`);
        }
      }

      log.box(failures > 0 ? "Synced with errors" : "Synced", rows);
      if (failures > 0) process.exitCode = 1;
    });
}
