/**
 * `launch snapshot` — capture, diff, restore, and export point-in-time copies of live store state. A
 * snapshot is the trustworthy "before" that makes destructive store automation (`launch sync` / `apply`)
 * reversible: you capture the live App Store Connect + Google Play catalog into a named save slot, then
 * `diff` it against a later capture (or live) to see what moved, and `restore` it to push a saved listing
 * back. Capture/diff/export/list are read-only; `restore` is the one writing path, gated behind `--yes`.
 *
 * Like `launch plan` / `launch store doctor`, the command owns no capture/restore logic: it resolves
 * credentials via the shared `core/storeClients.ts` resolvers, runs every registered snapshot source, and
 * renders. A new captured/restorable surface is a new source file, never an edit here. Restore is wired
 * per-source — config-complete sources write (the App Store listing and the Play catalog: products +
 * subscriptions); the Apple catalog sources stay preview-only, as App Store Connect exposes no reader for
 * an in-app purchase's current price (see #191). `--json` on every subcommand makes it scriptable.
 */

import { writeFileSync } from 'node:fs';
import type { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import type { Logger } from '../../core/logger.js';
import { createAscClientResolver, createPlayClientResolver } from '../../core/storeClients.js';
import { selectApps } from '../../core/syncJobs.js';
import { listSnapshotSources, registerBuiltinSources } from '../../core/snapshot/registry.js';
import { captureSnapshot } from '../../core/snapshot/orchestrator.js';
import type { CaptureResult } from '../../core/snapshot/orchestrator.js';
import { diffSnapshots } from '../../core/snapshot/diff.js';
import type { DiffChange, SnapshotDiff } from '../../core/snapshot/diff.js';
import {
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  planPrune,
  saveSnapshot,
} from '../../core/snapshot/store.js';
import type { PruneCriteria } from '../../core/snapshot/store.js';
import { AUTO_SNAPSHOT_PREFIX } from '../../core/snapshot/autoSnapshot.js';
import type {
  AppEntities,
  CaptureReport,
  RestoreContext,
  Snapshot,
  SnapshotContext,
  SnapshotSource,
  SnapshotStore,
} from '../../core/types.js';
import type { ActionStatus, PlannedAction } from '../../core/ascSync.js';

/** The literal `against` token that means "capture live state now and diff against it" rather than a saved name. */
const LIVE = 'live';

/** Glyphs for the three diff outcomes, matching `launch plan`'s `+`/`~`/`-` vocabulary. */
const DIFF_GLYPH: Record<DiffChange, string> = { added: '+', removed: '-', changed: '~' };

/** Human store name for a report header. */
function storeLabel(store: SnapshotStore): string {
  return store === 'appstore' ? 'App Store' : 'Google Play';
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
  return `snapshot-${capturedAt.replace(/[:.]/g, '-')}`;
}

/** Total captured items across a snapshot's surfaces (skipped/errored surfaces contribute none). */
function countEntities(snapshot: Snapshot): number {
  let total = 0;
  for (const report of snapshot.reports) {
    if (report.outcome.state === 'captured') {
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
export async function runSnapshotCreate(
  input: CaptureOptions & { name?: string | undefined },
): Promise<void> {
  registerBuiltinSources();
  const log = createLogger(false);
  const capturedAt = new Date().toISOString();
  const name = input.name ?? defaultName(capturedAt);
  const ctx = await buildContext(input.app);
  const result = await captureSnapshot(ctx, listSnapshotSources(), { name, capturedAt });
  const file = saveSnapshot(result.snapshot);

  if (input.json === true) log.line(JSON.stringify({ ...result, file }, null, 2));
  else renderCapture(log, result, file);
  process.exitCode = result.exitCode;
}

/** Render one capture run grouped by store, then a one-line summary keyed to completeness. */
function renderCapture(log: Logger, result: CaptureResult, file: string): void {
  for (const store of ['appstore', 'play'] as const) {
    const reports = result.snapshot.reports.filter((report) => report.store === store);
    if (reports.length === 0) continue;
    log.info(storeLabel(store));
    for (const report of reports) renderCaptureReport(log, report);
  }

  const parts = [`${result.entityCount} item(s)`];
  if (result.skippedCount > 0) parts.push(`${result.skippedCount} skipped`);
  if (result.errorCount > 0) parts.push(`${result.errorCount} unreadable`);
  log.gap();
  log.info(`Snapshot "${result.snapshot.name}" saved to ${file} (${parts.join(', ')})`);
  if (result.errorCount > 0) log.warn('Snapshot is incomplete — a surface could not be read.');
}

/** Render one captured/skipped/errored surface. */
function renderCaptureReport(log: Logger, report: CaptureReport): void {
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
  if (outcome.state !== 'captured') return; // 'omitted' surfaces are dropped before persisting; never rendered
  for (const app of outcome.apps) {
    log.step(title, `${app.app}: ${app.entities.length} item(s)`);
  }
}

/**
 * `snapshot diff <baseline> [against]` — compare a saved snapshot against another saved snapshot or, by
 * default, freshly-captured live state. Informational: differences are never a failure (that's `launch
 * drift`); only an operational error (an unknown snapshot name) exits non-zero.
 */
export async function runSnapshotDiff(
  input: CaptureOptions & { baseline: string; against: string },
): Promise<void> {
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
  if (input.json === true) log.line(JSON.stringify(diff, null, 2));
  else renderDiff(log, diff, input.baseline, input.against);
}

/** Render a diff grouped by store → app, then a one-line summary. */
function renderDiff(
  log: Logger,
  diff: SnapshotDiff,
  baselineName: string,
  againstName: string,
): void {
  log.info(`${baselineName} → ${againstName}`);
  if (diff.entries.length === 0) {
    log.info('In sync — no differences.');
    return;
  }

  for (const store of ['appstore', 'play'] as const) {
    const entries = diff.entries.filter((entry) => entry.store === store);
    if (entries.length === 0) continue;
    log.info(storeLabel(store));
    for (const entry of entries) {
      log.info(`  ${DIFF_GLYPH[entry.change]} ${entry.app} ${entry.key} — ${entry.summary}`);
    }
  }

  log.gap();
  log.info(
    `Diff: ${diff.addedCount} added, ${diff.changedCount} changed, ${diff.removedCount} removed`,
  );
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
    log.line(json);
  }
}

/** `snapshot list` — list saved snapshots, newest first. */
export async function runSnapshotList(input: { json?: boolean }): Promise<void> {
  const log = createLogger(false);
  const snapshots = listSnapshots();
  if (input.json === true) {
    log.line(
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
    log.info('No snapshots yet. Capture one with `launch snapshot create`.');
    return;
  }
  for (const snapshot of snapshots) {
    log.step(
      'snapshot',
      `${snapshot.name} — ${snapshot.capturedAt} — ${countEntities(snapshot)} item(s)`,
    );
  }
}

/**
 * `snapshot delete <name>` — remove one saved snapshot. An unknown name is an operational error (exit 1);
 * a successful delete is idempotent end state ("gone").
 */
export async function runSnapshotDelete(input: { name: string; json?: boolean }): Promise<void> {
  const log = createLogger(false);
  if (!loadSnapshot(input.name)) {
    missingSnapshot(log, input.name);
    return;
  }
  const deleted = deleteSnapshot(input.name);
  if (input.json === true) {
    log.line(JSON.stringify({ deleted, name: input.name }, null, 2));
    return;
  }
  log.info(`Deleted snapshot "${input.name}".`);
}

/** CLI options for `snapshot prune`. Counts arrive as strings from commander and are validated here. */
interface PruneOptions {
  /** Keep only the N newest (string from the CLI). */
  keep?: string;
  /** Delete snapshots older than N days (string from the CLI). */
  olderThan?: string;
  /** Actually delete; without it the run is a dry-run preview. */
  yes?: boolean;
  /** Machine-readable output. */
  json?: boolean;
}

/** Parse a non-negative-integer CLI count, reporting and failing the run when it's malformed. */
function parseCount(raw: string, flag: string, log: Logger): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    log.error(`${flag} must be a non-negative integer.`);
    process.exitCode = 1;
    return null;
  }
  return value;
}

/**
 * `snapshot prune [--keep N] [--older-than DAYS]` — delete old **user** snapshots by count and/or age. The
 * automatic pre-sync baselines (reserved `pre-sync-` prefix, self-pruned by `launch sync`) are excluded so a
 * prune never erases a sync's safety net. Requires at least one rule, and is a dry-run preview until `--yes`.
 */
export async function runSnapshotPrune(input: PruneOptions): Promise<void> {
  const log = createLogger(false);
  if (input.keep === undefined && input.olderThan === undefined) {
    log.error('Specify at least one of --keep or --older-than.');
    process.exitCode = 1;
    return;
  }

  const criteria: PruneCriteria = {};
  if (input.keep !== undefined) {
    const keep = parseCount(input.keep, '--keep', log);
    if (keep === null) return;
    criteria.keep = keep;
  }
  if (input.olderThan !== undefined) {
    const days = parseCount(input.olderThan, '--older-than', log);
    if (days === null) return;
    criteria.olderThanDays = days;
  }

  const eligible = listSnapshots().filter(
    (snapshot) => !snapshot.name.startsWith(AUTO_SNAPSHOT_PREFIX),
  );
  const doomed = planPrune(eligible, criteria, new Date());
  const dryRun = input.yes !== true;
  if (!dryRun) for (const snapshot of doomed) deleteSnapshot(snapshot.name);

  if (input.json === true) {
    log.line(JSON.stringify({ pruned: doomed.map((snapshot) => snapshot.name), dryRun }, null, 2));
    return;
  }
  if (doomed.length === 0) {
    log.info('Nothing to prune.');
    return;
  }
  for (const snapshot of doomed) {
    log.step(dryRun ? 'would delete' : 'deleted', `${snapshot.name} — ${snapshot.capturedAt}`);
  }
  log.gap();
  log.info(
    dryRun
      ? `${doomed.length} snapshot(s) would be deleted (dry-run — re-run with --yes to delete)`
      : `Pruned ${doomed.length} snapshot(s).`,
  );
}

/** CLI options for `snapshot restore`. */
interface RestoreOptions {
  /** Comma-separated app handles; default is every captured app. */
  app?: string;
  /** Restore only this source id (e.g. `apple-listing`). */
  source?: string;
  /** Actually apply the restore; without it the run is a dry-run plan. */
  yes?: boolean;
  /** Machine-readable output. */
  json?: boolean;
}

/** A source that implements `restore` — narrowed so the optional method is callable without a non-null assertion. */
type RestorableSource = SnapshotSource & { restore: NonNullable<SnapshotSource['restore']> };

/** One source's restore outcome for rendering and `--json`. */
interface SourceRestore {
  source: string;
  title: string;
  actions: PlannedAction[];
}

/** Glyph per action status, reusing `launch plan`'s additive vocabulary plus apply/fail markers. */
const RESTORE_GLYPH: Record<ActionStatus, string> = {
  planned: '+',
  applied: '✓',
  skipped: '–',
  failed: '✗',
};

/** The saved per-app entities for one source, narrowed to the `-a` selector (empty when the source isn't captured). */
function savedEntitiesFor(
  snapshot: Snapshot,
  sourceId: string,
  appSelector: string | undefined,
): AppEntities[] {
  const report = snapshot.reports.find((entry) => entry.id === sourceId);
  if (report?.outcome.state !== 'captured') return [];
  if (appSelector === undefined) return report.outcome.apps;
  const wanted = new Set(
    appSelector
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
  );
  return report.outcome.apps.filter((app) => wanted.has(app.app));
}

/** Build the write-capable restore context: config + apps narrowed by `-a` + the read-write ASC and Play resolvers. */
async function buildRestoreContext(appSelector: string | undefined): Promise<RestoreContext> {
  const { config, apps } = await loadConfig();
  return {
    config,
    apps: selectApps(apps, appSelector),
    resolveAscWriteClient: createAscClientResolver(),
    resolvePlayWriteClient: createPlayClientResolver(),
  };
}

/**
 * `snapshot restore <name>` — push a saved snapshot back to live. Additive: it only creates/patches, never
 * removes. A dry-run plan is shown by default; `--yes` applies it. Only config-complete surfaces write (the
 * App Store listing and the Play catalog) — the Apple catalog is reported as preview-only. The cross-surface
 * `diff` (saved → live) is included under `--json` so an agent sees drift the writer can't undo.
 */
export async function runSnapshotRestore(input: RestoreOptions & { name: string }): Promise<void> {
  const log = createLogger(false);
  const saved = loadSnapshot(input.name);
  if (!saved) {
    missingSnapshot(log, input.name);
    return;
  }

  registerBuiltinSources();
  const sources = listSnapshotSources();
  const targets = sources
    .filter((source): source is RestorableSource => typeof source.restore === 'function')
    .filter((source) => input.source === undefined || source.id === input.source)
    .filter((source) => savedEntitiesFor(saved, source.id, input.app).length > 0);

  const liveCtx = await buildContext(input.app);
  const live = await captureSnapshot(liveCtx, sources, {
    name: LIVE,
    capturedAt: new Date().toISOString(),
  });
  const preview = diffSnapshots(saved, live.snapshot);

  const dryRun = input.yes !== true;
  const restoreCtx = await buildRestoreContext(input.app);
  const restored: SourceRestore[] = [];
  for (const source of targets) {
    // biome-ignore lint/performance/noAwaitInLoops: serial per-source restore — each source applies its ordered side effects in turn
    const report = await source.restore({
      ctx: restoreCtx,
      saved: savedEntitiesFor(saved, source.id, input.app),
      dryRun,
    });
    restored.push({ source: source.id, title: source.title, actions: report.actions });
  }

  if (input.json === true) log.line(JSON.stringify({ preview, restored, dryRun }, null, 2));
  else renderRestore(log, saved, input.name, restored, dryRun, input.source);

  if (restored.some((entry) => entry.actions.some((action) => action.status === 'failed')))
    process.exitCode = 1;
}

/** Captured-but-not-restorable surfaces, surfaced so the user knows what restore skipped. */
function previewOnlyTitles(
  saved: Snapshot,
  restored: SourceRestore[],
  sourceFilter: string | undefined,
): string[] {
  const restorable = new Set(restored.map((entry) => entry.source));
  return saved.reports
    .filter((report) => report.outcome.state === 'captured' && !restorable.has(report.id))
    .filter((report) => sourceFilter === undefined || report.id === sourceFilter)
    .map((report) => `${report.title} (${report.id})`);
}

/** Render a restore run: per-source planned/applied actions, the preview-only surfaces, then a summary. */
function renderRestore(
  log: Logger,
  saved: Snapshot,
  name: string,
  restored: SourceRestore[],
  dryRun: boolean,
  sourceFilter: string | undefined,
): void {
  log.info(`Restore "${name}" → live`);

  const actionCount = restored.reduce((total, entry) => total + entry.actions.length, 0);
  if (actionCount === 0) {
    log.info(
      'Nothing to restore — the saved listing already matches live (or no restorable surface is in scope).',
    );
  }
  for (const entry of restored) {
    if (entry.actions.length === 0) continue;
    log.info(entry.title);
    for (const action of entry.actions) {
      const error = action.error ? ` — ${action.error}` : '';
      log.info(`  ${RESTORE_GLYPH[action.status]} ${action.description}${error}`);
    }
  }

  const previewOnly = previewOnlyTitles(saved, restored, sourceFilter);
  if (previewOnly.length > 0) {
    log.gap();
    log.warn(`Preview-only (no restore support yet): ${previewOnly.join(', ')}`);
    log.tip(
      'the Apple catalog captures a summary-grade record; restore is wired for the App Store listing + Play catalog',
    );
  }

  log.gap();
  if (dryRun) {
    if (actionCount > 0) log.info('(dry-run — re-run with --yes to apply)');
  } else {
    const applied = restored.reduce(
      (n, e) => n + e.actions.filter((a) => a.status === 'applied').length,
      0,
    );
    const failed = restored.reduce(
      (n, e) => n + e.actions.filter((a) => a.status === 'failed').length,
      0,
    );
    log.info(`Restored ${applied} change(s)${failed > 0 ? `, ${failed} failed` : ''}.`);
  }
}

/** Report an unknown snapshot name consistently and set the failure exit code. */
function missingSnapshot(log: Logger, name: string): void {
  log.error(`No snapshot named "${name}".`);
  log.tip('run `launch snapshot list` to see saved snapshots');
  process.exitCode = 1;
}

/** Attach the `snapshot` command group and its subcommands to the program. */
export function registerSnapshotCommand(program: Command): void {
  const snapshot = program
    .command('snapshot')
    .description('capture, diff, and export point-in-time copies of live store state (read-only)');

  snapshot
    .command('create [name]')
    .description('capture live App Store + Play state into a named snapshot')
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (name: string | undefined, options: CaptureOptions) => {
      await runSnapshotCreate({ ...options, name });
    });

  snapshot
    .command('list')
    .description('list saved snapshots, newest first')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (options: { json?: boolean }) => {
      await runSnapshotList(options);
    });

  snapshot
    .command('diff <baseline> [against]')
    .description(
      'compare a saved snapshot against another saved snapshot or live state (default: live)',
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (baseline: string, against: string | undefined, options: CaptureOptions) => {
      await runSnapshotDiff({ ...options, baseline, against: against ?? LIVE });
    });

  snapshot
    .command('export <name>')
    .description('print a saved snapshot as JSON, or write it to a file with --out')
    .option('--out <file>', 'write the snapshot JSON to this file instead of stdout')
    .action(async (name: string, options: { out?: string }) => {
      await runSnapshotExport({ name, ...options });
    });

  snapshot
    .command('delete <name>')
    .description('delete a saved snapshot by name')
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (name: string, options: { json?: boolean }) => {
      await runSnapshotDelete({ name, ...options });
    });

  snapshot
    .command('prune')
    .description(
      'delete old user snapshots by count and/or age (auto pre-sync baselines are never touched)',
    )
    .option('--keep <n>', 'keep only the N newest snapshots')
    .option('--older-than <days>', 'delete snapshots older than N days')
    .option('--yes', 'actually delete (without it, a dry-run preview is shown)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (options: PruneOptions) => {
      await runSnapshotPrune(options);
    });

  snapshot
    .command('restore <name>')
    .description(
      "restore a saved snapshot's App Store listing + Play catalog back to live (additive; --yes to apply)",
    )
    .option('-a, --app <names>', 'comma-separated app handles (default: all apps)')
    .option('--source <id>', 'restore only this source (e.g. apple-listing)')
    .option('--yes', 'actually apply the restore (without it, a dry-run plan is shown)', false)
    .option('--json', 'machine-readable output for CI/agents', false)
    .action(async (name: string, options: RestoreOptions) => {
      await runSnapshotRestore({ name, ...options });
    });
}
