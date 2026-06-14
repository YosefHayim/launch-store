/**
 * `launch updates list` / `view` / `rollback` — inspect and reverse published OTA updates.
 *
 * The OTA-side twin of `launch builds` (artifacts): `launch update` publishes an update and records it in
 * a per-(channel, platform) history index plus an immutable manifest snapshot (see `core/updateHistory.ts`).
 * These commands read that history back — `list` tabulates it, `view` shows one update's manifest detail —
 * and `rollback` reverses a bad OTA. Rollback has two modes: republish a prior known-good update as a brand
 * new active manifest (the default; pick it interactively or with `--to <id>`), or `--to-embedded`, which
 * publishes a protocol-v1 `rollBackToEmbedded` directive that drops clients to the bundle baked into the
 * binary. Everything flows through the configured cloud {@link StorageProvider}; `local` has no public URL
 * to serve, so the lifecycle (like publishing) requires a cloud bucket.
 */

import { randomUUID } from "node:crypto";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { LaunchConfig, Platform, StorageProvider } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger } from "../../core/logger.js";
import { isCloudStorage, resolveStorageProvider } from "../../core/storage.js";
import { ensureCodeSigner } from "../../core/codeSign.js";
import { pickOne } from "../../core/prompt.js";
import { historySnapshotKey, type UpdateHistoryEntry, type UpdateManifest } from "../../core/otaManifest.js";
import { findHistoryEntry, readHistory, republishUpdate, setRollbackToEmbedded } from "../../core/updateHistory.js";
import { resolveRuntimeVersion } from "./update.js";

/** A history entry tagged with the platform whose per-platform index it came from — the list/picker row. */
export interface UpdateRow extends UpdateHistoryEntry {
  /** Which platform's per-(channel, platform) index this entry was read from. */
  platform: Platform;
}

/** Both platforms, in the order `list` and the picker present them. */
const PLATFORMS: Platform[] = ["ios", "android"];

/** Abbreviate a UUID to its first segment for compact display (full id stays available via `--json`/`--to`). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Trim an ISO-8601 timestamp to a compact, locale-independent `YYYY-MM-DD HH:MM` for display. */
function formatDate(iso: string): string {
  return iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso;
}

/** Resolve the `--platform` filter to the platforms to read; absent matches both. */
function parsePlatformFilter(value: string | undefined): Platform[] {
  if (value === undefined) return PLATFORMS;
  if (value !== "ios" && value !== "android") {
    throw new Error(`Unknown --platform "${value}". Use "ios" or "android".`);
  }
  return [value];
}

/** OTA history lives in the public bucket; `local` storage can't serve it, so require a cloud provider. */
function requireCloudStorage(config: LaunchConfig): void {
  if (!isCloudStorage(config)) {
    throw new Error(
      'OTA updates need a cloud storage provider. Set `storage: "s3"` (or `supabase`) in launch.config.ts.',
    );
  }
}

