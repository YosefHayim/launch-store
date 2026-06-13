/**
 * The build → submit pipeline: the linear spine that runs every step in order and is the only
 * place that knows the whole flow. Each step is a clean labelled line (expanded by `--explain`),
 * and the providers it calls are selected by name from config, so swapping infrastructure never
 * touches this file.
 *
 * `--dry-run` rehearses the entire flow — printing each step and the work it WOULD do — without a
 * network call, a build, or any change to your account, so it runs on a machine with no API key.
 */

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cancel, confirm, isCancel, select } from "@clack/prompts";
import type {
  AndroidCredentials,
  AndroidReleaseOptions,
  AppDescriptor,
  AppleCredentials,
  BuildArtifact,
  BuildCredentials,
  BuildProfile,
  KeystoreAssets,
  LaunchConfig,
  Platform,
  PlayTrack,
  RemoteTarget,
  ResolvedBuildContext,
  SigningAssets,
  SizeReport,
  SubmitTarget,
} from "./types.js";
import { loadConfig } from "./config.js";
import { loadDotenvFile, missingKeys, secretLookingKeys } from "./env.js";
import { getBuildEngine, getCredentialsProvider, getStorageProvider, getSubmitter } from "./registry.js";
import { createLogger, type Logger } from "./logger.js";
import type { GlossaryTopic } from "./glossary.js";
import { run } from "./exec.js";
import { AppStoreConnectClient } from "../apple/ascClient.js";
import { ensureSigningCredentials } from "../apple/credentials.js";
import { ensureUploadKeystore } from "../google/credentials.js";
import { GooglePlayClient, parseServiceAccount } from "../google/playClient.js";

/** Options for one `launch build` invocation. */
export interface BuildRunOptions {
  platform: Platform;
  /** App handle (`--app`); when omitted the pipeline picks the only app or prompts. */
  appName?: string | undefined;
  /** Profile name (`--profile`); defaults to `production`. */
  profileName: string;
  /** Expand each step into a teaching block (`--explain`). */
  explain: boolean;
  /** Upload after building (`--no-submit` disables). */
  submit: boolean;
  /** Where a submission lands (testing track vs production). */
  target: SubmitTarget;
  /** Android-only: Play track override (`--track`). Falls back to the profile, then `internal`. */
  track?: PlayTrack;
  /** Android-only: staged-rollout fraction override (`--rollout`), 0–1. Falls back to the profile, then 1. */
  rollout?: number;
  /** Rehearse the flow with no real changes (`--dry-run`). */
  dryRun: boolean;
  /** Build on a remote Mac (AWS EC2 Mac / a Mac over SSH) instead of locally. iOS-only. */
  remote?: RemoteTarget;
}

/**
 * The shared front half of every build path: config + app + profile + validated env + a logger.
 *
 * Produced by {@link prepareBuild} and consumed by the local spine ({@link runLocalBuild}), the remote
 * pipeline (`core/remotePipeline.ts`), and the EAS handoff (`core/easPipeline.ts`) so all three select
 * the app, validate `.env`, and log the header identically — the divergence is only in HOW they build.
 */
export interface PreparedBuild {
  config: LaunchConfig;
  app: AppDescriptor;
  profile: ResolvedBuildContext["profile"];
  env: Record<string, string>;
  ctx: ResolvedBuildContext;
  log: Logger;
}

/** Placeholder API key used in `--dry-run`, so the flow runs without an imported credential. */
export const DRY_RUN_KEY = { keyId: "DRYRUN", issuerId: "DRYRUN", p8: "" };

/**
 * The built-in iOS provider defaults that `config` carries by default, and their Android twins.
 *
 * `buildEngine`/`submit` are single, platform-defaulted config fields: an iOS-only config needs
 * nothing, and an Android build swaps the *iOS baseline default* for its Android twin. Any non-default
 * override (e.g. `eas`) is honored as-is on both platforms — see {@link resolveBuildEngineName}.
 */
const IOS_BUILD_ENGINE = "fastlane";
const IOS_SUBMITTER = "app-store-connect";
const ANDROID_BUILD_ENGINE = "gradle";
const ANDROID_SUBMITTER = "google-play";

