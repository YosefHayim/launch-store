/**
 * Shared terminal rendering for a {@link ReadinessOutcome} — used by every readiness-backed command
 * (`launch store doctor`, `launch audit`, and the iap-doctor to come) so the per-probe lines, store grouping,
 * and exit-code-keyed summary stay identical across the family. Each command resolves credentials, selects
 * its probe slice, and runs the orchestrator; this module only turns the resulting outcome into log lines, so
 * the only thing a command varies is the summary label and the empty-run message (see {@link ReadinessReportLabels}).
 */

import type { Logger } from "../../core/logger.js";
import { READINESS_EXIT } from "../../core/readiness/orchestrator.js";
import type { ProbeReport, ReadinessOutcome, ReadinessStore } from "../../core/readiness/types.js";

/** The two strings a command supplies so a shared render reads in that command's voice. */
export interface ReadinessReportLabels {
  /** Prefix for the one-line summary, e.g. `Store readiness` or `Pre-submit audit`. */
  summary: string;
  /** Shown when no probe produced output (no apps with a bundle id / package name were in scope). */
  empty: string;
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
export function renderReadinessOutcome(log: Logger, outcome: ReadinessOutcome, labels: ReadinessReportLabels): void {
  if (outcome.reports.length === 0) {
    log.info(labels.empty);
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
  const summary = `${labels.summary}: ${parts.join(" · ") || "all clear"}`;
  if (outcome.exitCode === READINESS_EXIT.ok) log.info(summary);
  else log.error(summary);
}
