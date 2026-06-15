/**
 * `launch metadata pull|push` — sync the store listing (titles, descriptions, keywords, release notes,
 * URLs) between a versioned `store.config.json` and the stores.
 *
 * iOS uses Expo's `store.config.json` schema verbatim (an EAS user migrates by copying the file);
 * Android reads an `android` extension of the same file (EAS has no Android metadata at all). The
 * upload itself runs through fastlane `deliver` (iOS) / `supply` (Android), which Launch already
 * depends on — so this command is thin glue over the pure translation layer in `core/storeConfig.ts`.
 *
 * `--dry-run` rehearses: it writes the translated fastlane metadata folders to a temp dir for
 * inspection and prints the exact command it WOULD run, touching no network and no store.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import type { Platform } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger } from "../../core/logger.js";
import { run } from "../../core/exec.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { writeAscApiKeyFile } from "../../apple/apiKeyFile.js";
import {
  loadStoreConfig,
  readAndroidMetadataDir,
  readAppleMetadataDir,
  serializeStoreConfig,
  writeAndroidMetadataDir,
  writeAppleMetadataDir,
  type StoreConfig,
} from "../../core/storeConfig.js";

/** Shared options for both `pull` and `push`. */
interface MetadataOptions {
  platform?: string;
  app?: string;
  /** Path to `store.config.json`; defaults to the file in the app directory. */
  config?: string;
  dryRun?: boolean;
}

/** Validate `--platform`, defaulting to iOS (matching `doctor`/`build`). */
function parsePlatform(platform: string | undefined): Platform {
  const value = platform ?? "ios";
  if (value !== "ios" && value !== "android") throw new Error(`Unknown platform "${value}". Use "ios" or "android".`);
  return value;
}

/** Resolve the app and the store.config.json path for a metadata run. */
async function resolveTarget(
  options: MetadataOptions,
): Promise<{ appDir: string; bundleId?: string; packageName?: string; configPath: string }> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const configPath = options.config ?? join(app.dir, "store.config.json");
  return {
    appDir: app.dir,
    ...(app.bundleId ? { bundleId: app.bundleId } : {}),
    ...(app.packageName ? { packageName: app.packageName } : {}),
    configPath,
  };
}

/**
 * Pull the live App Store listing into `store.config.json` via `deliver download_metadata`. Exported so
 * `launch adopt` reuses the exact same download (no duplicated fastlane logic) when it imports listing copy.
 */