/** The build engine name for a platform, swapping the iOS baseline default (`fastlane`) for `gradle` on Android. */
export function resolveBuildEngineName(config: LaunchConfig, platform: Platform): string {
  if (platform === "android" && config.buildEngine === IOS_BUILD_ENGINE) return ANDROID_BUILD_ENGINE;
  return config.buildEngine;
}

/** The submitter name for a platform, swapping the iOS baseline default (`app-store-connect`) for `google-play` on Android. */
export function resolveSubmitterName(config: LaunchConfig, platform: Platform): string {
  if (platform === "android" && config.submit === IOS_SUBMITTER) return ANDROID_SUBMITTER;
  return config.submit;
}

/**
 * Resolve the Android track + rollout for one invocation: an explicit `--track`/`--rollout` wins,
 * then the profile default, then the safe fallback (`internal` for a testing target, `production`
 * only when the target itself is production). The result rides on {@link ResolvedBuildContext.android}
 * so the Google Play submitter reads one source of truth.
 */
export function resolveAndroidRelease(
  options: Pick<BuildRunOptions, "target" | "track" | "rollout">,
  profile: BuildProfile,
): AndroidReleaseOptions {
  const fallback: PlayTrack = options.target === "production" ? "production" : "internal";
  return {
    track: options.track ?? profile.track ?? fallback,
    rollout: options.rollout ?? profile.rollout ?? 1.0,
  };
}

