/**
 * `launch screenshots push|list` — config-as-code App Store screenshots across every locale and device
 * family, via the App Store Connect API's reservation upload flow.
 *
 * Why the direct API rather than fastlane `deliver` (which `launch metadata` uses for listing text):
 * `deliver` re-uploads screenshots wholesale, can't diff per target, and its device table lags Apple's
 * newest hardware. This command reserves → PUTs the bytes → commits with an MD5, so an unchanged
 * screenshot is skipped (idempotent), each (locale, device) is planned independently, and a folder named
 * for a display type Launch doesn't recognize yet still uploads instead of erroring.
 *
 * Config is a folder, mirroring `deliver`'s layout so an EAS user feels at home:
 *
 *   <app.dir>/screenshots/<locale>/<displayType>/<NN>.png
 *
 * e.g. `screenshots/en-US/APP_IPHONE_67/01.png`. The display-type folder may be Apple's constant
 * (`APP_IPHONE_67`) or a friendly alias (`iphone-6.7`, `mac`, `watch-ultra`, `vision`). Files upload in
 * filename order.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { runPool } from "../../core/asyncPool.js";
import { md5Hex, uploadReservedAsset } from "../../core/ascAssets.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import type { PlannedAction } from "../../core/ascSync.js";

/** Concurrent screenshot uploads. Bounded so one ASC key stays under Apple's rate ceiling. */
const SCREENSHOT_CONCURRENCY = 4;

/** Image extensions Apple accepts for App Store screenshots. */
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

/** CLI options for `launch screenshots push`. */
interface PushOptions {
  app?: string;
  /** Override the screenshots root (default `<app.dir>/screenshots`). */
  path?: string;
  /** Build and print the per-target plan, then stop without uploading. */
  dryRun?: boolean;
  /** Skip the apply confirmation (required in CI / non-interactive). */
  yes?: boolean;
}

/** CLI options for `launch screenshots list`. */
interface ListOptions {
  app?: string;
}

/** A (locale, resolved displayType) target gathered from disk, with its ordered image files. */
interface DiskTarget {
  locale: string;
  /** Raw folder name as it appears on disk (kept for messages). */
  rawDisplay: string;
  /** Resolved Apple `screenshotDisplayType`. */
  displayType: string;
  files: { fileName: string; path: string }[];
}

/**
 * One planned upload, resolved enough to execute in the apply pass. It holds a reference to its plan
 * line so the apply pass writes the outcome back in place (no parallel-array bookkeeping). `setId` is
 * null when the device-family set doesn't exist yet and must be created first.
 */
interface UploadStep {
  action: PlannedAction;
  localizationId: string;
  displayType: string;
  setId: string | null;
  fileName: string;
  bytes: Buffer;
  checksum: string;
  /** Existing screenshot to delete before re-uploading (same fileName, changed bytes). */
  replaceId: string | null;
}

/**
 * Apple `screenshotDisplayType` constants Launch recognizes — the validation/alias table, NOT a gate.
 * Apple's enum lags new hardware (a 6.9" iPhone reuses `APP_IPHONE_67`), so {@link resolveDisplayType}
 * also passes through any well-formed `APP_*`/`IMESSAGE_APP_*` folder it doesn't find here.
 */
const KNOWN_DISPLAY_TYPES = new Set<string>([
  "APP_IPHONE_67",
  "APP_IPHONE_65",
  "APP_IPHONE_61",
  "APP_IPHONE_58",
  "APP_IPHONE_55",
  "APP_IPHONE_47",
  "APP_IPHONE_40",
  "APP_IPHONE_35",
  "APP_IPAD_PRO_3GEN_129",
  "APP_IPAD_PRO_3GEN_11",
  "APP_IPAD_PRO_129",
  "APP_IPAD_105",
  "APP_IPAD_97",
  "APP_IPAD_11",
  "APP_DESKTOP",
  "APP_WATCH_ULTRA",
  "APP_WATCH_SERIES_10",
  "APP_WATCH_SERIES_7",
  "APP_WATCH_SERIES_4",
  "APP_WATCH_SERIES_3",
  "APP_APPLE_TV",
  "APP_APPLE_VISION_PRO",
]);