/** Read every platform's history for a channel, tag each entry with its platform, newest first across all. */
async function loadEntries(storage: StorageProvider, channel: string, platforms: Platform[]): Promise<UpdateRow[]> {
  const rows: UpdateRow[] = [];
  for (const platform of platforms) {
    for (const entry of await readHistory(storage, channel, platform)) rows.push({ ...entry, platform });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Column definitions for the `updates list` table — one source for headers and per-row cell values. */
const COLUMNS: { header: string; cell: (row: UpdateRow) => string }[] = [
  { header: "UPDATE", cell: (row) => shortId(row.id) },
  { header: "PLATFORM", cell: (row) => row.platform },
  { header: "RUNTIME", cell: (row) => row.runtimeVersion },
  { header: "CREATED", cell: (row) => formatDate(row.createdAt) },
  { header: "ACTIVE", cell: (row) => (row.active ? "yes" : "") },
  { header: "KIND", cell: (row) => row.kind },
];

/** Render update rows as a left-aligned, column-padded table (header first). Assumes a non-empty list. */
export function formatUpdatesTable(rows: UpdateRow[]): string {
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

/** Render the detail block for one update, including the launch bundle URL + asset count from its snapshot. */
export function formatUpdateDetail(row: UpdateRow, manifest: UpdateManifest | null): string {
  const lines = [
    `update ${row.id} · ${row.platform} · runtime ${row.runtimeVersion}`,
    `  created: ${formatDate(row.createdAt)}  (${row.kind}${row.active ? ", active" : ""})`,
    `  signed:  ${row.signed ? "yes" : "no"}`,
  ];
  if (manifest) {
    lines.push(`  bundle:  ${manifest.launchAsset.url}`);
    lines.push(`  assets:  ${manifest.assets.length}`);
  }
  return lines.join("\n");
}

/** Gate a rollback on confirmation: `--yes` proceeds; a non-TTY without `--yes` refuses; otherwise prompt. */
async function confirmRollback(canPrompt: boolean, yes: boolean, message: string): Promise<void> {
  if (yes) return;
  if (!canPrompt) throw new Error("Rollback needs confirmation. Re-run with --yes to proceed non-interactively.");
  const proceed = await confirm({ message });
  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — nothing changed.");
    process.exit(0);
  }
}

interface ListOptions {
  channel: string;
  platform?: string;
  runtimeVersion?: string;
  json: boolean;
}

interface ViewOptions {
  channel: string;
  json: boolean;
}

interface RollbackOptions {
  channel: string;
  platform?: string;
  to?: string;
  toEmbedded: boolean;
  runtimeVersion?: string;
  app?: string;
  yes: boolean;
}

/** Attach the `updates` command (with `list` / `view` / `rollback` subcommands) to the program. */
export function registerUpdatesCommand(program: Command): void {
  const updates = program.command("updates").description("inspect and roll back published OTA updates");

  updates
    .command("list")
    .description("list published updates, newest first")
    .option("--channel <name>", "release channel to read", "production")
    .option("--platform <platform>", "only show ios or android updates")
    .option("--runtime-version <v>", "only show updates for this runtime version")
    .option("--json", "output machine-readable JSON", false)
    .action(async (options: ListOptions) => {
      const { config } = await loadConfig();
      requireCloudStorage(config);
      const storage = resolveStorageProvider(config);
      let rows = await loadEntries(storage, options.channel, parsePlatformFilter(options.platform));
      if (options.runtimeVersion) rows = rows.filter((row) => row.runtimeVersion === options.runtimeVersion);
      if (options.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        console.log(`No updates on channel "${options.channel}". Run \`launch update\` to publish one.`);
        return;
      }
      console.log(formatUpdatesTable(rows));
      console.log(`\n${rows.length} update${rows.length === 1 ? "" : "s"} on "${options.channel}".`);
    });

  updates
    .command("view")
    .description("show full detail for one published update")
    .argument("<id|latest>", "an update id from `updates list`, a short id prefix, or `latest`")
    .option("--channel <name>", "release channel to read", "production")
    .option("--json", "output machine-readable JSON", false)
    .action(async (ref: string, options: ViewOptions) => {
      const { config } = await loadConfig();
      requireCloudStorage(config);
      const storage = resolveStorageProvider(config);
      const row = findHistoryEntry(await loadEntries(storage, options.channel, PLATFORMS), ref);
      if (!row) {
        throw new Error(
          `No update matches "${ref}" on "${options.channel}". Run \`launch updates list\` to see what's available.`,
        );
      }
      const snapshot = await storage.getObject(
        historySnapshotKey(options.channel, row.platform, row.runtimeVersion, row.id),
      );
      const manifest = snapshot ? (JSON.parse(snapshot.toString("utf8")) as UpdateManifest) : null;
      console.log(options.json ? JSON.stringify({ ...row, manifest }, null, 2) : formatUpdateDetail(row, manifest));
    });

  updates
    .command("rollback")
    .description("republish a prior update, or roll clients back to the embedded bundle")
    .option("--channel <name>", "release channel to roll back", "production")
    .option("--platform <platform>", "limit to ios or android (default: both)")
    .option("--to <id>", "republish a specific update id (skips the picker)")
    .option("--to-embedded", "roll clients back to the bundle embedded in the binary", false)
    .option("--runtime-version <v>", "runtime version for --to-embedded (default: from app config)")
    .option("-a, --app <name>", "app handle (used to resolve the runtime version for --to-embedded)")
    .option("-y, --yes", "skip the confirmation prompt (for CI/agents)", false)
    .action(async (options: RollbackOptions) => {
      const log = createLogger(false);
      const { config, apps } = await loadConfig();
      requireCloudStorage(config);
      const storage = resolveStorageProvider(config);
      const platforms = parsePlatformFilter(options.platform);
      const canPrompt = !options.yes && process.stdin.isTTY;

      if (options.toEmbedded) {
        const app = await selectApp(apps, options.app);
        const runtimeVersion = resolveRuntimeVersion(app, options.runtimeVersion);
        await confirmRollback(
          canPrompt,
          options.yes,
          `Roll ${options.channel} / ${platforms.join("+")} (runtime ${runtimeVersion}) back to the EMBEDDED bundle?`,
        );
        const commitTime = new Date().toISOString();
        for (const platform of platforms) {
          const history = await readHistory(storage, options.channel, platform);
          // Match the channel's signing posture: sign the directive iff prior updates here were signed.
          const signed =
            (history.find((entry) => entry.runtimeVersion === runtimeVersion) ?? history[0])?.signed ?? true;
          const signer = signed ? await ensureCodeSigner(false, log) : null;
          await setRollbackToEmbedded({
            storage,
            channel: options.channel,
            platform,
            runtimeVersion,
            commitTime,
            signer,
          });
          log.step("rollback", `${platform} · runtime ${runtimeVersion} → embedded`, "ota-update");
        }
        log.info("Clients drop to the embedded build on next poll. The next `launch update` publish clears this.");
        return;
      }

      const all = await loadEntries(storage, options.channel, platforms);
      let target: UpdateRow | undefined;
      if (options.to) {
        const ref = options.to;
        target = all.find((row) => row.id === ref || row.id.startsWith(ref));
        if (!target) throw new Error(`No update matches --to "${ref}" on "${options.channel}".`);
      } else {
        const candidates = all.filter((row) => !row.active);
        if (candidates.length === 0) {
          throw new Error(
            `No prior update to roll back to on "${options.channel}". Need a non-active update in history.`,
          );
        }
        target = await pickOne<UpdateRow>({
          message: "Pick an update to roll back to",
          options: candidates.map((row) => ({
            value: row,
            label: `${shortId(row.id)} · ${row.platform} · runtime ${row.runtimeVersion}`,
            hint: `${formatDate(row.createdAt)}${row.kind === "rollback" ? " · rollback" : ""}`,
          })),
          canPrompt,
          nonInteractive: { kind: "require", flagHint: "Pass --to <id> (see `launch updates list`)." },
        });
      }

      await confirmRollback(
        canPrompt,
        options.yes,
        `Republish ${shortId(target.id)} (${target.platform}, runtime ${target.runtimeVersion}) as the active update on "${options.channel}"?`,
      );
      const signer = target.signed ? await ensureCodeSigner(false, log) : null;
      const { entry } = await republishUpdate({
        storage,
        channel: options.channel,
        platform: target.platform,
        target,
        newId: randomUUID(),
        createdAt: new Date().toISOString(),
        signer,
      });
      log.step(
        "rollback",
        `${target.platform} · republished ${shortId(target.id)} as ${shortId(entry.id)}`,
        "ota-update",
      );
      log.info("Active manifest updated — clients pull the prior bundle on next poll.");
      if (platforms.length > 1)
        log.info("Rolled back one platform; rerun for the other if both shipped the bad update.");
    });
}