export const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Pick the app to build: an explicit `--app`, the sole discovered app, or an interactive prompt. */
export async function selectApp(apps: AppDescriptor[], appName: string | undefined): Promise<AppDescriptor> {
  if (apps.length === 0) throw new Error("No apps found. Run Launch from a repo containing at least one app.json.");
  if (appName) {
    const match = apps.find((app) => app.name === appName);
    if (!match) throw new Error(`App "${appName}" not found. Available: ${apps.map((a) => a.name).join(", ")}.`);
    return match;
  }
  const sole = apps[0];
  if (apps.length === 1 && sole) return sole;
  const choice = await select({
    message: "Which app?",
    options: apps.map((app) => ({ value: app.name, label: `${app.name}${app.bundleId ? `  (${app.bundleId})` : ""}` })),
  });
  if (isCancel(choice)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  const picked = apps.find((app) => app.name === choice);
  if (!picked) throw new Error("Could not match the selected app.");
  return picked;
}

/** Set the iOS build number into the generated Info.plist so the binary carries the bumped value. */
async function setIosBuildNumber(appDir: string, buildNumber: number): Promise<boolean> {
  const iosDir = join(appDir, "ios");
  if (!existsSync(iosDir)) return false;
  const targetDir = readdirSync(iosDir).find((entry) => existsSync(join(iosDir, entry, "Info.plist")));
  if (!targetDir) return false;
  await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleVersion ${buildNumber}`,
    join(iosDir, targetDir, "Info.plist"),
  ]);
  return true;
}

/**
 * A yes/no prompt that exits cleanly on cancel. Shared with `launch creds setup` so provisioning
 * confirmations look identical whether triggered inline by a build or run explicitly.
 */
export function interactiveConfirm(message: string): Promise<boolean> {
  return confirm({ message }).then((answer) => {
    if (isCancel(answer)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    return answer;
  });
}

/**
 * Resolve signing assets: reuse silently when cached, otherwise (interactively) provision them now.
 * Mirrors the locked decision — the build never hard-blocks; it offers to run setup inline.
 */
async function resolveSigning(
  credentials: AppleCredentials,
  app: AppDescriptor,
  log: Logger,
  dryRun: boolean,
): Promise<SigningAssets> {
  const bundleId = app.bundleId;
  if (!bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);
  if (credentials.signing) {
    log.step(
      "signing",
      `reusing cert ${credentials.signing.certSerial} · ${credentials.signing.profileName}`,
      "code-signing",
    );
    return credentials.signing;
  }
  if (!dryRun)
    log.info(`No cached signing assets for ${bundleId} — provisioning now (you'll confirm each Apple resource).`);
  return ensureSigningCredentials({
    bundleId,
    appName: app.name,
    ascKey: credentials.ascKey,
    log,
    dryRun,
    confirmCreate: interactiveConfirm,
  });
}

/**
 * Resolve the upload keystore: reuse silently when cached, otherwise provision (or import) it inline.
 * The Android twin of {@link resolveSigning} — the build never hard-blocks; it offers setup in place.
 */
async function resolveKeystore(
  credentials: AndroidCredentials,
  app: AppDescriptor,
  log: Logger,
  dryRun: boolean,
): Promise<KeystoreAssets> {
  if (credentials.keystore) {
    log.step("keystore", `reusing upload keystore (alias ${credentials.keystore.alias})`, "upload-key");
    return credentials.keystore;
  }
  if (!dryRun) log.info(`No cached upload keystore for ${app.name} — provisioning one now.`);
  return ensureUploadKeystore({ appName: app.name, log, dryRun, confirmCreate: interactiveConfirm });
}

/**
 * Resolve the shared front half of a build: config, the chosen app, the profile, a validated env, a
 * logger, and the {@link ResolvedBuildContext}. Identical for iOS and Android — every build path
 * (local, remote, EAS) starts here so app selection and `.env` validation never drift; the platforms
 * diverge only in HOW they build (see {@link runIosBuild} / {@link runAndroidBuild}).
 */
export async function prepareBuild(options: BuildRunOptions): Promise<PreparedBuild> {
  const { dryRun, platform } = options;
  const log = createLogger(options.explain);

  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
  const profile = config.profiles[options.profileName] ?? { name: options.profileName, sizeBudgetMB: 200 };
  const remoteSuffix = options.remote ? (options.remote.kind === "aws" ? " · remote(aws)" : " · remote(ssh)") : "";
  log.step("config", `${app.name} · ${profile.name} · ${platform}${dryRun ? " · dry-run" : ""}${remoteSuffix}`);

  // Validate env against .env.example before doing any expensive work.
  const env = loadDotenvFile(join(app.dir, profile.envFile ?? ".env"));
  const missing = missingKeys(app.dir, env);
  if (missing.length > 0)
    throw new Error(`Missing env keys (in .env.example, absent from .env): ${missing.join(", ")}`);
  for (const name of secretLookingKeys(env)) {
    log.warn(`"${name}" looks like a backend secret — it would be bundled into the app. Keep secrets out of .env.`);
  }
  log.step("env", `${Object.keys(env).length} vars validated`, "env-vars");

  const android = platform === "android" ? resolveAndroidRelease(options, profile) : undefined;
  const ctx: ResolvedBuildContext = {
    platform,
    app,
    profile,
    env,
    explain: options.explain,
    dryRun,
    ...(android ? { android } : {}),
  };
  return { config, app, profile, env, ctx, log };
}

/**
 * Run a build. Dispatches to the right path: Android always builds locally (no Mac needed); for iOS,
 * `--remote` → the remote-Mac pipeline, `buildEngine: "eas"` → the EAS handoff, otherwise the local
 * Mac spine. Throws with a clear message on any failed step.
 */
export async function runBuild(options: BuildRunOptions): Promise<void> {
  const prepared = await prepareBuild(options);

  // Android builds on any OS — it has no off-Mac problem, so no remote/EAS off-ramp applies.
  if (options.platform === "android") return runLocalBuild(prepared, options);

  // `--remote` wins; a config `buildEngine: "remote-mac"` defaults the remote target to AWS.
  const remote =
    options.remote ?? (prepared.config.buildEngine === "remote-mac" ? ({ kind: "aws" } as const) : undefined);
  if (remote) {
    const { runRemoteBuild } = await import("./remotePipeline.js");
    return runRemoteBuild(prepared, { ...options, remote });
  }
  if (prepared.config.buildEngine === "eas") {
    const { runEasBuild } = await import("./easPipeline.js");
    return runEasBuild(prepared, options);
  }
  return runLocalBuild(prepared, options);
}

/** The local spine: fork by platform after the shared front (prepareBuild) and before the shared tail. */
async function runLocalBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  return prepared.ctx.platform === "android" ? runAndroidBuild(prepared, options) : runIosBuild(prepared, options);
}

/** The iOS spine: prebuild → resolve creds/signing → build number → gym → size → store → submit. */
async function runIosBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, ctx, log } = prepared;
  const { dryRun } = options;

  // 2. Generate the native project only when it's missing (bare/committed ios/ is used as-is).
  await ensureNativeProject(ctx, log);

  // 3. Resolve the API key, then reuse-or-provision the distribution cert + profile.
  const resolved: BuildCredentials = dryRun
    ? { platform: "ios", ascKey: DRY_RUN_KEY }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== "ios") throw new Error("Expected iOS credentials for an iOS build.");
  log.step("credentials", dryRun ? "dry-run (no key needed)" : `key ${resolved.ascKey.keyId}`, "asc-api-key");
  const signing = await resolveSigning(resolved, app, log, dryRun);
  const credentials: BuildCredentials = { platform: "ios", ascKey: resolved.ascKey, signing };

  // 4. Auto-bump the build number from the last one Apple has on record.
  const bundleId = app.bundleId ?? "";
  const buildNumber = await nextBuildNumber(resolved.ascKey, bundleId, dryRun);
  const stamped = dryRun ? false : await setIosBuildNumber(app.dir, buildNumber);
  log.step(
    "build number",
    dryRun
      ? `would set next build number (≈${buildNumber})`
      : stamped
        ? `set to ${buildNumber}`
        : `${buildNumber} (could not stamp Info.plist)`,
    "build-number",
  );

  // 5. Compile, sign, export, and analyze size.
  const { artifactPath, sizeReport } = await getBuildEngine(resolveBuildEngineName(config, "ios")).build(
    ctx,
    credentials,
  );
  log.step("build", dryRun ? "skipped (dry-run)" : artifactPath);

  // 6. Show size and soft-gate against the profile budget.
  await reportSizeAndGate(sizeReport, prepared.profile.sizeBudgetMB ?? 200, log);

  // 7. Store the artifact (shared with Android).
  await storeArtifact(prepared, artifactPath, buildNumber, sizeReport);

  // 8. Submit (TestFlight by default), then report processing status.
  if (options.submit) {
    if (dryRun) {
      log.step(
        "submit",
        `would upload to ${options.target === "testing" ? "TestFlight" : "App Store review"}`,
        "testflight",
      );
    } else {
      await getSubmitter(resolveSubmitterName(config, "ios")).submit(artifactPath, options.target, credentials, ctx);
      log.step(
        "submit",
        options.target === "testing" ? "uploaded to TestFlight" : "submitted for App Store review",
        "testflight",
      );
      if (options.target === "testing" && bundleId) {
        await reportProcessing(resolved.ascKey, bundleId, buildNumber, log);
      }
    }
  }

  log.gap();
  log.info(
    `Done. ${app.name} ${app.version ?? "0.0.0"} (${buildNumber})${dryRun ? " · dry-run, nothing changed" : ` · ${mb(sizeReport.artifactBytes)} on disk`}`,
  );
}