/** Friendly folder aliases → Apple's constant, so a config can read `mac`/`watch-ultra` instead of `APP_DESKTOP`. */
const DISPLAY_TYPE_ALIASES: Record<string, string> = {
  "iphone-6.9": "APP_IPHONE_67",
  "iphone-6.7": "APP_IPHONE_67",
  "iphone-6.5": "APP_IPHONE_65",
  "iphone-6.1": "APP_IPHONE_61",
  "iphone-5.8": "APP_IPHONE_58",
  "iphone-5.5": "APP_IPHONE_55",
  "iphone-4.7": "APP_IPHONE_47",
  "ipad-13": "APP_IPAD_PRO_3GEN_129",
  "ipad-12.9": "APP_IPAD_PRO_3GEN_129",
  "ipad-11": "APP_IPAD_PRO_3GEN_11",
  mac: "APP_DESKTOP",
  desktop: "APP_DESKTOP",
  watch: "APP_WATCH_SERIES_7",
  "watch-ultra": "APP_WATCH_ULTRA",
  tv: "APP_APPLE_TV",
  appletv: "APP_APPLE_TV",
  vision: "APP_APPLE_VISION_PRO",
  "vision-pro": "APP_APPLE_VISION_PRO",
  visionpro: "APP_APPLE_VISION_PRO",
};

/**
 * Resolve a screenshots folder name to an Apple `screenshotDisplayType`, or null when it's clearly not
 * one (so the caller logs and skips it). Recognizes the canonical constant (case-insensitively), a
 * friendly alias, and — to tolerate hardware Apple adds before Launch ships a new constant — any
 * well-formed `APP_*`/`IMESSAGE_APP_*` literal it hasn't seen, passing it straight through to Apple.
 */
export function resolveDisplayType(folder: string): string | null {
  const trimmed = folder.trim();
  const canonical = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  if (KNOWN_DISPLAY_TYPES.has(canonical)) return canonical;
  const alias = DISPLAY_TYPE_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;
  return /^(APP|IMESSAGE_APP)_[A-Z0-9_]+$/.test(canonical) ? canonical : null;
}

/** Narrow a thrown value to a human-readable message. */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve the App Store Connect client for the active account, or fail with the fix. */
async function client(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  return new AppStoreConnectClient(ascKey);
}

/** List the immediate subdirectory names of `dir`, sorted for stable output. */
function subdirs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Gather the per-(locale, displayType) screenshot targets from the config folder, warning on skips. */
function collectTargets(root: string, log: Logger): DiskTarget[] {
  const targets: DiskTarget[] = [];
  for (const locale of subdirs(root)) {
    const localeDir = join(root, locale);
    for (const rawDisplay of subdirs(localeDir)) {
      const displayType = resolveDisplayType(rawDisplay);
      if (!displayType) {
        log.warn(`Skipping ${locale}/${rawDisplay} — not a known device family (folder name → screenshotDisplayType).`);
        continue;
      }
      const dir = join(localeDir, rawDisplay);
      const files = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .map((entry) => ({ fileName: entry.name, path: join(dir, entry.name) }))
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
      if (files.length > 0) targets.push({ locale, rawDisplay, displayType, files });
    }
  }
  return targets;
}

/**
 * Read remote state per target and turn the disk targets into a plan: one {@link PlannedAction} per
 * file (upload / replace / skip-unchanged) plus the executable {@link UploadStep}s for everything that
 * isn't already up to date. Pure of writes, so it runs unchanged in `--dry-run`.
 */
