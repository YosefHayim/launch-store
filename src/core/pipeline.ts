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
import { existsSync, readdirSync } from "node:fs";
import { cancel, confirm, isCancel, select } from "@clack/prompts";
import type {
  AppDescriptor,
  AppleCredentials,
  BuildArtifact,
  LaunchConfig,
  Platform,
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
import { run } from "./exec.js";
import { AppStoreConnectClient } from "../apple/ascClient.js";
import { ensureSigningCredentials } from "../apple/credentials.js";

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
  /** Where a submission lands. */
  target: SubmitTarget;
  /** Rehearse the flow with no real changes (`--dry-run`). */
  dryRun: boolean;
  /** Build on a remote Mac (AWS EC2 Mac / a Mac over SSH) instead of locally. */
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
 * Resolve the shared front half of a build: config, the chosen app, the profile, a validated env, a
 * logger, and the {@link ResolvedBuildContext}. Refuses Android (v1 is iOS) before any work. Every
 * build path — local, remote, EAS — starts here so app selection and `.env` validation never drift.
 */
export async function prepareBuild(options: BuildRunOptions): Promise<PreparedBuild> {
  const { dryRun } = options;
  const log = createLogger(options.explain);

  if (options.platform === "android") {
    throw new Error("Android isn't in v1 yet — iOS first. It's the next milestone.");
  }

  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.appName);
  const profile = config.profiles[options.profileName] ?? { name: options.profileName, sizeBudgetMB: 200 };
  const remoteSuffix = options.remote ? (options.remote.kind === "aws" ? " · remote(aws)" : " · remote(ssh)") : "";
  log.step("config", `${app.name} · ${profile.name} · ios${dryRun ? " · dry-run" : ""}${remoteSuffix}`);

  // Validate env against .env.example before doing any expensive work.
  const env = loadDotenvFile(join(app.dir, profile.envFile ?? ".env"));
  const missing = missingKeys(app.dir, env);
  if (missing.length > 0)
    throw new Error(`Missing env keys (in .env.example, absent from .env): ${missing.join(", ")}`);
  for (const name of secretLookingKeys(env)) {
    log.warn(`"${name}" looks like a backend secret — it would be bundled into the app. Keep secrets out of .env.`);
  }
  log.step("env", `${Object.keys(env).length} vars validated`, "env-vars");

  const ctx: ResolvedBuildContext = { platform: "ios", app, profile, env, explain: options.explain, dryRun };
  return { config, app, profile, env, ctx, log };
}

/**
 * Run a build. Dispatches to the right path: `--remote` → the remote-Mac pipeline, `buildEngine: "eas"`
 * → the EAS handoff, otherwise the local Mac spine. Throws with a clear message on any failed step.
 */
export async function runBuild(options: BuildRunOptions): Promise<void> {
  const prepared = await prepareBuild(options);
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

/** The local Mac spine: prebuild → resolve creds/signing → build number → gym → size → store → submit. */
async function runLocalBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, profile, ctx, log } = prepared;
  const { dryRun } = options;

  // 2. Generate the native project only when it's missing (bare/committed ios/ is used as-is).
  await ensureNativeProject(ctx, log);

  // 3. Resolve the API key, then reuse-or-provision the distribution cert + profile.
  const credentials = dryRun ? { ascKey: DRY_RUN_KEY } : await getCredentialsProvider(config.credentials).resolve(ctx);
  log.step("credentials", dryRun ? "dry-run (no key needed)" : `key ${credentials.ascKey.keyId}`, "asc-api-key");
  const signing = await resolveSigning(credentials, app, log, dryRun);
  const signedCredentials: AppleCredentials = { ascKey: credentials.ascKey, signing };

  // 4. Auto-bump the build number from the last one Apple has on record.
  const bundleId = app.bundleId ?? "";
  const buildNumber = await nextBuildNumber(credentials.ascKey, bundleId, dryRun);
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
  const { artifactPath, sizeReport } = await getBuildEngine(config.buildEngine).build(ctx, signedCredentials);
  log.step("build", dryRun ? "skipped (dry-run)" : artifactPath);

  // 6. Show size and soft-gate against the profile budget.
  await reportSizeAndGate(sizeReport, profile.sizeBudgetMB ?? 200, log);

  // 7. Store the artifact.
  if (dryRun) {
    log.step("store", "skipped (dry-run)");
  } else {
    const artifact: BuildArtifact = {
      path: artifactPath,
      platform: "ios",
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

  // 8. Submit (TestFlight by default), then report processing status.
  if (options.submit) {
    if (dryRun) {
      log.step(
        "submit",
        `would upload to ${options.target === "testflight" ? "TestFlight" : "App Store review"}`,
        "testflight",
      );
    } else {
      await getSubmitter(config.submit).submit(artifactPath, options.target, signedCredentials, ctx);
      log.step(
        "submit",
        options.target === "testflight" ? "uploaded to TestFlight" : "submitted for App Store review",
        "testflight",
      );
      if (options.target === "testflight" && bundleId) {
        await reportProcessing(credentials.ascKey, bundleId, buildNumber, log);
      }
    }
  }

  log.gap();
  log.info(
    `Done. ${app.name} ${app.version ?? "0.0.0"} (${buildNumber})${dryRun ? " · dry-run, nothing changed" : ` · ${mb(sizeReport.ipaBytes)} on disk`}`,
  );
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

/** Print per-device sizes from the report and, if any exceeds the budget, ask before continuing. */
export async function reportSizeAndGate(report: SizeReport, budgetMB: number, log: Logger): Promise<void> {
  const budgetBytes = budgetMB * 1024 * 1024;
  if (report.entries.length === 0) {
    log.step("size", `${mb(report.ipaBytes)} on disk (no per-device report)`, "app-thinning");
    return;
  }
  const worst = report.entries.reduce((max, entry) => (entry.downloadBytes > max.downloadBytes ? entry : max));
  for (const entry of report.entries) {
    log.step(
      "size",
      `${entry.device}: download ${mb(entry.downloadBytes)} · install ${mb(entry.installBytes)}`,
      "app-thinning",
    );
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
