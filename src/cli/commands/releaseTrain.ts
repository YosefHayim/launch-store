/**
 * `launch release-train <start|status|release|abort>` — one command that drives an app's whole release
 * across iOS + Android + OTA as a single, resumable, CI-gradable record (ADR 0004).
 *
 * Thin by design: it resolves credentials and config, builds the live {@link TrainEngine} (wrapping the
 * existing release primitives — `appStoreRelease`, the Play submitter, the OTA publish core), and hands
 * every decision to `core/releaseTrain/orchestrator.ts`. The train coordinates **submit → review →
 * release → OTA**; the binaries themselves are built first with `launch build` (the train promotes the
 * latest processed build, it does not compile). `start` kicks each car's submit and writes the record;
 * `status` reconciles it forward (the workhorse — run it on a CI cron or with `--watch`); `release`
 * resolves a held/blocked train; `abort` stops it without ever un-releasing a live car (D5).
 *
 * `--hold` (D1) gives a synchronized launch: iOS is submitted for manual release and held until every
 * native car is approved, then released together. Apple honors the held gate; Android promotes to the
 * production track on submit (Google exposes no developer-release gate) — steer its staged rollout with
 * `launch rollout`. The exit codes mirror `launch status` (0 ok · 2 blocked/rejected · 3 in progress · 1 error).
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Command } from "commander";
import type {
  AndroidReleaseOptions,
  AppDescriptor,
  BuildProfile,
  LaunchConfig,
  Platform,
  ReleaseType,
  ResolvedBuildContext,
} from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { resolveCommandEnv, resolveSubmitterName, selectApp } from "../../core/pipeline.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { addEnvFlags, envOverrides, type EnvFlags } from "../options.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import {
  appRecordMissingMessage,
  IOS_PLATFORM,
  pickCurrentVersion,
  readReleaseStatus,
  releaseApp,
  type ReleaseInput,
} from "../../core/appStoreRelease.js";
import { GooglePlayClient, parseServiceAccount } from "../../google/playClient.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { getCredentialsProvider, getStorageProvider, getSubmitter } from "../../core/registry.js";
import { isCloudStorage, resolveStorageProvider } from "../../core/storage.js";
import { ensureCodeSigner, type CodeSigner } from "../../core/codeSign.js";
import { runWithProgress } from "../../core/progress.js";
import { publishOtaPlatform, readExportMetadata } from "../../core/otaPublish.js";
import { resolveWhatsNew } from "./release.js";
import { resolveRuntimeVersion } from "./update.js";
import { resolveTrainCars, androidCarState, iosCarState } from "../../core/releaseTrain/engine.js";
import {
  advanceTrain,
  isTrainSettled,
  startTrain,
  trainExitCode,
  type TrainEngine,
} from "../../core/releaseTrain/orchestrator.js";
import {
  latestTrainRecord,
  listTrainRecords,
  readTrainRecord,
  writeTrainRecord,
} from "../../core/releaseTrain/record.js";
import { isNativeCar, isOtaCar, type Car, type TrainRecord } from "../../core/releaseTrain/types.js";

/** CLI options for `launch release-train`. */
interface ReleaseTrainOptions extends EnvFlags {
  app?: string;
  /** Build profile whose env feeds the Android submit + OTA export. */
  profile: string;
  /** `start`: restrict the train to one native platform. */
  platform?: string;
  /** `start`: coordinate the native legs only (no OTA followers). */
  ota: boolean;
  /** `start`: hold every car until all native cars are approved, then release together (D1). */
  hold?: boolean;
  /** `start`: the OTA channel followers publish to. */
  channel: string;
  /** `start`: the runtime version OTA followers target (default: from app config). */
  runtimeVersion?: string;
  /** `status`: poll until the train settles. */
  watch?: boolean;
  /** Machine-readable output (the {@link TrainRecord}) for CI/agents. */
  json?: boolean;
}

/** How long to wait between `--watch` reconciles — store states change on the order of minutes. */
const WATCH_INTERVAL_MS = 30_000;

/** Mint a stable train id: the app handle slugged, plus a short random suffix to disambiguate reruns. */
export function mintTrainId(appName: string): string {
  const slug =
    appName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "train";
  return `${slug}-${randomUUID().slice(0, 4)}`;
}

/** A short human label for a car (the native platform, or the OTA follower's channel/runtime). */
export function carLabel(car: Car): string {
  return isOtaCar(car) ? `OTA ${car.platform} (${car.channel}/${car.runtimeVersion})` : car.kind;
}