async function buildPlan(
  asc: AppStoreConnectClient,
  localeToId: Map<string, string>,
  targets: DiskTarget[],
  log: Logger,
): Promise<{ actions: PlannedAction[]; steps: UploadStep[] }> {
  const actions: PlannedAction[] = [];
  const steps: UploadStep[] = [];

  for (const target of targets) {
    const localizationId = localeToId.get(target.locale.toLowerCase());
    if (!localizationId) {
      log.warn(
        `Skipping locale ${target.locale} — not on the editable version (add it via \`launch metadata\` first).`,
      );
      continue;
    }
    const set = (await asc.listScreenshotSets(localizationId)).find(
      (entry) => entry.displayType === target.displayType,
    );
    const existing = set ? await asc.listScreenshots(set.id) : [];
    const byName = new Map(existing.map((shot) => [shot.fileName, shot]));

    for (const file of target.files) {
      const bytes = readFileSync(file.path);
      const checksum = md5Hex(bytes);
      const prior = byName.get(file.fileName);
      const label = `${target.locale}/${target.displayType}/${file.fileName}`;

      if (prior?.sourceFileChecksum === checksum) {
        actions.push({ description: `${label} — up to date`, destructive: false, status: "skipped" });
        continue;
      }
      const action: PlannedAction = {
        description: `${label} — ${prior ? "replace" : "upload"}`,
        destructive: Boolean(prior),
        status: "planned",
      };
      actions.push(action);
      steps.push({
        action,
        localizationId,
        displayType: target.displayType,
        setId: set?.id ?? null,
        fileName: file.fileName,
        bytes,
        checksum,
        replaceId: prior?.id ?? null,
      });
    }
  }
  return { actions, steps };
}

/**
 * Execute the plan: create any missing device-family sets first (sequentially, so two files never race
 * to create the same set), then upload the rest in parallel. Each step's outcome is written back onto
 * its {@link PlannedAction} in place.
 */
async function applyPlan(asc: AppStoreConnectClient, steps: UploadStep[], log: Logger): Promise<void> {
  const createdSets = new Map<string, string>();
  const failedSets = new Set<string>();
  for (const step of steps) {
    if (step.setId !== null) continue;
    const key = `${step.localizationId}|${step.displayType}`;
    if (createdSets.has(key) || failedSets.has(key)) continue;
    try {
      const set = await asc.createScreenshotSet(step.localizationId, step.displayType);
      createdSets.set(key, set.id);
    } catch (error) {
      failedSets.add(key);
      log.warn(`Could not create screenshot set ${step.displayType}: ${message(error)}`);
    }
  }
  for (const step of steps) {
    if (step.setId === null) {
      step.setId = createdSets.get(`${step.localizationId}|${step.displayType}`) ?? null;
      if (step.setId === null) {
        step.action.status = "failed";
        step.action.error = "screenshot set could not be created";
      }
    }
  }

  const ready = steps.filter((step) => step.setId !== null && step.action.status !== "failed");
  await runPool(ready, SCREENSHOT_CONCURRENCY, async (step) => {
    const setId = step.setId;
    if (setId === null) return;
    try {
      if (step.replaceId) await asc.deleteScreenshot(step.replaceId);
      const reservation = await asc.reserveScreenshot(setId, step.fileName, step.bytes.length);
      await uploadReservedAsset(step.bytes, reservation.operations);
      await asc.commitScreenshot(reservation.id, step.checksum);
      step.action.status = "applied";
    } catch (error) {
      step.action.status = "failed";
      step.action.error = message(error);
    }
  });
}

/**
 * Resolve the editable App Store version's per-locale localization ids (keyed lowercase) — the binding
 * point screenshot sets attach to. Shared by `push` and `list`. Throws with the fix when the app has no
 * ASC record or no version that's still editable.
 */
async function resolveVersionLocalizations(asc: AppStoreConnectClient, bundleId: string): Promise<Map<string, string>> {
  const appId = await asc.getAppId(bundleId);
  if (!appId)
    throw new Error(`No App Store Connect record for ${bundleId}. Create the app in App Store Connect first.`);
  const versionId = await asc.getEditableVersionId(appId);
  if (!versionId) {
    throw new Error(
      `No editable App Store version for ${bundleId}. Screenshots attach to a version that's still editable (e.g. PREPARE_FOR_SUBMISSION).`,
    );
  }
  const localizations = await asc.listVersionLocalizations(versionId);
  return new Map(localizations.map((loc) => [loc.locale.toLowerCase(), loc.id]));
}

