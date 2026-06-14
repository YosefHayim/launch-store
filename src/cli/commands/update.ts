/**
 * `launch update` — publish an over-the-air JS/asset update using the Expo Updates protocol.
 *
 * The EAS Update replacement: it `expo export`s the bundle, builds a protocol-v0 manifest per platform,
 * code-signs it (default), and uploads the manifest + assets to the user's own bucket under a
 * channel/platform/runtime-version layout. Because the `expo-updates` client already embedded in the
 * app polls a header-driven endpoint, Launch also emits a tiny edge worker (run in the user's own
 * Cloudflare account) that maps those headers to the static files — Launch hosts nothing.
 *
 * `--dry-run` rehearses: it prints the manifest layout, the worker, and the one-time app config without
 * exporting, signing, or uploading. `--no-sign` publishes unsigned (lower security floor; see `--help`).
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { AppDescriptor, LaunchConfig } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { resolveCommandEnv, selectApp, validateResolvedEnv } from "../../core/pipeline.js";
import { formatEnvTable } from "../../core/env.js";
import { addEnvFlags, envOverrides, type EnvFlags } from "../options.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { runWithProgress } from "../../core/progress.js";
import { isCloudStorage, resolveStorageProvider } from "../../core/storage.js";
import { ensureCodeSigner } from "../../core/codeSign.js";
import {
  assembleManifest,
  contentTypeFor,
  historySnapshotKey,
  manifestKey,
  manifestSignatureKey,
  updatesAppConfigSnippet,
  updatesWorkerScript,
  type ManifestAsset,
} from "../../core/otaManifest.js";
import { clearRollbackDirective, recordPublish } from "../../core/updateHistory.js";

/** The subset of `expo export`'s `metadata.json` Launch reads: per-platform bundle + asset paths. */
interface ExportMetadata {
  fileMetadata: Record<string, { bundle: string; assets: { path: string; ext: string }[] }>;
}

interface UpdateOptions extends EnvFlags {
  channel: string;
  platform: string;
  app?: string;
  /** Build profile whose env (`profile.env`, `.env.<profile>`) is baked into the exported bundle. */
  profile: string;
  runtimeVersion?: string;
  /** commander sets this false when `--no-sign` is passed. */
  sign: boolean;
  dryRun: boolean;
}

/** The platforms a single `launch update` run publishes. */
function platformsFor(platform: string): ("ios" | "android")[] {
  if (platform === "ios") return ["ios"];
  if (platform === "android") return ["android"];
  if (platform === "all") return ["ios", "android"];
  throw new Error(`Unknown --platform "${platform}". Use ios, android, or all.`);
}

/**
 * Resolve the runtime version: an explicit `--runtime-version`, then a string `expo.runtimeVersion`
 * in the app config, then the app's marketing version. A fingerprint-policy runtime version (an object,
 * not a string) can't be resolved statically — those must pass `--runtime-version`.
 */
export function resolveRuntimeVersion(app: AppDescriptor, override: string | undefined): string {
  if (override) return override;
  try {
    const raw = JSON.parse(readFileSync(app.configPath, "utf8")) as {
      expo?: { runtimeVersion?: unknown };
      runtimeVersion?: unknown;
    };
    const rtv = raw.expo?.runtimeVersion ?? raw.runtimeVersion;
    if (typeof rtv === "string") return rtv;
  } catch {
    /* fall through to the app version */
  }
  if (app.version) return app.version;
  throw new Error("Could not resolve a runtime version. Pass --runtime-version <v> (e.g. 1.0.0).");
}

/** Read and parse `metadata.json` from an `expo export` output directory. */
function readExportMetadata(distDir: string): ExportMetadata {
  const path = join(distDir, "metadata.json");
  if (!existsSync(path)) throw new Error(`No metadata.json in ${distDir} — did \`expo export\` run?`);
  return JSON.parse(readFileSync(path, "utf8")) as ExportMetadata;
}

/**
 * Publish one platform's manifest: upload the bundle + assets, assemble + sign the manifest, and upload
 * it with its signature. Returns the public worker-relative path the manifest now lives at.
 */