/** One status line for a car: its label, state, and the most useful identifier or error. */
export function carStatusLine(car: Car): string {
  if (isOtaCar(car)) {
    return `${carLabel(car)}: ${car.state}${car.manifestId ? ` · ${car.manifestId}` : ""}`;
  }
  const detail = car.error ? ` — ${car.error}` : car.buildId ? ` · build ${car.buildId}` : "";
  return `${carLabel(car)}: ${car.state}${detail}`;
}

/** Render the train as a boxed summary: its id/app/lifecycle header, then one line per car. */
function renderTrain(record: TrainRecord, log: Logger): void {
  const header = `Train ${record.id} · ${record.app} · ${record.state}${record.hold ? " · hold" : ""}`;
  log.box(header, record.cars.map(carStatusLine));
}

/** Resolve the train this verb acts on: an explicit id, else the latest live/recent train. */
function resolveTarget(id: string | undefined): TrainRecord {
  const record = id ? readTrainRecord(id) : latestTrainRecord();
  if (!record) {
    const known = listTrainRecords().map((train) => train.id);
    throw new Error(
      id
        ? `No release train "${id}". Known: ${known.join(", ") || "none"}.`
        : "No release train yet. Start one with `launch release-train start`.",
    );
  }
  return record;
}

/** Memoized, lazy resolvers + the live {@link TrainEngine} for one run — clients are resolved only as a car needs them. */
interface TrainRuntime {
  engine: TrainEngine;
}

/**
 * Build the live engine for an app: each method wraps an already-tested release primitive, and the store
 * clients / code signer resolve lazily (a `status` reconcile that only reads never touches the signer).
 * The iOS bundle id and Android package are present because cars are only created for declared platforms;
 * the per-method guards keep that explicit without a non-null assertion.
 */