/** Run the `push` flow: scan config, plan, confirm, upload. */
async function runPush(options: PushOptions): Promise<void> {
  const log = createLogger(false);
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  if (!app.bundleId) throw new Error(`App "${app.name}" has no iOS bundle id — screenshots are App Store only.`);

  const root = options.path ?? join(app.dir, "screenshots");
  if (!existsSync(root)) {
    throw new Error(`No screenshots folder at ${root}. Expected ${root}/<locale>/<displayType>/NN.png.`);
  }
  const targets = collectTargets(root, log);
  if (targets.length === 0) throw new Error(`No screenshots found under ${root}.`);

  const asc = await client();
  const localeToId = await resolveVersionLocalizations(asc, app.bundleId);
  const { actions, steps } = await buildPlan(asc, localeToId, targets, log);

  for (const action of actions) console.log(`  ${planSymbol(action)} ${action.description}`);

  if (options.dryRun) {
    log.step("screenshots", `Plan: ${steps.length} to upload, ${actions.length - steps.length} unchanged (dry run).`);
    return;
  }
  if (steps.length === 0) {
    log.step("screenshots", "Everything already up to date.");
    return;
  }

  const canPrompt = options.yes !== true && process.stdin.isTTY;
  if (canPrompt) {
    const ok = await confirm({ message: `Upload ${steps.length} screenshot change(s) to ${app.name}?` });
    if (isCancel(ok) || !ok) {
      cancel("Aborted — no screenshots uploaded.");
      return;
    }
  } else if (options.yes !== true) {
    throw new Error(`Refusing to upload ${steps.length} screenshot(s) without confirmation. Re-run with --yes.`);
  }

  await applyPlan(asc, steps, log);

  const applied = steps.filter((step) => step.action.status === "applied").length;
  const failed = steps.filter((step) => step.action.status === "failed");
  log.step("screenshots", `${applied} uploaded, ${actions.length - steps.length} unchanged, ${failed.length} failed.`);
  for (const step of failed) log.error(`${step.action.description}: ${step.action.error ?? "unknown error"}`);
  if (failed.length > 0) process.exitCode = 1;
}

/** Run the `list` flow: print the current remote screenshot inventory per locale + device family. */
async function runList(options: ListOptions): Promise<void> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  if (!app.bundleId) throw new Error(`App "${app.name}" has no iOS bundle id — screenshots are App Store only.`);
  const asc = await client();
  const localeToId = await resolveVersionLocalizations(asc, app.bundleId);
  let total = 0;
  for (const [locale, localizationId] of localeToId) {
    const sets = await asc.listScreenshotSets(localizationId);
    if (sets.length === 0) continue;
    console.log(`\n${locale}`);
    for (const set of sets) {
      const shots = await asc.listScreenshots(set.id);
      total += shots.length;
      console.log(`  ${set.displayType} — ${shots.length} screenshot(s)`);
      for (const shot of shots) {
        console.log(`    • ${shot.fileName}${shot.assetDeliveryState ? ` [${shot.assetDeliveryState}]` : ""}`);
      }
    }
  }
  if (total === 0) console.log("No screenshots uploaded yet. Add some with `launch screenshots push`.");
}

/** Plan-line glyph mirroring the reconciler's vocabulary: ↑ upload, ~ replace, = unchanged. */
function planSymbol(action: PlannedAction): string {
  if (action.status === "skipped") return "=";
  return action.destructive ? "~" : "↑";
}

/** Attach the `screenshots` command (with `push` / `list` subcommands) to the program. */
export function registerScreenshotsCommand(program: Command): void {
  const screenshots = program
    .command("screenshots")
    .description("sync App Store screenshots from a folder via the App Store Connect API");

  screenshots
    .command("push")
    .description("upload screenshots for every locale + device family, skipping unchanged files")
    .option("--app <name>", "which app (skips the picker in a monorepo)")
    .option("--path <dir>", "screenshots root (default <app.dir>/screenshots)")
    .option("--dry-run", "print the per-target plan and exit without uploading")
    .option("-y, --yes", "skip the confirmation prompt (required in CI)")
    .action(runPush);

  screenshots
    .command("list")
    .description("list the screenshots currently uploaded to the editable version")
    .option("--app <name>", "which app (skips the picker in a monorepo)")
    .action(runList);
}