export async function pullAppleListing(bundleId: string, configPath: string, dryRun: boolean): Promise<void> {
  const log = createLogger(false);
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");

  const workDir = mkdtempSync(join(tmpdir(), "launch-meta-"));
  const apiKeyPath = writeAscApiKeyFile(ascKey);
  try {
    if (dryRun) {
      log.step("metadata", `would run \`fastlane deliver download_metadata\` for ${bundleId} → ${workDir}`);
      return;
    }
    await run("fastlane", [
      "deliver",
      "download_metadata",
      "--api_key_path",
      apiKeyPath,
      "--app_identifier",
      bundleId,
      "--metadata_path",
      workDir,
    ]);
    const apple = readAppleMetadataDir(workDir);
    const merged: StoreConfig = { ...readExisting(configPath), apple };
    writeFileSync(configPath, serializeStoreConfig(merged));
    log.step("metadata", `wrote App Store listing → ${configPath}`);
  } finally {
    rmSync(apiKeyPath, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Pull the live Play listing into `store.config.json` via `supply init`. */
async function pullAndroid(packageName: string, configPath: string, dryRun: boolean): Promise<void> {
  const log = createLogger(false);
  const json = await loadServiceAccount();
  if (!json) throw new Error("No Play service account. Run `launch creds set-key --platform android` first.");

  const workDir = mkdtempSync(join(tmpdir(), "launch-meta-"));
  const keyPath = join(workDir, "play-service-account.json");
  writeFileSync(keyPath, json);
  try {
    if (dryRun) {
      log.step("metadata", `would run \`fastlane supply init\` for ${packageName} → ${workDir}`);
      return;
    }
    await run("fastlane", [
      "supply",
      "init",
      "--json_key",
      keyPath,
      "--package_name",
      packageName,
      "--metadata_path",
      workDir,
    ]);
    const android = readAndroidMetadataDir(workDir);
    const merged: StoreConfig = { ...readExisting(configPath), android };
    writeFileSync(configPath, serializeStoreConfig(merged));
    log.step("metadata", `wrote Play listing → ${configPath}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Read an existing store.config.json (for merge-on-pull), or {} when there's none yet. */
function readExisting(configPath: string): StoreConfig {
  return existsSync(configPath) ? loadStoreConfig(configPath) : {};
}

/** Push the App Store listing from `store.config.json` via `deliver` (metadata only, no binary). */
async function pushApple(bundleId: string, configPath: string, dryRun: boolean): Promise<void> {
  const log = createLogger(false);
  const config = loadStoreConfig(configPath);
  if (!config.apple) throw new Error(`${configPath} has no "apple" section to push.`);

  const workDir = mkdtempSync(join(tmpdir(), "launch-meta-"));
  const written = writeAppleMetadataDir(config.apple, workDir);
  if (dryRun) {
    log.step("metadata", `would push ${written.length} App Store field(s) for ${bundleId} via \`fastlane deliver\``);
    log.info(`rehearsed into ${workDir} (no upload)`);
    return;
  }
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  const apiKeyPath = writeAscApiKeyFile(ascKey);
  try {
    await run("fastlane", [
      "deliver",
      "--api_key_path",
      apiKeyPath,
      "--app_identifier",
      bundleId,
      "--metadata_path",
      workDir,
      "--skip_binary_upload",
      "true",
      "--skip_screenshots",
      "true",
      "--force",
      "true",
    ]);
    log.step("metadata", `pushed App Store listing for ${bundleId}`);
  } finally {
    rmSync(apiKeyPath, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Push the Play listing from `store.config.json` via `supply` (metadata only, no binary/screenshots). */
async function pushAndroid(packageName: string, configPath: string, dryRun: boolean): Promise<void> {
  const log = createLogger(false);
  const config = loadStoreConfig(configPath);
  if (!config.android) throw new Error(`${configPath} has no "android" section to push.`);

  const workDir = mkdtempSync(join(tmpdir(), "launch-meta-"));
  const written = writeAndroidMetadataDir(config.android, workDir);
  if (dryRun) {
    log.step("metadata", `would push ${written.length} Play field(s) for ${packageName} via \`fastlane supply\``);
    log.info(`rehearsed into ${workDir} (no upload)`);
    return;
  }
  const json = await loadServiceAccount();
  if (!json) throw new Error("No Play service account. Run `launch creds set-key --platform android` first.");
  const keyPath = join(workDir, "play-service-account.json");
  writeFileSync(keyPath, json);
  try {
    await run("fastlane", [
      "supply",
      "--json_key",
      keyPath,
      "--package_name",
      packageName,
      "--metadata_path",
      workDir,
      "--skip_upload_apk",
      "true",
      "--skip_upload_aab",
      "true",
      "--skip_upload_changelogs",
      "true",
      "--skip_upload_images",
      "true",
      "--skip_upload_screenshots",
      "true",
    ]);
    log.step("metadata", `pushed Play listing for ${packageName}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Attach the `metadata` command (with `pull` / `push` subcommands) to the program. */
export function registerMetadataCommand(program: Command): void {
  const metadata = program
    .command("metadata")
    .description("sync the store listing (name, description, keywords, screenshots) via store.config.json");

  metadata
    .command("pull")
    .description("download the live store listing into store.config.json")
    .option("--platform <p>", "ios (default) or android")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--config <path>", "path to store.config.json (default: <app>/store.config.json)")
    .option("--dry-run", "rehearse without contacting the store", false)
    .action(async (options: MetadataOptions) => {
      const platform = parsePlatform(options.platform);
      const target = await resolveTarget(options);
      if (platform === "ios") {
        if (!target.bundleId) throw new Error("No iOS bundle identifier for this app (set ios.bundleIdentifier).");
        await pullAppleListing(target.bundleId, target.configPath, options.dryRun === true);
      } else {
        if (!target.packageName) throw new Error("No Android application id for this app (set android.package).");
        await pullAndroid(target.packageName, target.configPath, options.dryRun === true);
      }
    });

  metadata
    .command("push")
    .description("upload store.config.json to the store listing (metadata only; no binary)")
    .option("--platform <p>", "ios (default) or android")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--config <path>", "path to store.config.json (default: <app>/store.config.json)")
    .option("--dry-run", "rehearse: write the fastlane metadata folders and print the command, upload nothing", false)
    .action(async (options: MetadataOptions) => {
      const platform = parsePlatform(options.platform);
      const target = await resolveTarget(options);
      if (platform === "ios") {
        if (!target.bundleId) throw new Error("No iOS bundle identifier for this app (set ios.bundleIdentifier).");
        await pushApple(target.bundleId, target.configPath, options.dryRun === true);
      } else {
        if (!target.packageName) throw new Error("No Android application id for this app (set android.package).");
        await pushAndroid(target.packageName, target.configPath, options.dryRun === true);
      }
    });
}
