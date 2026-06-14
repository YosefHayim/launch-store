/**
 * `launch builds list` / `launch builds view` — read the local build history.
 *
 * Every successful build is copied into the artifact store and recorded in a newest-first index (see
 * the `local` {@link StorageProvider}). These commands surface that history — the local equivalent of
 * `eas build:list` / `eas build:view` — so you can see what shipped, how large each build was, and
 * where the artifact lives, without re-running anything. They go through the configured storage
 * provider's `list()`, so whichever backend stored a build is the one that reports it. Read-only:
 * they never build, upload, or mutate state.
 */

import { existsSync } from "node:fs";
import type { Command } from "commander";
import type { BuildArtifact, Platform } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { resolveStorageProvider } from "../../core/storage.js";
import { mb, sizeSummary, worstDownloadBytes } from "../../core/pipeline.js";
import { buildLogId, buildLogPath, readBuildLog } from "../../core/buildLog.js";
import { run } from "../../core/exec.js";
import { hostOs } from "../../core/os.js";

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
  };
}

/** Narrow the build history to an app and/or platform; an absent filter matches everything. */
export function filterBuilds(builds: BuildArtifact[], filters: { app?: string; platform?: Platform }): BuildArtifact[] {
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
  if (ref === "latest") return builds[0];
  return builds.find((build) => buildId(build) === ref || String(build.buildNumber) === ref);
}

/** Trim an ISO-8601 timestamp to a compact, locale-independent `YYYY-MM-DD HH:MM` for display. */
function formatDate(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/** Column definitions for the `builds list` table — one source for headers and per-row cell values. */
const COLUMNS: { header: string; cell: (row: BuildRow) => string }[] = [
  { header: "BUILD", cell: (row) => String(row.buildNumber) },
  { header: "APP", cell: (row) => row.app },
  { header: "VERSION", cell: (row) => row.version },
  { header: "PLATFORM", cell: (row) => row.platform },
  { header: "DOWNLOAD", cell: (row) => mb(row.downloadBytes) },
  { header: "CREATED", cell: (row) => formatDate(row.createdAt) },
  { header: "TYPE", cell: (row) => (row.clean ? "clean" : "incremental") },
];

/** Render the build rows as a left-aligned, column-padded table (header first). Assumes a non-empty list. */
export function formatBuildsTable(rows: BuildRow[]): string {
  const widths = COLUMNS.map((column) => Math.max(column.header.length, ...rows.map((row) => column.cell(row).length)));
  const render = (cells: string[]): string =>
    cells
      .map((cell, i) => cell.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [
    render(COLUMNS.map((column) => column.header)),
    ...rows.map((row) => render(COLUMNS.map((column) => column.cell(row)))),
  ].join("\n");
}

/** Render the full detail block for one build, including the per-device size breakdown when present. */
export function formatBuildDetail(artifact: BuildArtifact): string {
  const lines = [
    `${artifact.appName} ${artifact.version} (build ${artifact.buildNumber}) · ${artifact.platform}`,
    `  ${sizeSummary(artifact.sizeReport)}`,
    `  profile:  ${artifact.profile}`,
    `  built:    ${formatDate(artifact.createdAt)}  (${artifact.clean ? "clean" : "incremental"})`,
    `  id:       ${buildId(artifact)}`,
    `  artifact: ${artifact.path}`,
  ];
  if (artifact.sizeReport.entries.length > 0) {
    lines.push("  per-device download / install:");
    for (const entry of artifact.sizeReport.entries) {
      lines.push(`    ${entry.device}  download ${mb(entry.downloadBytes)}  install ${mb(entry.installBytes)}`);
    }
  }
  return lines.join("\n");
}

/** Validate the `--platform` filter, throwing on anything but the two platforms. */
function parsePlatformFilter(value: string | undefined): Platform | undefined {
  if (value === undefined) return undefined;
  if (value !== "ios" && value !== "android") {
    throw new Error(`Unknown --platform "${value}". Use "ios" or "android".`);
  }
  return value;
}

/** Load the build history via the configured storage provider (newest-first). */
async function loadHistory(): Promise<BuildArtifact[]> {
  const { config } = await loadConfig();
  return resolveStorageProvider(config).list();
}

/**
 * Reveal a log file: prefer `$EDITOR`, else the OS viewer (`open`/`xdg-open`). On Windows without an
 * `$EDITOR` there's no shell-free opener, so we print the path for the user to open. Best-effort UX.
 */
async function openLog(path: string): Promise<void> {
  const editor = process.env["EDITOR"];
  if (editor) return run(editor, [path]);
  const os = hostOs();
  if (os === "macos") return run("open", [path]);
  if (os === "linux") return run("xdg-open", [path]);
  console.log(`Log file: ${path}  (set $EDITOR to open it automatically)`);
}

/** Attach the `builds` command (with `list` / `view` subcommands) to the program. */
export function registerBuildsCommand(program: Command): void {
  const builds = program.command("builds").description("inspect local build history (the artifact index)");

  builds
    .command("list")
    .description("list past builds, newest first")
    .option("-a, --app <name>", "only show builds for this app")
    .option("--platform <platform>", "only show ios or android builds")
    .option("--json", "output machine-readable JSON", false)
    .action(async (options: { app?: string; platform?: string; json: boolean }) => {
      const platform = parsePlatformFilter(options.platform);
      const matched = filterBuilds(await loadHistory(), {
        ...(options.app ? { app: options.app } : {}),
        ...(platform ? { platform } : {}),
      });
      const rows = matched.map(toBuildRow);
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log("No builds yet. Run `launch build ios` (or android) to create one.");
        return;
      }
      console.log(formatBuildsTable(rows));
      console.log(`\n${rows.length} build${rows.length === 1 ? "" : "s"}.`);
    });

  builds
    .command("view")
    .description("show full detail for one build")
    .argument("<id|latest>", "a build id from `builds list`, a build number, or `latest`")
    .option("--json", "output machine-readable JSON", false)
    .action(async (ref: string, options: { json: boolean }) => {
      const found = findBuild(await loadHistory(), ref);
      if (!found) {
        throw new Error(`No build matches "${ref}". Run \`launch builds list\` to see what's available.`);
      }
      console.log(options.json ? JSON.stringify(toBuildRow(found), null, 2) : formatBuildDetail(found));
    });

  builds
    .command("log")
    .description("print a past build's full native log (secrets redacted), or open it in your editor")
    .argument("<id|latest>", "a build id from `builds list`, a build number, or `latest`")
    .option("--open", "reveal the log in your editor / OS viewer instead of printing it", false)
    .action(async (ref: string, options: { open: boolean }) => {
      const found = findBuild(await loadHistory(), ref);
      if (!found) {
        throw new Error(`No build matches "${ref}". Run \`launch builds list\` to see what's available.`);
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
      console.log(text?.trim() ? text : "(log is empty)");
    });
}
