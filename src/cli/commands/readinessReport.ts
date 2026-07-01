/**
 * Shared run + render for the readiness-backed command family (`launch audit`, `launch store doctor`,
 * `launch iap doctor`). Each of those answers a distinct question — submission, account, and IAP readiness —
 * but the *mechanics* are identical: register the probes, load the config, build the read-only context, run
 * the orchestrator over one probe slice, then render or emit JSON and set the exit code. {@link runReadinessCommand}
 * owns that flow so a command file is reduced to its `register*` wiring plus the one tag + two labels that make
 * it speak in its own voice; {@link renderReadinessOutcome} owns the terminal rendering it shares.
 */

import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import type { Logger } from '../../core/logger.js';
import { createAscClientResolver, createPlayClientResolver } from '../../core/storeClients.js';
import { READINESS_EXIT, runProbes } from '../../core/readiness/orchestrator.js';
import { registerBuiltinProbes, selectReadinessProbes } from '../../core/readiness/registry.js';
import type {
  ProbeReport,
  ReadinessCategory,
  ReadinessContext,
  ReadinessOutcome,
  ReadinessStore,
} from '../../core/types.js';
import { selectApps } from '../../core/syncJobs.js';

/** The two strings a command supplies so a shared render reads in that command's voice. */
export interface ReadinessReportLabels {
  /** Prefix for the one-line summary, e.g. `Store readiness` or `Pre-submit audit`. */
  summary: string;
  /** Shown when no probe produced output (no apps with a bundle id / package name were in scope). */
  empty: string;
}

/** Human store name for a report header. */
function storeLabel(store: ReadinessStore): string {
  return store === 'appstore' ? 'App Store' : 'Google Play';
}

/** Render one probe's report: a green step per `ok`, a warning + tip per `warn`/`skipped`, an error otherwise. */
function renderReport(log: Logger, report: ProbeReport): void {
  const { outcome, title } = report;
  if (outcome.state === 'skipped') {
    log.warn(`${title}: skipped — ${outcome.reason}`);
    if (outcome.hint) log.tip(outcome.hint);
    return;
  }
  if (outcome.state === 'errored') {
    log.error(`${title}: ${outcome.error}`);
    return;
  }
  if (outcome.state !== 'checked') return; // omitted is filtered out upstream; this narrows the union.
  for (const app of outcome.apps) {
    const line = `${title} · ${app.app}: ${app.detail}`;
    if (app.status === 'ok') {
      log.step(title, `${app.app}: ${app.detail}`);
    } else if (app.status === 'warn') {
      log.warn(line);
      if (app.hint) log.tip(app.hint);
    } else {
      log.error(line);
      if (app.hint) log.tip(app.hint);
    }
  }
}

/** Render the full readiness outcome grouped by store, then a one-line summary keyed to the exit code. */
export function renderReadinessOutcome(
  log: Logger,
  outcome: ReadinessOutcome,
  labels: ReadinessReportLabels,
): void {
  if (outcome.reports.length === 0) {
    log.info(labels.empty);
    return;
  }

  for (const store of ['appstore', 'play'] as const) {
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
  const summary = `${labels.summary}: ${parts.join(' · ') || 'all clear'}`;
  if (outcome.exitCode === READINESS_EXIT.ok) log.info(summary);
  else log.error(summary);
}

/** Input for {@link runReadinessCommand} — the probe slice plus the per-command voice and shared options. */
export interface RunReadinessCommandInput {
  /** The probe tag this command grades over, e.g. `submit`, `account`, or `iap`. */
  category: ReadinessCategory;
  /** The summary prefix and empty-run message that make a shared run read in this command's voice. */
  labels: ReadinessReportLabels;
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link ReadinessOutcome}) for CI/agents. */
  json?: boolean;
}

/**
 * Run one readiness-backed command end to end: register the built-in probes, load the config, build the
 * read-only context (config + apps narrowed by `-a` + the memoized client resolvers), run the orchestrator
 * over the `category` slice, then emit JSON or render. Sets `process.exitCode` per the {@link READINESS_EXIT}
 * contract (0 ready · 2 blockers · 1 unreadable, error wins) so it gates a release script. Shared by `audit`,
 * `store doctor`, and `iap doctor`, which differ only in their `category` and `labels`.
 */
export async function runReadinessCommand(input: RunReadinessCommandInput): Promise<void> {
  registerBuiltinProbes();
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const ctx: ReadinessContext = {
    config,
    apps: selectApps(apps, input.app),
    resolveAscApi: createAscClientResolver(),
    resolvePlayApi: createPlayClientResolver(),
  };

  const outcome = await runProbes(ctx, selectReadinessProbes(input.category));

  if (input.json === true) log.line(JSON.stringify(outcome, null, 2));
  else renderReadinessOutcome(log, outcome, input.labels);
  process.exitCode = outcome.exitCode;
}
