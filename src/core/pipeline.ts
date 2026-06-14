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
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import type {
  AccountRecord,
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
import { refreshIdentityIfStale, resolveBuildAccount, setActiveKeyId } from "./accounts.js";
import { loadConfig, writeAppVersion } from "./config.js";
import { pickOne } from "./prompt.js";
import { compareVersions, formatVersion, highestVersion, nextVersion, parseVersion } from "./version.js";
import { loadDotenvFile, missingKeys, secretLookingKeys } from "./env.js";
import { getBuildEngine, getCredentialsProvider, getStorageProvider, getSubmitter } from "./registry.js";
import { createLogger, type Logger } from "./logger.js";
import type { GlossaryTopic } from "./glossary.js";
import { capture, exists, run } from "./exec.js";
import { isInteractive, runWithProgress, withSpinner } from "./progress.js";
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
  /** Skip the interactive pre-upload confirmation (`--yes`); always implied in CI / non-TTY. */
  yes?: boolean;
  /** Force a from-scratch build (`--clean`); omitted/false lets the fingerprint decide. iOS-gated; Android cleans too. */
  forceClean?: boolean;
  /** Build on a remote Mac (AWS EC2 Mac / a Mac over SSH) instead of locally. iOS-only. */
  remote?: RemoteTarget;
  /** Apple account to build with (`--account`): a label or Key ID. Defaults to the active account. iOS-only. */
  account?: string;
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

/**
 * Pick the app to build: an explicit `--app`, the sole discovered app, or an interactive prompt. The
 * prompt is the shared {@link pickOne}, which past a threshold (large monorepos) switches the flat list
 * to a fuzzy type-to-search over the name and bundle/package id. With no TTY and more than one app it
 * refuses to guess and tells the user to pass `--app`, rather than silently building the wrong one.
 */
export async function selectApp(apps: AppDescriptor[], appName: string | undefined): Promise<AppDescriptor> {
  if (apps.length === 0) throw new Error("No apps found. Run Launch from a repo containing at least one app.json.");
  if (appName) {
    const match = apps.find((app) => app.name === appName);
    if (!match) throw new Error(`App "${appName}" not found. Available: ${apps.map((a) => a.name).join(", ")}.`);
    return match;
  }
  const sole = apps[0];
  if (apps.length === 1 && sole) return sole;

  return pickOne<AppDescriptor>({
    message: `Which app? (${apps.length} found)`,
    options: apps.map((app) => {
      const hint = app.bundleId ?? app.packageName;
      return hint ? { value: app, label: app.name, hint } : { value: app, label: app.name };
    }),
    canPrompt: process.stdin.isTTY,
    nonInteractive: { kind: "require", flagHint: "— pass --app <name> to choose one non-interactively." },
  });
}

/** The interactive build-time account picker: choose among onboarded accounts and make the pick active. */
async function pickAccount(accounts: AccountRecord[]): Promise<AccountRecord> {
  const choice = await select({
    message: "Which Apple account?",
    options: accounts.map((account) => {
      const hint = account.teamId ?? (account.apps?.length ? account.apps.slice(0, 2).join(", ") : undefined);
      return { value: account.keyId, label: account.label, ...(hint ? { hint } : {}) };
    }),
  });
  if (isCancel(choice)) {
    cancel("Cancelled.");
    process.exit(0);
  }
  const picked = accounts.find((account) => account.keyId === choice);
  if (!picked) throw new Error("Could not match the selected account.");
  setActiveKeyId(picked.keyId);
  return picked;
}

/**
 * Resolve which Apple account an iOS build uses: `--account`/`ASC_ACCOUNT` → the active account → an
 * interactive picker (TTY only; CI fails fast with the fix). Shared by the local spine and the remote
 * pipeline so both select the account identically. Logs the chosen account as a build step.
 */
export async function resolveIosAccount(
  options: Pick<BuildRunOptions, "account">,
  log: Logger,
): Promise<AccountRecord> {
  const account = await resolveBuildAccount({
    selector: options.account ?? process.env["ASC_ACCOUNT"],
    interactive: isInteractive(),
    pick: pickAccount,
  });
  log.step("account", `${account.label}${account.teamId ? ` · team ${account.teamId}` : ""} · key ${account.keyId}`);
  return account;
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
 * Stamp the chosen marketing version into the generated `Info.plist` (`CFBundleShortVersionString`),
 * the iOS twin of {@link setIosBuildNumber}. Stamping the plist directly — rather than only writing
 * `app.json` — is what makes the choice take effect even when `ios/` is committed (so prebuild, which
 * would otherwise read `app.json`, never runs). Returns whether a target Info.plist was found.
 */
async function setIosMarketingVersion(appDir: string, version: string): Promise<boolean> {
  const iosDir = join(appDir, "ios");
  if (!existsSync(iosDir)) return false;
  const targetDir = readdirSync(iosDir).find((entry) => existsSync(join(iosDir, entry, "Info.plist")));
  if (!targetDir) return false;
  await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :CFBundleShortVersionString ${version}`,
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
    forceClean: options.forceClean ?? false,
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

  // 2.5. Resolve which Apple account to build with (skipped in dry-run, which uses the placeholder key).
  let account: AccountRecord | undefined;
  if (!dryRun) {
    account = await resolveIosAccount(options, log);
    ctx.account = account.keyId;
  }

  // 3. Resolve the API key, then reuse-or-provision the distribution cert + profile.
  const resolved: BuildCredentials = dryRun
    ? { platform: "ios", ascKey: DRY_RUN_KEY }
    : await getCredentialsProvider(config.credentials).resolve(ctx);
  if (resolved.platform !== "ios") throw new Error("Expected iOS credentials for an iOS build.");
  log.step("credentials", dryRun ? "dry-run (no key needed)" : `key ${resolved.ascKey.keyId}`, "asc-api-key");
  const signing = await resolveSigning(resolved, app, log, dryRun);
  const credentials: BuildCredentials = { platform: "ios", ascKey: resolved.ascKey, signing };
  const bundleId = app.bundleId ?? "";

  // 3b. Suggest the next marketing version from what's already on the store (interactive uploads only).
  if (options.submit) await resolveMarketingVersion(resolved.ascKey, bundleId, app, options, log);

  // 4. Auto-bump the build number from the last one Apple has on record.
  const buildNumber = dryRun
    ? await nextBuildNumber(resolved.ascKey, bundleId, dryRun)
    : await withSpinner("Checking last build number on App Store Connect", () =>
        nextBuildNumber(resolved.ascKey, bundleId, dryRun),
      );
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

  // 5. Compile, sign, export, and analyze size — clean or incremental per the build fingerprint.
  if (!dryRun) await nudgeIfNoCcache(log);
  const { artifactPath, sizeReport, cleanBuilt } = await getBuildEngine(resolveBuildEngineName(config, "ios")).build(
    ctx,
    credentials,
  );
  log.step(
    "build",
    dryRun
      ? "skipped (dry-run)"
      : `${cleanBuilt ? "clean (from scratch)" : "incremental (cache warm)"} · ${artifactPath}`,
    "incremental-build",
  );
  if (!dryRun) await reportCcacheStats(log);

  // 6. Show the per-device size readout (the budget decision happens at the upload boundary).
  reportSize(sizeReport, log);

  // 7. Store the artifact (shared with Android).
  await storeArtifact(prepared, artifactPath, buildNumber, sizeReport, cleanBuilt);

  // 8. Confirm the upload (size shown; budget enforced here), submit, then report processing status.
  const destination = options.target === "testing" ? "TestFlight" : "App Store review";
  if (options.submit) {
    if (dryRun) {
      log.step("submit", `would upload to ${destination}`, "testflight");
    } else {
      await confirmUpload({
        report: sizeReport,
        budgetMB: prepared.profile.sizeBudgetMB ?? 200,
        destination,
        app,
        version: app.version ?? "0.0.0",
        buildNumber,
        yes: options.yes ?? false,
        log,
      });
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

  if (dryRun) {
    log.gap();
    log.info(`Done. ${app.name} ${app.version ?? "0.0.0"} (${buildNumber}) · dry-run, nothing changed`);
    return;
  }
  // Backfill this account's Team ID + app names from Apple the first time we have a live key in hand.
  if (account) await refreshIdentityIfStale(account, resolved.ascKey);
  const link =
    options.submit && bundleId ? await resolveAscBuildLink(resolved.ascKey, bundleId, options.target) : undefined;
  renderReceipt({
    app,
    version: app.version ?? "0.0.0",
    buildNumber,
    report: sizeReport,
    destination: receiptDestination("ios", options),
    link,
    log,
  });
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
  const versionCode = dryRun
    ? await nextVersionCode(resolved.serviceAccountJson, packageName, app.androidVersionCode ?? 0, dryRun)
    : await withSpinner("Checking latest versionCode on Google Play", () =>
        nextVersionCode(resolved.serviceAccountJson, packageName, app.androidVersionCode ?? 0, dryRun),
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
  const { artifactPath, sizeReport, cleanBuilt } = await getBuildEngine(
    resolveBuildEngineName(config, "android"),
  ).build(ctx, credentials);
  log.step(
    "build",
    dryRun ? "skipped (dry-run)" : `${cleanBuilt ? "clean (from scratch)" : "incremental (Gradle)"} · ${artifactPath}`,
    "incremental-build",
  );

  // 6. Show the size readout (bundletool estimate; the budget decision happens at the upload boundary).
  reportSize(sizeReport, log, "bundletool");

  // 7. Store the artifact (shared with iOS).
  await storeArtifact(prepared, artifactPath, versionCode, sizeReport, cleanBuilt);

  // 8. Confirm the upload (size shown; budget enforced here), then submit via fastlane supply.
  const track = ctx.android?.track ?? "internal";
  if (options.submit) {
    if (dryRun) {
      log.step("submit", `would upload to the ${track} track via fastlane supply`, "play-track");
    } else {
      await confirmUpload({
        report: sizeReport,
        budgetMB: prepared.profile.sizeBudgetMB ?? 200,
        destination: `Google Play (${track} track)`,
        app,
        version: app.version ?? "0.0.0",
        buildNumber: versionCode,
        yes: options.yes ?? false,
        log,
      });
      await getSubmitter(resolveSubmitterName(config, "android")).submit(
        artifactPath,
        options.target,
        credentials,
        ctx,
      );
      log.step("submit", `uploaded to the ${track} track`, "play-track");
    }
  }

  if (dryRun) {
    log.gap();
    log.info(`Done. ${app.name} ${app.version ?? "0.0.0"} (${versionCode}) · dry-run, nothing changed`);
    return;
  }
  renderReceipt({
    app,
    version: app.version ?? "0.0.0",
    buildNumber: versionCode,
    report: sizeReport,
    destination: receiptDestination("android", options, track),
    link: options.submit ? "https://play.google.com/console" : undefined,
    log,
  });
}

/** Store the built artifact (skipped in dry-run) and log its location. Shared by both platform spines. */
async function storeArtifact(
  prepared: PreparedBuild,
  artifactPath: string,
  buildNumber: number,
  sizeReport: SizeReport,
  cleanBuilt: boolean,
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
    clean: cleanBuilt,
    createdAt: new Date().toISOString(),
  };
  const stored = await getStorageProvider(config.storage).put(artifact);
  log.step("store", stored.location);
}

/** Nudge (once, before building) when ccache is absent — the build still runs, just uncached. */
async function nudgeIfNoCcache(log: Logger): Promise<void> {
  if (!(await exists("ccache"))) {
    log.warn(
      "ccache isn't installed — this build won't be cached. Run `launch doctor --fix` to speed up future builds.",
    );
  }
}

/** After an iOS build, surface a one-line ccache hit summary when ccache is present. Best-effort. */
async function reportCcacheStats(log: Logger): Promise<void> {
  if (!(await exists("ccache"))) return;
  try {
    const stats = await capture("ccache", ["-s"]);
    const hitLine = stats.split("\n").find((line) => /hit/i.test(line));
    if (hitLine) log.step("cache", hitLine.trim(), "ccache");
  } catch {
    /* ccache -s unavailable — skip the summary */
  }
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
  await runWithProgress("npx", ["expo", "prebuild", "--platform", "ios", "--clean"], {
    label: "Generating ios/ (expo prebuild)",
    cwd: ctx.app.dir,
    env: ctx.env,
  });
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
  await runWithProgress("npx", ["expo", "prebuild", "--platform", "android", "--clean"], {
    label: "Generating android/ (expo prebuild)",
    cwd: ctx.app.dir,
    env: ctx.env,
  });
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

/** Sentinel `select` values for the two non-numeric choices in the version prompt. */
const KEEP_VERSION = "__keep__";
const CUSTOM_VERSION = "__custom__";

/**
 * Suggest — and apply — the app's marketing version before the build, from what's already on the
 * store. Queries App Store Connect for the highest existing version (App Store + TestFlight), proposes
 * the next patch / minor / major above it (never below the app's own config version), and lets the
 * developer pick, keep the current one, or type one. The choice is stamped into Info.plist and
 * persisted to a static `app.json`, and mirrored onto `app.version` so every later step (the size
 * confirm, the receipt) reports it — giving a deliberate, collision-free version each release.
 *
 * Interactive uploads only: a dry-run rehearses the step with no network, and `--yes` / CI / a
 * non-TTY leave the config version untouched (versions are set deliberately there, not via a prompt).
 */
async function resolveMarketingVersion(
  ascKey: AppleCredentials["ascKey"],
  bundleId: string,
  app: AppDescriptor,
  options: BuildRunOptions,
  log: Logger,
): Promise<void> {
  const current = app.version ?? "0.0.0";

  if (options.dryRun) {
    log.step(
      "version",
      `would suggest the next version above the store's latest (config has ${current})`,
      "marketing-version",
    );
    return;
  }
  if (options.yes || !isInteractive()) {
    log.step(
      "version",
      `${current} (from app config; not prompting under --yes / non-interactive)`,
      "marketing-version",
    );
    return;
  }

  const latest = bundleId
    ? await withSpinner("Checking versions already on App Store Connect", () =>
        new AppStoreConnectClient(ascKey).getLatestMarketingVersion(bundleId),
      )
    : null;

  // Never propose at or below what's already on the store or what the app config already declares.
  const baseline = highestVersion([latest, current].filter((v): v is string => v !== null)) ?? current;
  const patch = nextVersion(baseline, "patch");
  const minor = nextVersion(baseline, "minor");
  const major = nextVersion(baseline, "major");

  const choice = await select({
    message: latest
      ? `App Store Connect's latest is ${latest}. Which version ships next?`
      : "No versions on App Store Connect yet. Which version ships?",
    initialValue: latest ? patch : KEEP_VERSION,
    options: [
      { value: patch, label: `Patch  → ${patch}`, hint: "bug fixes" },
      { value: minor, label: `Minor  → ${minor}`, hint: "new features" },
      { value: major, label: `Major  → ${major}`, hint: "breaking changes" },
      { value: KEEP_VERSION, label: `Keep   → ${current}`, hint: "reuse the app config version" },
      { value: CUSTOM_VERSION, label: "Custom…", hint: "type a version" },
    ],
  });
  if (isCancel(choice)) {
    cancel("Cancelled.");
    process.exit(0);
  }

  let chosen: string;
  if (choice === CUSTOM_VERSION) {
    const typed = await text({
      message: "Version (MAJOR.MINOR.PATCH):",
      initialValue: patch,
      validate: (value) => (value && parseVersion(value) ? undefined : "Use a version like 1.2.3."),
    });
    if (isCancel(typed)) {
      cancel("Cancelled.");
      process.exit(0);
    }
    const parsed = parseVersion(typed);
    chosen = parsed ? formatVersion(parsed) : typed.trim();
  } else if (choice === KEEP_VERSION) {
    chosen = current;
  } else {
    chosen = choice;
  }

  if (latest && compareVersions(chosen, latest) <= 0) {
    log.warn(
      `${chosen} doesn't increment the store's ${latest} — fine for another TestFlight build, but the App Store rejects a release that reuses a version.`,
    );
  }

  const stamped = await setIosMarketingVersion(app.dir, chosen);
  const persisted = writeAppVersion(app, chosen);
  app.version = chosen;
  const notes = [persisted ? "app config updated" : "app config not written (dynamic config)"];
  if (!stamped) notes.push("Info.plist not stamped");
  log.step("version", `${chosen} (${notes.join("; ")})`, "marketing-version");
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

/**
 * Poll the uploaded build's processing state briefly under a spinner, so the run ends with a clear
 * status instead of dead air between polls. Safe to Ctrl-C — Apple keeps processing regardless.
 */
export async function reportProcessing(
  ascKey: AppleCredentials["ascKey"],
  bundleId: string,
  buildNumber: number,
  log: Logger,
): Promise<void> {
  const asc = new AppStoreConnectClient(ascKey);
  const state = await withSpinner("Processing on Apple's side (safe to Ctrl-C; it keeps processing)", async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(10_000);
      try {
        const current = await asc.getBuildProcessingState(bundleId, buildNumber);
        if (current && current !== "PROCESSING") return current;
      } catch {
        /* transient; keep polling */
      }
    }
    return null;
  });
  if (state) {
    log.step("processing", state === "VALID" ? "ready to test on TestFlight" : `state: ${state}`);
  } else {
    log.info("Still processing — it'll appear in TestFlight shortly.");
  }
}

