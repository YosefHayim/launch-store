/**
 * `launch builds list` / `view` / `log` / `prune` — read and trim the local build history.
 *
 * Every successful build is copied into the artifact store and recorded in a newest-first index (see
 * the `local` {@link StorageProvider}). `list`/`view`/`log` surface that history — the local equivalent
 * of `eas build:list` / `eas build:view` — so you can see what shipped, how large each build was, and
 * where the artifact lives, without re-running anything; `prune` reclaims disk by deleting binaries past
 * the retention window (keeping the newest per app+platform, and the history row as a `pruned` marker).
 * They go through the configured storage provider, so whichever backend stored a build reports/trims it.
 */

import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { cancel, confirm, isCancel } from '@clack/prompts';
import type { BuildArtifact, Platform, PrunedArtifact } from '../../core/types.js';
import { parsePlatform } from '../../core/platform.js';
import { loadConfig } from '../../core/config.js';
import { resolveStorageProvider } from '../../core/storage.js';
import { resolveCommandRetentionDays } from '../../core/artifactRetention.js';
import { mb, sizeSummary, worstDownloadBytes } from '../../core/pipeline.js';
import { buildLogId, buildLogPath, readBuildLog } from '../../core/buildLog.js';
import { run } from '../../core/exec.js';
import { hostOs } from '../../core/os.js';
import { createLogger } from '../../core/logger.js';

const log = createLogger(false);

/**
 * A flat, presentation-ready view of one stored build — the shape `builds list --json` emits and the
 * table renders. Distinct from {@link BuildArtifact} so the rendered/scripted output stays stable even
 * if the persisted record grows fields, and so the worst-case download is pre-computed once.
 */
export interface BuildRow {
  /** Stable, provider-independent build id (see {@link buildId}) — what `view <id>` matches on. */
  id: string;
  app: string;
  version: string;
  platform: Platform;
  buildNumber: number;
  /** Worst-case per-device store download in bytes (falls back to the on-disk size). */
  downloadBytes: number;
  /** Raw artifact size on disk in bytes (the `.ipa`/`.aab`). */
  artifactBytes: number;
  clean: boolean;
  createdAt: string;
  path: string;
  /** ISO-8601 stamp when retention removed the binary; present means the file is gone (history kept). */
  prunedAt?: string;
}

/**
 * Stable identifier for a build, derived from its natural keys rather than a storage path or file
 * extension, so `builds list`/`view`/`log` agree on it regardless of which provider stored it. The
 * derivation lives in `core/buildLog.ts` (one source of truth shared with the per-build log path).
 */
export function buildId(artifact: BuildArtifact): string {
  return buildLogId(artifact);
}

/** Project a persisted {@link BuildArtifact} into the presentation {@link BuildRow}. */
export function toBuildRow(artifact: BuildArtifact): BuildRow {
  return {
    id: buildId(artifact),
    app: artifact.appName,
    version: artifact.version,
    platform: artifact.platform,
    buildNumber: artifact.buildNumber,
    downloadBytes: worstDownloadBytes(artifact.sizeReport),
    artifactBytes: artifact.sizeReport.artifactBytes,
    clean: artifact.clean,
    createdAt: artifact.createdAt,
    path: artifact.path,
    ...(artifact.prunedAt ? { prunedAt: artifact.prunedAt } : {}),
  };
}

/** Narrow the build history to an app and/or platform; an absent filter matches everything. */
export function filterBuilds(
  builds: BuildArtifact[],
  filters: { app?: string; platform?: Platform },
): BuildArtifact[] {
  return builds.filter(
    (build) =>
      (filters.app === undefined || build.appName === filters.app) &&
      (filters.platform === undefined || build.platform === filters.platform),
  );
}

/**
 * Resolve a `view` reference against the (newest-first) history: `latest` → the newest build,
 * otherwise the first match on the build id or the bare build number. Undefined when nothing matches.
 */
export function findBuild(builds: BuildArtifact[], ref: string): BuildArtifact | undefined {
  if (ref === 'latest') return builds[0];
  return builds.find((build) => buildId(build) === ref || String(build.buildNumber) === ref);
}