/** The Android spine: prebuild → resolve service account + keystore → versionCode → gradle .aab → size → store → supply. */
async function runAndroidBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, ctx, log } = prepared;
  const { dryRun } = options;
  const packageName = app.packageName;
  if (!packageName) throw new Error(`No Android application id for ${app.name}. Set android.package in app.json.`);

  // 2. Generate the native project only when it's missing (committed android/ is used as-is).
  await ensureAndroidProject(ctx, log);

  // 3. Resolve the Play service account, then reuse-or-provision the upload keystore.
  const resolved: BuildCredentials = dryRun
    ? { platform: "android", serviceAccountJson: "" }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== "android") throw new Error("Expected Android credentials for an Android build.");
  log.step("credentials", dryRun ? "dry-run (no service account needed)" : "service account loaded", "service-account");
  const keystore = await resolveKeystore(resolved, app, log, dryRun);
  const credentials: BuildCredentials = {
    platform: "android",
    serviceAccountJson: resolved.serviceAccountJson,
    keystore,
  };

  // 4. Auto-bump the versionCode from the latest Google Play has on record (app.json as a floor).
  const versionCode = await nextVersionCode(
    resolved.serviceAccountJson,
    packageName,
    app.androidVersionCode ?? 0,
    dryRun,
  );
  const stamped = dryRun ? false : setAndroidVersionCode(app.dir, versionCode);
  log.step(
    "version code",
    dryRun
      ? `would set next versionCode (≈${versionCode})`
      : stamped
        ? `set to ${versionCode}`
        : `${versionCode} (could not stamp build.gradle)`,
    "version-code",
  );

  // 5. Compile, sign (upload key), export the .aab, and estimate the download with bundletool.
  const { artifactPath, sizeReport } = await getBuildEngine(resolveBuildEngineName(config, "android")).build(
    ctx,
    credentials,
  );
  log.step("build", dryRun ? "skipped (dry-run)" : artifactPath);

  // 6. Show size and soft-gate against the profile budget (shared gate; bundletool estimate).
  await reportSizeAndGate(sizeReport, prepared.profile.sizeBudgetMB ?? 200, log, "bundletool");

  // 7. Store the artifact (shared with iOS).
  await storeArtifact(prepared, artifactPath, versionCode, sizeReport);

  // 8. Submit to the resolved Play track via fastlane supply.
  const track = ctx.android?.track ?? "internal";
  if (options.submit) {
    if (dryRun) {
      log.step("submit", `would upload to the ${track} track via fastlane supply`, "play-track");
    } else {
      await getSubmitter(resolveSubmitterName(config, "android")).submit(
        artifactPath,
        options.target,
        credentials,
        ctx,
      );
      log.step("submit", `uploaded to the ${track} track`, "play-track");
    }
  }

  log.gap();
  log.info(
    `Done. ${app.name} ${app.version ?? "0.0.0"} (${versionCode})${dryRun ? " · dry-run, nothing changed" : ` · ${mb(sizeReport.artifactBytes)} on disk`}`,
  );
}