/** Worst-case store download across device variants, or the on-disk size when no per-device report exists. */
export function worstDownloadBytes(report: SizeReport): number {
  if (report.entries.length === 0) return report.artifactBytes;
  return report.entries.reduce((max, entry) => Math.max(max, entry.downloadBytes), 0);
}

/**
 * The canonical size string wherever a size headline appears (the upload confirm and the receipt):
 * both numbers, no hierarchy. Falls back to on-disk alone when the build produced no per-device
 * estimate, so the line never claims a download figure it doesn't have.
 */
export function sizeSummary(report: SizeReport): string {
  if (report.entries.length === 0) return `on disk ${mb(report.artifactBytes)} (no per-device estimate)`;
  return `download ${mb(worstDownloadBytes(report))} · on disk ${mb(report.artifactBytes)}`;
}

/**
 * Print the per-device size readout for a freshly built artifact (iOS thinning / Android bundletool),
 * or a single on-disk line when there's no per-device report. Display only — the budget decision lives
 * in {@link confirmUpload}, so this runs on every build, including `--no-submit`. `sizeTopic` selects
 * the matching `--explain` block.
 */
export function reportSize(report: SizeReport, log: Logger, sizeTopic: GlossaryTopic = "app-thinning"): void {
  if (report.entries.length === 0) {
    log.step("size", `${mb(report.artifactBytes)} on disk (no per-device report)`, sizeTopic);
    return;
  }
  for (const entry of report.entries) {
    const installSuffix = entry.installBytes > 0 ? ` · install ${mb(entry.installBytes)}` : "";
    log.step("size", `${entry.device}: download ${mb(entry.downloadBytes)}${installSuffix}`, sizeTopic);
  }
}

