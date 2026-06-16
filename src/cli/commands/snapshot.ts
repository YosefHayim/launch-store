/**
 * `launch snapshot` — capture, diff, and export point-in-time copies of live store state. A snapshot is the
 * trustworthy "before" that makes destructive store automation (`launch sync` / `apply`) reversible: you
 * capture the live App Store Connect + Google Play catalog into a named save slot, then `diff` it against a
 * later capture (or live) to see exactly what moved. Read-only end to end — it never writes to either store.
 *
 * Like `launch plan` / `launch store doctor`, the command owns no capture logic: it resolves credentials via
 * the shared `core/storeClients.ts` resolvers, runs every registered snapshot source, and renders. A new
 * captured surface is a new source file, never an edit here. Partial restore is a deliberate follow-up
 * (read first, write later — see #169). `--json` on every subcommand makes it scriptable.
 */

import { writeFileSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import type { Logger } from "../../core/logger.js";
import { createAscClientResolver, createPlayClientResolver } from "../../core/storeClients.js";
import { selectApps } from "../../core/syncJobs.js";
import { listSnapshotSources, registerBuiltinSources } from "../../core/snapshot/registry.js";
import { captureSnapshot } from "../../core/snapshot/orchestrator.js";
import type { CaptureResult } from "../../core/snapshot/orchestrator.js";
import { diffSnapshots } from "../../core/snapshot/diff.js";
import type { DiffChange, SnapshotDiff } from "../../core/snapshot/diff.js";
import { listSnapshots, loadSnapshot, saveSnapshot } from "../../core/snapshot/store.js";
import type { CaptureReport, Snapshot, SnapshotContext, SnapshotStore } from "../../core/snapshot/types.js";

/** The literal `against` token that means "capture live state now and diff against it" rather than a saved name. */
const LIVE = "live";

/** Glyphs for the three diff outcomes, matching `launch plan`'s `+`/`~`/`-` vocabulary. */
const DIFF_GLYPH: Record<DiffChange, string> = { added: "+", removed: "-", changed: "~" };

/** Human store name for a report header. */
function storeLabel(store: SnapshotStore): string {
  return store === "appstore" ? "App Store" : "Google Play";
}

/** Build the read-only capture context: config + apps narrowed by `-a` + the shared memoized client resolvers. */
async function buildContext(appSelector: string | undefined): Promise<SnapshotContext> {
  const { config, apps } = await loadConfig();
  return {
    config,
    apps: selectApps(apps, appSelector),
    resolveAscApi: createAscClientResolver(),
    resolvePlayApi: createPlayClientResolver(),
  };
}

/** A default snapshot name when the user gives none: the capture time, filesystem-safe. */
function defaultName(capturedAt: string): string {
  return `snapshot-${capturedAt.replace(/[:.]/g, "-")}`;
}

/** Total captured items across a snapshot's surfaces (skipped/errored surfaces contribute none). */
function countEntities(snapshot: Snapshot): number {
  let total = 0;
  for (const report of snapshot.reports) {
    if (report.outcome.state === "captured") {
      for (const app of report.outcome.apps) total += app.entities.length;
    }
  }
  return total;
}

/** CLI options shared by the capturing subcommands. */
interface CaptureOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output. */
  json?: boolean;
}

/**
 * `snapshot create [name]` — capture live state into a named save slot. The snapshot is always saved (even a
 * partial one, when a surface couldn't be read) so the "before" is never silently lost; the exit code still
 * reflects completeness per the {@link import("../../core/snapshot/orchestrator.js").SNAPSHOT_EXIT} contract.
 */
export async function runSnapshotCreate(input: CaptureOptions & { name?: string | undefined }): Promise<void> {
  registerBuiltinSources();
  const log = createLogger(false);
  const capturedAt = new Date().toISOString();
  const name = input.name ?? defaultName(capturedAt);
  const ctx = await buildContext(input.app);
  const result = await captureSnapshot(ctx, listSnapshotSources(), { name, capturedAt });
  const file = saveSnapshot(result.snapshot);

  if (input.json === true) console.log(JSON.stringify({ ...result, file }, null, 2));
  else renderCapture(log, result, file);
  process.exitCode = result.exitCode;
}

/** Render one capture run grouped by store, then a one-line summary keyed to completeness. */
function renderCapture(log: Logger, result: CaptureResult, file: string): void {
  for (const store of ["appstore", "play"] as const) {
    const reports = result.snapshot.reports.filter((report) => report.store === store);
    if (reports.length === 0) continue;
    log.info(storeLabel(store));
    for (const report of reports) renderCaptureReport(log, report);
  }

  const parts = [`${result.entityCount} item(s)`];
  if (result.skippedCount > 0) parts.push(`${result.skippedCount} skipped`);
  if (result.errorCount > 0) parts.push(`${result.errorCount} unreadable`);
  log.gap();
  log.info(`Snapshot "${result.snapshot.name}" saved to ${file} (${parts.join(", ")})`);
  if (result.errorCount > 0) log.warn("Snapshot is incomplete — a surface could not be read.");
}