/** Store the built artifact (skipped in dry-run) and log its location. Shared by both platform spines. */
async function storeArtifact(
  prepared: PreparedBuild,
  artifactPath: string,
  buildNumber: number,
  sizeReport: SizeReport,
): Promise<void> {
  const { config, app, profile, ctx, log } = prepared;
  if (ctx.dryRun) {
    log.step("store", "skipped (dry-run)");
    return;
  }
  const artifact: BuildArtifact = {
    path: artifactPath,
    platform: ctx.platform,
    appName: app.name,
    profile: profile.name,
    version: app.version ?? "0.0.0",
    buildNumber,
    sizeReport,
    createdAt: new Date().toISOString(),
  };
  const stored = await getStorageProvider(config.storage).put(artifact);
  log.step("store", stored.location);
}

/** Run `expo prebuild` only when there's no native `ios/` yet; otherwise use what's committed. */
async function ensureNativeProject(ctx: ResolvedBuildContext, log: Logger): Promise<void> {
  const iosDir = join(ctx.app.dir, "ios");
  if (existsSync(iosDir)) {
    log.step("native project", "using existing ios/ (no prebuild needed)", "prebuild");
    return;
  }
  if (ctx.dryRun) {
    log.step("prebuild", "would run `expo prebuild --platform ios` (no ios/ found)", "prebuild");
    return;
  }
  await run("npx", ["expo", "prebuild", "--platform", "ios", "--clean"], { cwd: ctx.app.dir, env: ctx.env });
  log.step("prebuild", "ios/ generated from app.json", "prebuild");
}

/** Run `expo prebuild` only when there's no native `android/` yet; otherwise use what's committed. */
async function ensureAndroidProject(ctx: ResolvedBuildContext, log: Logger): Promise<void> {
  const androidDir = join(ctx.app.dir, "android");
  if (existsSync(androidDir)) {
    log.step("native project", "using existing android/ (no prebuild needed)", "prebuild");
    return;
  }
  if (ctx.dryRun) {
    log.step("prebuild", "would run `expo prebuild --platform android` (no android/ found)", "prebuild");
    return;
  }
  await run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], { cwd: ctx.app.dir, env: ctx.env });
  log.step("prebuild", "android/ generated from app.json", "prebuild");
}