/** Inputs for the pre-upload checkpoint {@link confirmUpload}. */
export interface ConfirmUploadOptions {
  report: SizeReport;
  /** Soft size budget in MB; an over-budget worst-case download leads the prompt with a warning. */
  budgetMB: number;
  /** Human destination, e.g. `"TestFlight"`, `"App Store review"`, or `"Google Play (internal track)"`. */
  destination: string;
  app: AppDescriptor;
  /** App version string, e.g. `1.0.0`. */
  version: string;
  /** Build number (iOS) or versionCode (Android) about to be uploaded. */
  buildNumber: number;
  /** `--yes`: skip the prompt and proceed (also implied in CI / non-TTY). */
  yes: boolean;
  log: Logger;
}

/**
 * The single pre-upload checkpoint, at the real upload boundary. It always surfaces what's about to
 * ship — app, build number, and the both-numbers size — and, when the worst-case download exceeds the
 * budget, leads with a warning (this is where the old size gate now lives). In an interactive terminal
 * it asks to continue; in CI / a pipe / under `--yes` it never blocks on stdin — it proceeds, but
 * still logs the over-budget warning so the record shows it.
 */
export async function confirmUpload(options: ConfirmUploadOptions): Promise<void> {
  const { report, budgetMB, destination, app, version, buildNumber, yes, log } = options;
  const overBudget = worstDownloadBytes(report) > budgetMB * 1024 * 1024;

  log.notice(`▲ Upload to ${destination}`, `${app.name} ${version} (build ${buildNumber}) · ${sizeSummary(report)}`);
  if (overBudget) {
    log.warn(`Worst-case download ${mb(worstDownloadBytes(report))} is over the ${budgetMB} MB budget.`);
  }

  if (yes || !isInteractive()) {
    if (overBudget) log.info("Proceeding anyway (non-interactive or --yes).");
    return;
  }
  const proceed = await confirm({ message: "Continue?" });
  if (isCancel(proceed) || !proceed) {
    cancel(overBudget ? "Stopped before upload (over size budget)." : "Stopped before upload.");
    process.exit(0);
  }
}

