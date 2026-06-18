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
 * Flow: build a per-app job list, run a read-only PLAN pass over all apps in parallel, print it, confirm,
 * then run the APPLY pass. The per-app reconcile itself ({@link reconcileJob}) and the concurrency bound
 * ({@link SYNC_CONCURRENCY}) live in `core/syncRun.ts`, shared verbatim with the `sync` MCP tools — this
 * command owns only the interactive choreography (print, confirm, summary). `--dry-run` stops after the
 * plan; `--allow-destructive` permits capability removals; `--yes` skips the prompt for CI.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { runPool } from "../../core/asyncPool.js";
import { buildJobs, selectApps } from "../../core/syncJobs.js";
import { reconcileJob, summarize, SYNC_CONCURRENCY } from "../../core/syncRun.js";
import { createPlayClientResolver } from "../../core/storeClients.js";
import { captureAutoSnapshot } from "../../core/snapshot/autoSnapshot.js";
import type { SnapshotContext } from "../../core/snapshot/types.js";

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
  /** Capture a pre-sync snapshot baseline before applying. Defaults on; `--no-snapshot` sets it `false`. */
  snapshot?: boolean;
}

/** The leading glyph for an action line: `-` for destructive, `+` otherwise. */
function glyph(destructive: boolean): string {
  return destructive ? "-" : "+";
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
    .option("--no-snapshot", "skip the automatic pre-sync snapshot baseline")
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

      // Capture a "before" baseline so this destructive run is reversible (opt out with --no-snapshot).
      // Reuses the already-built ASC client; a snapshot failure must never abort the sync it protects.
      if (options.snapshot !== false) {
        const snapshotCtx: SnapshotContext = {
          config,
          apps: selectApps(apps, options.app),
          resolveAscApi: () => Promise.resolve(client),
          resolvePlayApi: createPlayClientResolver(),
        };
        try {
          const baseline = await captureAutoSnapshot(snapshotCtx, { capturedAt: new Date().toISOString() });
          log.step("snapshot", `saved "${baseline.name}" (${baseline.entityCount} item(s)) — undo baseline`);
        } catch {
          log.warn("Could not capture a pre-sync snapshot; continuing.");
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