/** Trim an ISO-8601 timestamp to a compact, locale-independent `YYYY-MM-DD HH:MM` for display. */
function formatDate(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/** A table column: a header and how to render one row's cell. */
interface Column<T> {
  header: string;
  cell: (row: T) => string;
}

/** Render rows as a left-aligned, column-padded table (header first). Assumes a non-empty `rows`. */
function formatTable<T>(columns: Column<T>[], rows: T[]): string {
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => column.cell(row).length)),
  );
  const render = (cells: string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join('  ')
      .trimEnd();
  return [
    render(columns.map((column) => column.header)),
    ...rows.map((row) => render(columns.map((column) => column.cell(row)))),
  ].join('\n');
}

/** Column definitions for the `builds list` table — one source for headers and per-row cell values. */
const COLUMNS: Column<BuildRow>[] = [
  { header: 'BUILD', cell: (row) => String(row.buildNumber) },
  { header: 'APP', cell: (row) => row.app },
  { header: 'VERSION', cell: (row) => row.version },
  { header: 'PLATFORM', cell: (row) => row.platform },
  { header: 'DOWNLOAD', cell: (row) => mb(row.downloadBytes) },
  { header: 'CREATED', cell: (row) => formatDate(row.createdAt) },
  {
    header: 'TYPE',
    cell: (row) => (row.prunedAt ? 'pruned' : row.clean ? 'clean' : 'incremental'),
  },
];

/** Render the build rows as a left-aligned, column-padded table (header first). Assumes a non-empty list. */
export function formatBuildsTable(rows: BuildRow[]): string {
  return formatTable(COLUMNS, rows);
}

/** Columns for the `builds prune` preview — what each removed binary is and the disk it reclaims. */
const PRUNE_COLUMNS: Column<PrunedArtifact>[] = [
  { header: 'BUILD', cell: (row) => String(row.buildNumber) },
  { header: 'APP', cell: (row) => row.app },
  { header: 'VERSION', cell: (row) => row.version },
  { header: 'PLATFORM', cell: (row) => row.platform },
  { header: 'SIZE', cell: (row) => mb(row.bytes) },
];

/** Render the set of binaries a prune would remove as a table (header first). Assumes a non-empty list. */
export function formatPrunePreview(pruned: PrunedArtifact[]): string {
  return formatTable(PRUNE_COLUMNS, pruned);
}

/** Render the full detail block for one build, including the per-device size breakdown when present. */
export function formatBuildDetail(artifact: BuildArtifact): string {
  const lines = [
    `${artifact.appName} ${artifact.version} (build ${artifact.buildNumber}) · ${artifact.platform}`,
    `  ${sizeSummary(artifact.sizeReport)}`,
    `  profile:  ${artifact.profile}`,
    `  built:    ${formatDate(artifact.createdAt)}  (${artifact.clean ? 'clean' : 'incremental'})`,
    `  id:       ${buildId(artifact)}`,
    artifact.prunedAt
      ? `  artifact: pruned ${formatDate(artifact.prunedAt)} — binary removed to save disk; rebuild to ship`
      : `  artifact: ${artifact.path}`,
  ];
  if (artifact.sizeReport.entries.length > 0) {
    lines.push('  per-device download / install:');
    for (const entry of artifact.sizeReport.entries) {
      lines.push(
        `    ${entry.device}  download ${mb(entry.downloadBytes)}  install ${mb(entry.installBytes)}`,
      );
    }
  }
  return lines.join('\n');
}

/** Validate the `--platform` filter, throwing on an unknown platform; `undefined` means "all platforms". */
function parsePlatformFilter(value: string | undefined): Platform | undefined {
  return value === undefined ? undefined : parsePlatform(value);
}

/** Load the build history via the configured storage provider (newest-first). */
async function loadHistory(): Promise<BuildArtifact[]> {
  const { config } = await loadConfig();
  return resolveStorageProvider(config).list();
}