/** Resolve the next build number from App Store Connect, or a placeholder in dry-run. */
export async function nextBuildNumber(
  ascKey: AppleCredentials["ascKey"],
  bundleId: string,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || !bundleId) return 1;
  const asc = new AppStoreConnectClient(ascKey);
  return (await asc.getLatestBuildNumber(bundleId)) + 1;
}

/**
 * Resolve the next Android `versionCode`: one above the highest of Google Play's latest and the
 * `app.json` floor, or a placeholder in dry-run. The Android twin of {@link nextBuildNumber} — the
 * store stays the source of truth, but an intentional local bump (the floor) is never clobbered.
 */
export async function nextVersionCode(
  serviceAccountJson: string,
  packageName: string,
  floor: number,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || !packageName || !serviceAccountJson) return Math.max(floor, 0) + 1;
  const play = new GooglePlayClient(parseServiceAccount(serviceAccountJson));
  const latest = await play.getLatestVersionCode(packageName);
  return Math.max(latest, floor) + 1;
}

/**
 * Stamp the bumped `versionCode` into the generated `android/app/build.gradle`. A line-edit (no
 * PlistBuddy analog on Android); returns whether a `versionCode <n>` line was found and updated.
 */
function setAndroidVersionCode(appDir: string, versionCode: number): boolean {
  const gradlePath = join(appDir, "android", "app", "build.gradle");
  if (!existsSync(gradlePath)) return false;
  const original = readFileSync(gradlePath, "utf8");
  const updated = original.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  if (updated === original) return false;
  writeFileSync(gradlePath, updated);
  return true;
}

/** Poll the uploaded build's processing state briefly so the run ends with a clear status. */
async function reportProcessing(
  ascKey: AppleCredentials["ascKey"],
  bundleId: string,
  buildNumber: number,
  log: Logger,
): Promise<void> {
  const asc = new AppStoreConnectClient(ascKey);
  log.info("Waiting for TestFlight to process the build (safe to Ctrl-C; it keeps processing)…");
  for (let attempt = 0; attempt < 6; attempt++) {
    await delay(10_000);
    try {
      const state = await asc.getBuildProcessingState(bundleId, buildNumber);
      if (state && state !== "PROCESSING") {
        log.step("processing", state === "VALID" ? "ready to test on TestFlight" : `state: ${state}`);
        return;
      }
    } catch {
      /* transient; keep polling */
    }
  }
  log.info("Still processing — it'll appear in TestFlight shortly.");
}

/**
 * Print the size report and, if the worst-case download exceeds the budget, ask before continuing.
 * Shared by every build path; `sizeTopic` lets the caller pick the right `--explain` block (iOS app
 * thinning vs Android bundletool). Install size is shown only when the platform gives an honest figure.
 */
export async function reportSizeAndGate(
  report: SizeReport,
  budgetMB: number,
  log: Logger,
  sizeTopic: GlossaryTopic = "app-thinning",
): Promise<void> {
  const budgetBytes = budgetMB * 1024 * 1024;
  if (report.entries.length === 0) {
    log.step("size", `${mb(report.artifactBytes)} on disk (no per-device report)`, sizeTopic);
    return;
  }
  const worst = report.entries.reduce((max, entry) => (entry.downloadBytes > max.downloadBytes ? entry : max));
  for (const entry of report.entries) {
    const installSuffix = entry.installBytes > 0 ? ` · install ${mb(entry.installBytes)}` : "";
    log.step("size", `${entry.device}: download ${mb(entry.downloadBytes)}${installSuffix}`, sizeTopic);
  }
  if (worst.downloadBytes > budgetBytes) {
    const proceed = await confirm({
      message: `${worst.device} downloads ${mb(worst.downloadBytes)}, over the ${budgetMB} MB budget. Continue?`,
    });
    if (isCancel(proceed) || !proceed) {
      cancel("Stopped before upload (over size budget).");
      process.exit(0);
    }
  }
}
