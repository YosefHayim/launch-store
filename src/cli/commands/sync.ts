/**
 * `launch sync` — reconcile App Store Connect product configuration (capabilities, in-app purchases,
 * subscriptions, pricing) AND textual store-listing copy to match config, across every discovered app at once.
 *
 * This fills the gap EAS leaves: `eas build`/`submit` ship the binary, but nothing declaratively manages
 * IAPs, subscriptions, capability flags, or per-locale listing copy — those are hand-work in the App
 * Store Connect UI. `launch sync` makes them declarative: products from `launch.config.ts` and the App
 * Store listing from each app's `store.config.json` (the same file `launch metadata` uses).
 *
 * Flow: build a per-app job list (capabilities from each app's `app.json` entitlements, products from
 * `config.products[bundleId]`, listing from `store.config.json`), run a read-only PLAN pass over all apps
 * in parallel, print it, confirm, then run the APPLY pass. Apps run behind a bounded pool sharing the one
 * ASC key, each isolated so one app's failure never aborts the batch. `--dry-run` stops after the plan;
 * `--allow-destructive` permits capability removals; `--yes` skips the prompt for CI.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { AppDescriptor, AppProducts, LaunchConfig } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { mapEntitlementsToCapabilities, type CapabilityType } from "../../core/capabilities.js";
import { runPool } from "../../core/asyncPool.js";
import { reconcileApp, type ReconcileReport } from "../../core/ascSync.js";
import { loadStoreConfig, type AppleStoreConfig } from "../../core/storeConfig.js";

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

/** One app's reconcile work: the resolved capabilities + products plus any entitlements we couldn't map. */
interface SyncJob {
  app: AppDescriptor;
  bundleId: string;
  capabilities: CapabilityType[];
  products: AppProducts;
  /** The app's `store.config.json` `apple` listing, when present — reconciled natively into ASC. */
  listing?: AppleStoreConfig;
  /** Entitlement keys with no known capability mapping — surfaced as a warning, not an error. */
  unmapped: string[];
}

/**
 * Read an app's `store.config.json` `apple` listing, or undefined when absent. A malformed file is
 * swallowed here (returns undefined) so a broken listing never blocks product/capability sync — the
 * dedicated `launch metadata` command is where it's loudly validated.
 */
function loadListing(appDir: string): AppleStoreConfig | undefined {
  const path = join(appDir, "store.config.json");
  if (!existsSync(path)) return undefined;
  try {
    return loadStoreConfig(path).apple;
  } catch {
    return undefined;
  }
}

/** Whether a listing carries at least one locale with at least one field worth reconciling. */
function hasListing(listing: AppleStoreConfig | undefined): boolean {
  return listing !== undefined && Object.values(listing.info).some((info) => Object.keys(info).length > 0);
}

/**
 * One app's reconcile outcome, carrying its own job so we never index a parallel array. A precondition
 * failure (e.g. no ASC app record) lands in `error`; otherwise `report` holds the planned/applied actions.
 */
type JobOutcome = { job: SyncJob; report: ReconcileReport } | { job: SyncJob; error: string };

/** Resolve the apps to sync from discovery + the optional `--app` selector, erroring on an unknown name. */
function selectApps(apps: AppDescriptor[], selector: string | undefined): AppDescriptor[] {
  if (!selector) return apps;
  const wanted = selector
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const byName = new Map(apps.map((app) => [app.name, app]));
  return wanted.map((name) => {
    const app = byName.get(name);
    if (!app)
      throw new Error(`Unknown app "${name}". Discovered apps: ${apps.map((a) => a.name).join(", ") || "none"}.`);
    return app;
  });
}

/** Build the job list, dropping apps with no iOS bundle id and nothing (capabilities, products, or listing) to sync. */
function buildJobs(apps: AppDescriptor[], config: LaunchConfig): SyncJob[] {
  const jobs: SyncJob[] = [];
  for (const app of apps) {
    if (!app.bundleId) continue;
    const { enable, unmapped } = mapEntitlementsToCapabilities(app.iosEntitlements);
    const products = config.products?.[app.bundleId] ?? {};
    const productCount = (products.inAppPurchases?.length ?? 0) + (products.subscriptionGroups?.length ?? 0);
    const listing = loadListing(app.dir);
    if (enable.length === 0 && productCount === 0 && !hasListing(listing)) continue;
    jobs.push({
      app,
      bundleId: app.bundleId,
      capabilities: enable,
      products,
      ...(listing ? { listing } : {}),
      unmapped,
    });
  }
  return jobs;
}

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
    return { job, report };
  } catch (error) {
    return { job, error: error instanceof Error ? error.message : String(error) };
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
      "reconcile App Store Connect products (capabilities, IAPs, subscriptions, pricing) and store-listing copy from config",
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
          "Nothing to sync — no apps with capabilities, products, or a store.config.json listing. Add a `products` entry or run `launch metadata pull`.",
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