/** `N build` / `N builds` — the count phrase shared across the prune messages. */
function buildsLabel(count: number): string {
  return `${count} build${count === 1 ? '' : 's'}`;
}

/** Validate `--days`: a positive whole number, or undefined when the flag is absent (use the configured window). */
function parsePruneDays(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Invalid --days "${value}". Use a positive whole number of days.`);
  }
  return days;
}

/** Options accepted by {@link runPrune} — the parsed `builds prune` flags (also the wizard's entry point). */
export interface PruneCommandOptions {
  /** Limit to one app handle. */
  app?: string;
  /** Limit to `ios` or `android` (validated). */
  platform?: string;
  /** Retention window override in days (raw CLI string; validated to a positive integer). */
  days?: string;
  /** Preview only — delete nothing. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (CI / non-interactive). */
  yes?: boolean;
  /** Emit machine-readable JSON instead of human tables. */
  json?: boolean;
}

/**
 * Count how many binaries an at-default prune would remove — the wizard's gate for offering "Clean up old
 * builds" only when it would actually do something. Zero for a non-local store (no `prune`) or an empty/
 * fresh history, so the menu entry simply doesn't appear.
 */
export async function countPrunableBuilds(): Promise<number> {
  const { config } = await loadConfig();
  const provider = resolveStorageProvider(config);
  if (!provider.prune) return 0;
  const preview = await provider.prune({
    now: Date.now(),
    retentionDays: resolveCommandRetentionDays(config),
    dryRun: true,
  });
  return preview.pruned.length;
}

/**
 * Reclaim disk by deleting build binaries older than the retention window, always keeping the newest per
 * app+platform (so a promotable artifact survives) and the history row (shown as `pruned`). Previews first,
 * then — unless `--dry-run` — deletes after a confirmation (`--yes` or an interactive prompt; a
 * non-interactive run without `--yes` refuses rather than delete unattended). Shared by the `builds prune`
 * command and the wizard's cleanup entry.
 */
export async function runPrune(options: PruneCommandOptions): Promise<void> {
  const platform = parsePlatformFilter(options.platform);
  const days = parsePruneDays(options.days);
  const { config } = await loadConfig();
  const provider = resolveStorageProvider(config);
  if (!provider.prune) {
    throw new Error(
      `\`builds prune\` applies only to the local artifact store; storage "${config.storage}" manages ` +
        `retention through its own bucket lifecycle rules.`,
    );
  }
  const retentionDays = resolveCommandRetentionDays(config, days);
  const filter = {
    now: Date.now(),
    retentionDays,
    ...(options.app ? { app: options.app } : {}),
    ...(platform ? { platform } : {}),
  };

  const preview = await provider.prune({ ...filter, dryRun: true });
  if (preview.pruned.length === 0) {
    if (options.json) log.line(JSON.stringify(preview, null, 2));
    else
      log.line(
        `Nothing to prune — no builds older than ${retentionDays}d (the newest per app+platform is always kept).`,
      );
    return;
  }

  if (options.dryRun) {
    if (options.json) {
      log.line(JSON.stringify(preview, null, 2));
      return;
    }
    log.line(formatPrunePreview(preview.pruned));
    log.line(
      `\nDry run — would remove ${buildsLabel(preview.pruned.length)}, freeing ${mb(preview.freedBytes)}. Nothing deleted.`,
    );
    return;
  }

  if (!options.yes) {
    if (!process.stdout.isTTY || options.json) {
      throw new Error(
        'Refusing to delete without confirmation. Re-run with --yes (or --dry-run to preview).',
      );
    }
    log.line(formatPrunePreview(preview.pruned));
    const proceed = await confirm({
      message: `Delete ${buildsLabel(preview.pruned.length)}, freeing ${mb(preview.freedBytes)}?`,
    });
    if (isCancel(proceed) || !proceed) {
      cancel('Nothing deleted.');
      return;
    }
  }

  const result = await provider.prune({ ...filter, dryRun: false });
  if (options.json) {
    log.line(JSON.stringify(result, null, 2));
    return;
  }
  log.line(
    `Pruned ${buildsLabel(result.pruned.length)}, freed ${mb(result.freedBytes)}. History kept (shown as "pruned" in \`builds list\`).`,
  );
}