/** Render one captured/skipped/errored surface. */
function renderCaptureReport(log: Logger, report: CaptureReport): void {
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
  if (outcome.state !== "captured") return; // 'omitted' surfaces are dropped before persisting; never rendered
  for (const app of outcome.apps) {
    log.step(title, `${app.app}: ${app.entities.length} item(s)`);
  }
}

/**
 * `snapshot diff <baseline> [against]` — compare a saved snapshot against another saved snapshot or, by
 * default, freshly-captured live state. Informational: differences are never a failure (that's `launch
 * drift`); only an operational error (an unknown snapshot name) exits non-zero.
 */
export async function runSnapshotDiff(input: CaptureOptions & { baseline: string; against: string }): Promise<void> {
  const log = createLogger(false);
  const baseline = loadSnapshot(input.baseline);
  if (!baseline) {
    missingSnapshot(log, input.baseline);
    return;
  }

  let against: Snapshot;
  if (input.against === LIVE) {
    registerBuiltinSources();
    const ctx = await buildContext(input.app);
    const captured = await captureSnapshot(ctx, listSnapshotSources(), {
      name: LIVE,
      capturedAt: new Date().toISOString(),
    });
    against = captured.snapshot;
  } else {
    const loaded = loadSnapshot(input.against);
    if (!loaded) {
      missingSnapshot(log, input.against);
      return;
    }
    against = loaded;
  }

  const diff = diffSnapshots(baseline, against);
  if (input.json === true) console.log(JSON.stringify(diff, null, 2));
  else renderDiff(log, diff, input.baseline, input.against);
}

/** Render a diff grouped by store → app, then a one-line summary. */
function renderDiff(log: Logger, diff: SnapshotDiff, baselineName: string, againstName: string): void {
  log.info(`${baselineName} → ${againstName}`);
  if (diff.entries.length === 0) {
    log.info("In sync — no differences.");
    return;
  }

  for (const store of ["appstore", "play"] as const) {
    const entries = diff.entries.filter((entry) => entry.store === store);
    if (entries.length === 0) continue;
    log.info(storeLabel(store));
    for (const entry of entries) {
      log.info(`  ${DIFF_GLYPH[entry.change]} ${entry.app} ${entry.key} — ${entry.summary}`);
    }
  }

  log.gap();
  log.info(`Diff: ${diff.addedCount} added, ${diff.changedCount} changed, ${diff.removedCount} removed`);
}

/**
 * `snapshot export <name>` — print a saved snapshot as JSON, or write it to `--out`. Useful for archiving a
 * store state to version control or feeding it to another tool.
 */
export async function runSnapshotExport(input: { name: string; out?: string }): Promise<void> {
  const log = createLogger(false);
  const snapshot = loadSnapshot(input.name);
  if (!snapshot) {
    missingSnapshot(log, input.name);
    return;
  }

  const json = JSON.stringify(snapshot, null, 2);
  if (input.out !== undefined) {
    writeFileSync(input.out, json);
    log.info(`Exported "${input.name}" to ${input.out}`);
  } else {
    console.log(json);
  }
}

/** `snapshot list` — list saved snapshots, newest first. */
export async function runSnapshotList(input: { json?: boolean }): Promise<void> {
  const log = createLogger(false);
  const snapshots = listSnapshots();
  if (input.json === true) {
    console.log(
      JSON.stringify(
        snapshots.map((snapshot) => ({
          name: snapshot.name,
          capturedAt: snapshot.capturedAt,
          entityCount: countEntities(snapshot),
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (snapshots.length === 0) {
    log.info("No snapshots yet. Capture one with `launch snapshot create`.");
    return;
  }
  for (const snapshot of snapshots) {
    log.step("snapshot", `${snapshot.name} — ${snapshot.capturedAt} — ${countEntities(snapshot)} item(s)`);
  }
}

/** Report an unknown snapshot name consistently and set the failure exit code. */
function missingSnapshot(log: Logger, name: string): void {
  log.error(`No snapshot named "${name}".`);
  log.tip("run `launch snapshot list` to see saved snapshots");
  process.exitCode = 1;
}

/** Attach the `snapshot` command group and its subcommands to the program. */
export function registerSnapshotCommand(program: Command): void {
  const snapshot = program
    .command("snapshot")
    .description("capture, diff, and export point-in-time copies of live store state (read-only)");

  snapshot
    .command("create [name]")
    .description("capture live App Store + Play state into a named snapshot")
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (name: string | undefined, options: CaptureOptions) => {
      await runSnapshotCreate({ ...options, name });
    });

  snapshot
    .command("list")
    .description("list saved snapshots, newest first")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (options: { json?: boolean }) => {
      await runSnapshotList(options);
    });

  snapshot
    .command("diff <baseline> [against]")
    .description("compare a saved snapshot against another saved snapshot or live state (default: live)")
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (baseline: string, against: string | undefined, options: CaptureOptions) => {
      await runSnapshotDiff({ ...options, baseline, against: against ?? LIVE });
    });

  snapshot
    .command("export <name>")
    .description("print a saved snapshot as JSON, or write it to a file with --out")
    .option("--out <file>", "write the snapshot JSON to this file instead of stdout")
    .action(async (name: string, options: { out?: string }) => {
      await runSnapshotExport({ name, ...options });
    });
}