function buildTrainRuntime(
  config: LaunchConfig,
  app: AppDescriptor,
  profile: BuildProfile,
  env: Record<string, string>,
  hold: boolean,
  log: Logger,
): TrainRuntime {
  let ascClient: AppStoreConnectClient | undefined;
  let playClient: GooglePlayClient | undefined;
  let signer: CodeSigner | undefined;

  const asc = async (): Promise<AppStoreConnectClient> => {
    if (!ascClient) {
      const key = await loadActiveAscKey();
      if (!key) throw new Error("No active Apple account. Run `launch creds set-key` first.");
      ascClient = new AppStoreConnectClient(key);
    }
    return ascClient;
  };
  const play = async (): Promise<GooglePlayClient> => {
    if (!playClient) {
      const json = await loadServiceAccount();
      if (!json)
        throw new Error("No Google Play service account configured. Run `launch creds set-key --platform android`.");
      playClient = new GooglePlayClient(parseServiceAccount(json));
    }
    return playClient;
  };
  const codeSigner = async (): Promise<CodeSigner> => (signer ??= await ensureCodeSigner(false, log));

  const bundleId = app.bundleId;
  const packageName = app.packageName;

  /** Submit the latest processed iOS build to App Store review (manual release when the train holds). */
  const submitIos = async (): Promise<{ buildId?: string }> => {
    if (!bundleId) throw new Error(`${app.name} has no iOS bundle id (ios.bundleIdentifier in app.json).`);
    const client = await asc();
    const appId = await client.getAppId(bundleId);
    if (!appId) throw new Error(appRecordMissingMessage(bundleId, "launch release-train start"));
    const build = (await client.listBuilds(appId)).find((b) => b.processingState === "VALID" && !b.expired) ?? null;
    if (!build) {
      throw new Error(
        `No processed iOS build on App Store Connect for ${app.name}. Run \`launch build ios\` and upload it ` +
          `(\`launch testflight\` or \`launch release ios --no-wait\`) before starting the train.`,
      );
    }
    const versionString = app.version ?? (await client.getLatestMarketingVersion(bundleId));
    if (!versionString)
      throw new Error(`Could not determine a marketing version for ${app.name}. Set "version" in app.json.`);
    const releaseType: ReleaseType = hold ? "MANUAL" : (config.release?.releaseType ?? "AFTER_APPROVAL");
    const input: ReleaseInput = {
      bundleId,
      platform: IOS_PLATFORM,
      versionString,
      releaseType,
      phasedRelease: config.release?.phasedRelease === true,
      usesNonExemptEncryption: config.release?.usesNonExemptEncryption ?? false,
      whatsNew: resolveWhatsNew(config.release, app.dir),
      build,
      dryRun: false,
    };
    await releaseApp(client, input);
    return { buildId: build.id };
  };

  /** Promote the latest stored Android artifact to the Play production track. */
  const submitAndroid = async (): Promise<{ buildId?: string }> => {
    if (!packageName) throw new Error(`${app.name} has no Android package (android.package in app.json).`);
    const latest = (await getStorageProvider(config.storage).list()).find(
      (artifact) => artifact.appName === app.name && artifact.platform === "android",
    );
    if (!latest) throw new Error(`No stored Android build for ${app.name}. Run \`launch build android\` first.`);
    const android: AndroidReleaseOptions = { track: "production", rollout: profile.rollout ?? 1.0 };
    const ctx: ResolvedBuildContext = {
      platform: "android",
      app,
      profile,
      env,
      explain: false,
      dryRun: false,
      forceClean: false,
      android,
    };
    const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
    await getSubmitter(resolveSubmitterName(config, "android")).submit(latest.path, "production", credentials, ctx);
    return { buildId: String(latest.buildNumber) };
  };

  /** Export the current JS and publish one OTA follower's manifest (its native platform is live). */
  const publishOta = async (car: Extract<Car, { kind: "ota" }>): Promise<{ manifestId?: string }> => {
    if (!isCloudStorage(config)) throw new Error("OTA needs a cloud storage provider (s3 / supabase).");
    const storage = resolveStorageProvider(config);
    const distDir = join(app.dir, "dist");
    await runWithProgress("npx", ["expo", "export", "--output-dir", distDir], {
      label: `Exporting JS bundle · ${app.name}`,
      cwd: app.dir,
      env,
    });
    const metadata = readExportMetadata(distDir);
    const result = await publishOtaPlatform(
      {
        storage,
        distDir,
        metadata,
        platform: car.platform,
        channel: car.channel,
        runtimeVersion: car.runtimeVersion,
        signer: await codeSigner(),
      },
      log,
    );
    return result.manifestId !== undefined ? { manifestId: result.manifestId } : {};
  };

  const engine: TrainEngine = {
    submitNative: (car) => (car.kind === "ios" ? submitIos() : submitAndroid()),
    async readNative(car) {
      if (car.kind === "ios") {
        if (!bundleId) return car.state;
        const status = await readReleaseStatus(await asc(), bundleId, IOS_PLATFORM);
        return iosCarState(status.verdict) ?? car.state;
      }
      if (!packageName) return car.state;
      const releases = await (await play()).getTrackReleases(packageName, "production");
      return androidCarState(releases) ?? car.state;
    },
    async releaseNative(car) {
      // Android promotes to production on submit and exposes no developer-release gate — nothing to fire.
      if (car.kind !== "ios" || !bundleId) return;
      const client = await asc();
      const appId = await client.getAppId(bundleId);
      if (!appId) throw new Error(appRecordMissingMessage(bundleId, "launch release-train release"));
      const version = pickCurrentVersion(await client.listAppStoreVersions(appId, IOS_PLATFORM));
      if (version) await client.createAppStoreVersionReleaseRequest(version.id);
    },
    publishOta,
  };
  return { engine };
}

/** Load config + app + env and build the runtime — the shared head of every verb that touches the store. */
async function prepare(
  options: ReleaseTrainOptions,
): Promise<{ config: LaunchConfig; app: AppDescriptor; profile: BuildProfile; runtime: TrainRuntime; log: Logger }> {
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const profile = config.profiles[options.profile] ?? { name: options.profile };
  const resolvedEnv = await resolveCommandEnv({
    app,
    profile,
    cliEnv: envOverrides(options),
    includeLocal: options.includeLocal,
    envExclude: config.envExclude,
  });
  const runtime = buildTrainRuntime(config, app, profile, resolvedEnv.values, options.hold === true, log);
  return { config, app, profile, runtime, log };
}

/** `start`: resolve the cars from config, kick each native submit, and write the new record. */
async function runStart(options: ReleaseTrainOptions): Promise<void> {
  if (options.platform && options.platform !== "ios" && options.platform !== "android") {
    throw new Error(`Unknown --platform "${options.platform}". Use "ios" or "android".`);
  }
  const { config, app, runtime, log } = await prepare(options);
  const runtimeVersion = resolveRuntimeVersion(app, options.runtimeVersion);
  const cars = resolveTrainCars({
    hasBundleId: app.bundleId !== undefined,
    hasPackageName: app.packageName !== undefined,
    hasCloudStorage: isCloudStorage(config),
    runtimeVersion,
    channel: options.channel,
    ...(options.platform ? { platformFilter: options.platform as Platform } : {}),
    noOta: !options.ota,
  });
  if (cars.platforms.length === 0) {
    throw new Error(`${app.name} declares no iOS bundle id or Android package — nothing to release.`);
  }

  log.step("release-train", `starting ${app.name}: ${cars.platforms.join(" + ")}${cars.ota.length ? " + OTA" : ""}`);
  const record = await startTrain(
    {
      id: mintTrainId(app.name),
      app: app.name,
      hold: options.hold === true,
      platforms: cars.platforms,
      ota: cars.ota,
      now: new Date().toISOString(),
    },
    runtime.engine,
  );
  writeTrainRecord(record);
  report(record, options, log);
  log.info(`Track it with \`launch release-train status ${record.id} --watch\`.`);
}