/**
 * Reveal a log file: prefer `$EDITOR`, else the OS viewer (`open`/`xdg-open`). On Windows without an
 * `$EDITOR` there's no shell-free opener, so we print the path for the user to open. Best-effort UX.
 */
async function openLog(path: string): Promise<void> {
  const editor = process.env['EDITOR'];
  if (editor) return run(editor, [path]);
  const os = hostOs();
  if (os === 'macos') return run('open', [path]);
  if (os === 'linux') return run('xdg-open', [path]);
  log.line(`Log file: ${path}  (set $EDITOR to open it automatically)`);
}

/** Attach the `builds` command (with `list` / `view` / `log` / `prune` subcommands) to the program. */
export function registerBuildsCommand(program: Command): void {
  const builds = program
    .command('builds')
    .description('inspect and trim local build history (the artifact index)');

  builds
    .command('list')
    .description('list past builds, newest first')
    .option('-a, --app <name>', 'only show builds for this app')
    .option(
      '--platform <platform>',
      'only show builds for one platform (ios/android/tvos/macos/visionos)',
    )
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: { app?: string; platform?: string; json: boolean }) => {
      const platform = parsePlatformFilter(options.platform);
      const matched = filterBuilds(await loadHistory(), {
        ...(options.app ? { app: options.app } : {}),
        ...(platform ? { platform } : {}),
      });
      const rows = matched.map(toBuildRow);
      if (options.json) {
        log.line(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        log.line('No builds yet. Run `launch build ios` (or android) to create one.');
        return;
      }
      log.line(formatBuildsTable(rows));
      log.line(`\n${rows.length} build${rows.length === 1 ? '' : 's'}.`);
    });

  builds
    .command('view')
    .description('show full detail for one build')
    .argument('<id|latest>', 'a build id from `builds list`, a build number, or `latest`')
    .option('--json', 'output machine-readable JSON', false)
    .action(async (ref: string, options: { json: boolean }) => {
      const found = findBuild(await loadHistory(), ref);
      if (!found) {
        throw new Error(
          `No build matches "${ref}". Run \`launch builds list\` to see what's available.`,
        );
      }
      log.line(
        options.json ? JSON.stringify(toBuildRow(found), null, 2) : formatBuildDetail(found),
      );
    });

  builds
    .command('log')
    .description(
      "print a past build's full native log (secrets redacted), or open it in your editor",
    )
    .argument('<id|latest>', 'a build id from `builds list`, a build number, or `latest`')
    .option('--open', 'reveal the log in your editor / OS viewer instead of printing it', false)
    .action(async (ref: string, options: { open: boolean }) => {
      const found = findBuild(await loadHistory(), ref);
      if (!found) {
        throw new Error(
          `No build matches "${ref}". Run \`launch builds list\` to see what's available.`,
        );
      }
      const id = buildId(found);
      if (!existsSync(buildLogPath(id))) {
        throw new Error(
          `No stored log for build ${id}. Logs are captured for local builds (run under the progress ` +
            `spinner); CI / --verbose builds stream their output to stdout instead.`,
        );
      }
      if (options.open) {
        await openLog(buildLogPath(id));
        return;
      }
      const text = readBuildLog(id);
      log.line(text?.trim() ? text : '(log is empty)');
    });

  builds
    .command('prune')
    .description(
      'delete build binaries older than the retention window (keeps the newest per app+platform)',
    )
    .option(
      '--days <n>',
      'retention window in days (default: config artifactRetentionDays, else 30)',
    )
    .option('-a, --app <name>', 'only prune builds for this app')
    .option(
      '--platform <platform>',
      'only prune builds for one platform (ios/android/tvos/macos/visionos)',
    )
    .option('--dry-run', 'show what would be deleted without deleting', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .option('--json', 'output machine-readable JSON', false)
    .action(async (options: PruneCommandOptions) => {
      await runPrune(options);
    });
}