async function publishPlatform(
  config: LaunchConfig,
  distDir: string,
  metadata: ExportMetadata,
  platform: "ios" | "android",
  channel: string,
  runtimeVersion: string,
  sign: boolean,
  log: Logger,
): Promise<void> {
  const platformMeta = metadata.fileMetadata[platform];
  if (!platformMeta) {
    log.warn(`No ${platform} bundle in the export — skipping.`);
    return;
  }
  const storage = resolveStorageProvider(config);
  const prefix = `updates/${channel}/${platform}/${runtimeVersion}`;

  /** Upload one exported file and return its manifest asset entry. */
  const upload = async (relativePath: string, ext?: string): Promise<ManifestAsset> => {
    const key = `${prefix}/${relativePath}`;
    await storage.putObject(key, readFileSync(join(distDir, relativePath)), contentTypeFor(relativePath));
    const base: ManifestAsset = {
      key: relativePath,
      contentType: contentTypeFor(relativePath),
      url: storage.publicUrl(key),
    };
    return ext ? { ...base, fileExtension: `.${ext}` } : base;
  };

  const launchAsset = await upload(platformMeta.bundle);
  const assets = await Promise.all(platformMeta.assets.map((asset) => upload(asset.path, asset.ext)));

  const manifest = assembleManifest({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion,
    launchAsset,
    assets,
  });
  const body = JSON.stringify(manifest);
  await storage.putObject(manifestKey(channel, platform, runtimeVersion), body, "application/json");
  // Immutable snapshot so `launch updates view`/`rollback` can read this exact manifest back later.
  await storage.putObject(historySnapshotKey(channel, platform, runtimeVersion, manifest.id), body, "application/json");

  if (sign) {
    const signer = await ensureCodeSigner(false, log);
    await storage.putObject(manifestSignatureKey(channel, platform, runtimeVersion), signer.sign(body), "text/plain");
  }

  await recordPublish(storage, channel, platform, {
    id: manifest.id,
    runtimeVersion,
    createdAt: manifest.createdAt,
    active: true,
    signed: sign,
    kind: "publish",
  });
  // A fresh publish supersedes any prior `--to-embedded` rollback for this runtime version.
  await clearRollbackDirective(storage, channel, platform, runtimeVersion);
  log.step("update", `${platform} · ${assets.length} asset(s) → ${prefix}/`, "ota-update");
}

/** Attach the `update` command to the program. */
export function registerUpdateCommand(program: Command): void {
  const command = program
    .command("update")
    .description("publish an over-the-air JS update (Expo Updates protocol) to your own bucket")
    .option("--channel <name>", "release channel testers/builds map to", "production")
    .option("--platform <p>", "ios, android, or all", "all")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("-p, --profile <name>", "build profile whose env is baked into the bundle", "production")
    .option("--runtime-version <v>", "runtime version this update targets (default: from app config)")
    .option("--no-sign", "publish unsigned (lower security floor — anyone who can write the bucket can push JS)")
    .option("--dry-run", "rehearse: print the layout, worker, and app config without exporting or uploading", false);
  addEnvFlags(command).action(async (options: UpdateOptions) => {
    const log = createLogger(false);
    const platforms = platformsFor(options.platform);
    const { config, apps } = await loadConfig();
    const app = await selectApp(apps, options.app);
    const profile = config.profiles[options.profile] ?? { name: options.profile };
    const runtimeVersion = resolveRuntimeVersion(app, options.runtimeVersion);

    // Same env Launch would bake into a build, exported into this OTA bundle (issue #25).
    const resolvedEnv = await resolveCommandEnv({
      app,
      profile,
      cliEnv: envOverrides(options),
      includeLocal: options.includeLocal,
    });
    if (options.printEnv) {
      console.log(formatEnvTable(resolvedEnv));
      return;
    }
    validateResolvedEnv(app.dir, resolvedEnv, log);

    if (!isCloudStorage(config)) {
      throw new Error(
        'OTA updates need a cloud storage provider. Set `storage: "s3"` (or `supabase`) + a `storageConfig` block in launch.config.ts.',
      );
    }
    log.step("config", `${app.name} · channel ${options.channel} · rtv ${runtimeVersion} · ${platforms.join("+")}`);

    const storage = resolveStorageProvider(config);
    const workerPath = "updates/_worker.js";

    if (options.dryRun) {
      for (const platform of platforms) {
        log.step(
          "update",
          `would export + upload ${platform} manifest → updates/${options.channel}/${platform}/${runtimeVersion}/`,
          "ota-update",
        );
      }
      log.info(`signing: ${options.sign ? "on (manifests code-signed)" : "off (--no-sign)"}`);
      printAfterPublish(storage.publicUrl(workerPath), runtimeVersion, options.sign, log);
      return;
    }

    const distDir = join(app.dir, "dist");
    await runWithProgress("npx", ["expo", "export", "--output-dir", distDir], {
      label: `Exporting JS bundle · ${app.name}`,
      cwd: app.dir,
      env: resolvedEnv.values,
    });
    const metadata = readExportMetadata(distDir);
    for (const platform of platforms) {
      await publishPlatform(config, distDir, metadata, platform, options.channel, runtimeVersion, options.sign, log);
    }

    // Upload the edge worker so the static manifests are servable over the protocol.
    await storage.putObject(workerPath, updatesWorkerScript(storage.publicUrl("")), "application/javascript");
    printAfterPublish(storage.publicUrl(workerPath), runtimeVersion, options.sign, log);
  });
}

/** Print the post-publish next steps: deploy the worker, then wire the app's `updates` config once. */
function printAfterPublish(workerUrl: string, runtimeVersion: string, signed: boolean, log: Logger): void {
  log.gap();
  log.info(`Edge worker uploaded — deploy it (Cloudflare) and point the app's updates.url at the Worker route.`);
  log.info(`Worker source: ${workerUrl}`);
  log.gap();
  log.info("One-time app config (app.json):");
  console.log(updatesAppConfigSnippet({ updateUrl: "<your-worker-route>", runtimeVersion, signed }));
}
