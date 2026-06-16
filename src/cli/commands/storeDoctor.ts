/**
 * `launch store doctor` — a read-only store-**account** readiness check, distinct from `launch doctor`
 * (which checks the local iOS/Android toolchain). Submissions silently fail on account-level
 * prerequisites that have nothing to do with the build: a missing App Store Connect app record, no
 * uploaded build on Play, an unauthorized service account. This command grades those up front.
 *
 * It owns no check logic of its own — it resolves credentials (via the shared `core/storeClients.ts`
 * resolvers), selects the `account`-tagged probes from the readiness registry, runs them, and renders the
 * result. `--json` plus the documented exit codes (0 ready · 2 blockers · 1 unreadable, error wins) make
 * it scriptable. New account checks are new probe files, never edits here. See issue #170.
 */

import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { createAscClientResolver, createPlayClientResolver } from "../../core/storeClients.js";
import { selectApps } from "../../core/syncJobs.js";
import { registerBuiltinProbes, selectReadinessProbes } from "../../core/readiness/registry.js";
import { READINESS_EXIT, runProbes } from "../../core/readiness/orchestrator.js";
import type { ProbeReport, ReadinessContext, ReadinessOutcome, ReadinessStore } from "../../core/readiness/types.js";

/** CLI options for `launch store doctor`. */
interface StoreDoctorOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link ReadinessOutcome}) for CI/agents. */
  json?: boolean;
}

/** Human store name for a report header. */
function storeLabel(store: ReadinessStore): string {
  return store === "appstore" ? "App Store" : "Google Play";
}

/** Render one probe's report: a green step per `ok`, a warning + tip per `warn`/`skipped`, an error otherwise. */
function renderReport(log: Logger, report: ProbeReport): void {
  const { outcome, title } = report;
  if (outcome.state === "skipped") {
    log.warn(`${title}: skipped — ${outcome.reason}`);
    if (outcome.hint) log.tip(outcome.hint);
    return;
  }
  if (outcome.state === "errored") {
    log.error(`${title}: ${outcome.error}`);
    return;
  }
  if (outcome.state !== "checked") return; // omitted is filtered out upstream; this narrows the union.
  for (const app of outcome.apps) {
    const line = `${title} · ${app.app}: ${app.detail}`;
    if (app.status === "ok") {
      log.step(title, `${app.app}: ${app.detail}`);
    } else if (app.status === "warn") {
      log.warn(line);
      if (app.hint) log.tip(app.hint);
    } else {
      log.error(line);
      if (app.hint) log.tip(app.hint);
    }
  }
}

/** Render the full readiness outcome grouped by store, then a one-line summary keyed to the exit code. */
function renderOutcome(log: Logger, outcome: ReadinessOutcome): void {
  if (outcome.reports.length === 0) {
    log.info("No store-readiness checks ran — no apps with a bundle id or package name were found.");
    return;
  }

  for (const store of ["appstore", "play"] as const) {
    const reports = outcome.reports.filter((report) => report.store === store);
    if (reports.length === 0) continue;
    log.info(storeLabel(store));
    for (const report of reports) renderReport(log, report);
  }

  const parts: string[] = [];
  if (outcome.blockerCount > 0) parts.push(`${outcome.blockerCount} blocker(s)`);
  if (outcome.errorCount > 0) parts.push(`${outcome.errorCount} unreadable`);
  if (outcome.warnCount > 0) parts.push(`${outcome.warnCount} warning(s)`);
  if (outcome.skippedCount > 0) parts.push(`${outcome.skippedCount} skipped`);

  log.gap();
  const summary = `Store readiness: ${parts.join(" · ") || "all clear"}`;
  if (outcome.exitCode === READINESS_EXIT.ok) log.info(summary);
  else log.error(summary);
}

/**
 * Run the store-doctor flow. Exported so a test (or a future caller) can drive it directly: it loads the
 * config, resolves the read-only clients once via the shared resolvers, runs the `account` probes, and
 * renders. Sets `process.exitCode` per the {@link READINESS_EXIT} contract.
 */
export async function runStoreDoctor(input: StoreDoctorOptions): Promise<void> {
  registerBuiltinProbes();
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const ctx: ReadinessContext = {
    config,
    apps: selectApps(apps, input.app),
    resolveAscApi: createAscClientResolver(),
    resolvePlayApi: createPlayClientResolver(),
  };

  const outcome = await runProbes(ctx, selectReadinessProbes("account"));

  if (input.json === true) console.log(JSON.stringify(outcome, null, 2));
  else renderOutcome(log, outcome);
  process.exitCode = outcome.exitCode;
}

/**
 * Attach the `store` command group and its `doctor` subcommand to the program. `store` is a namespace for
 * store-account operations (today just `doctor`); keeping it a group leaves room without crowding the
 * top-level surface, and keeps `launch store doctor` unmistakably separate from `launch doctor`.
 */
export function registerStoreCommand(program: Command): void {
  const store = program.command("store").description("store-account readiness and operations");
  store
    .command("doctor")
    .description("check store-account readiness: Apple app record, Play onboarding & access (read-only)")
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (options: StoreDoctorOptions) => {
      await runStoreDoctor(options);
    });
}