/** Reconcile a train once (optionally forcing the held gate), persist it, and report. */
async function reconcileOnce(
  record: TrainRecord,
  runtime: TrainRuntime,
  force: boolean,
  log: Logger,
): Promise<TrainRecord> {
  const advanced = await advanceTrain(record, runtime.engine, {
    now: new Date().toISOString(),
    force,
    onWarn: (message) => {
      log.warn(message);
    },
  });
  writeTrainRecord(advanced);
  return advanced;
}

/** `status`: reconcile the train forward (looping under `--watch`) and report. */
async function runStatus(id: string | undefined, options: ReleaseTrainOptions): Promise<void> {
  const target = resolveTarget(id);
  const { runtime, log } = await prepare({ ...options, app: target.app });

  let record = await reconcileOnce(target, runtime, false, log);
  if (options.watch && !options.json) {
    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    while (!isTrainSettled(record)) {
      await sleep(WATCH_INTERVAL_MS);
      record = await reconcileOnce(record, runtime, false, log);
      log.gap();
      renderTrain(record, log);
    }
  }
  report(record, options, log);
}

/** `release`: override the hold gate on a held/blocked train and release the ready cars now (D6). */
async function runRelease(id: string | undefined, options: ReleaseTrainOptions): Promise<void> {
  const target = resolveTarget(id);
  const { runtime, log } = await prepare({ ...options, app: target.app });
  const record = await reconcileOnce(target, runtime, true, log);
  report(record, options, log);
}

/** `abort`: stop the train. Never un-releases a live car — just marks the record terminated (D6). */
function runAbort(id: string | undefined, options: ReleaseTrainOptions, log: Logger): void {
  const target = resolveTarget(id);
  const record: TrainRecord = { ...target, state: "aborted", updatedAt: new Date().toISOString() };
  writeTrainRecord(record);
  log.info(
    `Aborted ${record.id}. Live cars are untouched — roll back explicitly with \`launch rollout pause\` / \`launch updates rollback\`.`,
  );
  report(record, options, log);
}

/** Emit the train as JSON (CI/agents) or the boxed human view, and set the process exit code. */
function report(record: TrainRecord, options: ReleaseTrainOptions, log: Logger): void {
  if (options.json) console.log(JSON.stringify(record, null, 2));
  else renderTrain(record, log);
  process.exitCode = trainExitCode(record);
}

/** Whether a car is still in flight — used only by tests/consumers reasoning about a record. */
export function hasLiveCar(record: TrainRecord): boolean {
  return record.cars.some((car) =>
    isNativeCar(car) ? car.state !== "released" && car.state !== "failed" : car.state !== "published",
  );
}

/** Attach the `release-train` command to the program. */
export function registerReleaseTrainCommand(program: Command): void {
  const command = program
    .command("release-train")
    .description("coordinate an app's iOS + Android + OTA release as one resumable record (ADR 0004)")
    .argument("[action]", "start | status | release | abort", "status")
    .argument("[id]", "train id (default: the latest train)")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("-p, --profile <name>", "build profile whose env feeds the Android submit + OTA export", "production")
    .option("--platform <p>", "start: restrict to one native platform (ios or android)")
    .option("--no-ota", "start: coordinate the native legs only (no OTA followers)")
    .option("--hold", "start: hold every car until all are approved, then release together")
    .option("--channel <name>", "start: OTA channel the followers publish to", "production")
    .option("--runtime-version <v>", "start: runtime version OTA followers target (default: from app config)")
    .option("--watch", "status: poll until the train settles", false)
    .option("--json", "machine-readable output for CI/agents", false);
  addEnvFlags(command).action(async (action: string, id: string | undefined, options: ReleaseTrainOptions) => {
    switch (action) {
      case "start":
        await runStart(options);
        return;
      case "status":
        await runStatus(id, options);
        return;
      case "release":
        await runRelease(id, options);
        return;
      case "abort":
        runAbort(id, options, createLogger(false));
        return;
      default:
        throw new Error(`Unknown action "${action}". Use start | status | release | abort.`);
    }
  });
}