/** The receipt's destination line: where the build actually went (or that it wasn't uploaded). */
export function receiptDestination(platform: Platform, options: BuildRunOptions, track?: PlayTrack): string {
  if (!options.submit) return "built · not uploaded";
  if (platform === "android") return `Play · ${track ?? "internal"} track`;
  return options.target === "testing" ? "TestFlight" : "App Store · in review";
}

/**
 * Best-effort deep link to the uploaded build in App Store Connect: a real per-app TestFlight/overview
 * URL when the app id resolves, else the console home. Never throws — a link is a nicety, not a gate.
 */
export async function resolveAscBuildLink(
  ascKey: AppleCredentials["ascKey"],
  bundleId: string,
  target: SubmitTarget,
): Promise<string> {
  const appId = await new AppStoreConnectClient(ascKey).getAppId(bundleId).catch(() => null);
  if (!appId) return "https://appstoreconnect.apple.com";
  return target === "testing"
    ? `https://appstoreconnect.apple.com/apps/${appId}/testflight/ios`
    : `https://appstoreconnect.apple.com/apps/${appId}`;
}

/** Inputs for the end-of-run {@link renderReceipt} summary. */
interface ReceiptOptions {
  app: AppDescriptor;
  version: string;
  buildNumber: number;
  report: SizeReport;
  /** Where it landed, from {@link receiptDestination}. */
  destination: string;
  /** Best-effort console deep link; omitted in dry-run / `--no-submit` / when unresolved. */
  link?: string | undefined;
  log: Logger;
}

/**
 * The end-of-run "Shipped" receipt: one scannable summary of what landed where — app/version/build,
 * the both-numbers size, the destination, and a console link. Rendered as a box on a TTY, plain lines
 * in CI (see {@link Logger.box}).
 */
export function renderReceipt(options: ReceiptOptions): void {
  const { app, version, buildNumber, report, destination, link, log } = options;
  const rows = [`${app.name} ${version} (${buildNumber})`, sizeSummary(report), destination];
  if (link) rows.push(link);
  log.box("Shipped", rows);
}
