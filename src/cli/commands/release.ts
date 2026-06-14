/**
 * `launch release <platform>` — the deliberate, separate path to the PUBLIC store.
 *
 * For **iOS** it drives the App Store Connect API (`core/appStoreRelease.ts`): pick a build (upload the
 * latest local one, or promote a processed TestFlight build), wait for processing, then create/reuse the
 * App Store version, attach the build, declare export compliance, write release notes, set the release
 * type / phased rollout, and submit for review — all without a portal trip. fastlane is used only to
 * upload the binary. For **Android** it promotes the latest stored artifact to the Play production track
 * via the Google Play submitter (unchanged). Keeping release out of `launch build` is what makes an
 * accidental public release impossible.
 */

import type { Command } from "commander";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type {
  AndroidReleaseOptions,
  AppDescriptor,
  BuildArtifact,
  BuildProfile,
  LaunchConfig,
  Platform,
  ReleaseConfig,
  ReleaseType,
  ResolvedBuildContext,
} from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { mb, resolveCommandEnv, resolveSubmitterName, selectApp, worstDownloadBytes } from "../../core/pipeline.js";
import { formatEnvTable, type ResolvedEnv } from "../../core/env.js";
import { notifyCompletion, type NotifyEvent } from "../../core/notify.js";
import { getCredentialsProvider, getStorageProvider, getSubmitter } from "../../core/registry.js";
import { createLogger } from "../../core/logger.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { AppStoreConnectClient, type BuildResource } from "../../apple/ascClient.js";
import {
  appRecordMissingMessage,
  IOS_PLATFORM,
  releaseApp,
  waitForValidBuild,
  type ReleaseInput,
  type ReleaseReport,
} from "../../core/appStoreRelease.js";
import { addEnvFlags, envOverrides, type EnvFlags } from "../options.js";

interface ReleaseCommandOptions extends EnvFlags {
  app?: string;
  profile: string;
  explain: boolean;
  /** Android-only: staged-rollout fraction for the production release (`--rollout`). */
  rollout?: string;
  /** iOS-only: promote an existing build number, or `"latest"`, instead of uploading the local artifact. */
  build?: string;
  /** iOS-only: `--no-wait` sets this false — upload the binary and return without waiting/submitting. */
  wait: boolean;
  /** iOS-only: hold the approved build for manual release. */
  manual?: boolean;
  /** iOS-only: schedule go-live at an ISO-8601 instant. */
  scheduled?: string;
  /** iOS-only: opt into Apple's 7-day phased rollout. */
  phased?: boolean;
  /** iOS-only: show the one-time App Store Connect setup checklist and exit. */
  createApp?: boolean;
}

/**
 * Whether to ask a second confirmation before promoting this artifact: true when it was built
 * incrementally (not clean). Release reuses the stored artifact rather than rebuilding, so an
 * incremental build's reproducibility is worth a deliberate extra nod before it reaches the public store.
 */
export function shouldNudgeRelease(artifact: Pick<BuildArtifact, "clean">): boolean {
  return !artifact.clean;
}

/** Attach the `release` command to the program. */
export function registerReleaseCommand(program: Command): void {
  const command = program
    .command("release")
    .description("submit the latest build to the store's PUBLIC production track (with confirmation)")
    .argument("<platform>", "ios or android")
    .option("-a, --app <name>", "app handle")
    .option("-p, --profile <name>", "build profile", "production")
    .option("--rollout <fraction>", "Android only — staged-rollout fraction (default: 1.0)")
    .option("--build <n>", 'iOS only — promote an existing build number, or "latest", instead of uploading')
    .option("--no-wait", "iOS only — after uploading, return without waiting for processing/submit")
    .option("--manual", "iOS only — hold the approved build for manual release", false)
    .option("--scheduled <iso>", "iOS only — schedule the go-live at an ISO-8601 instant")
    .option("--phased", "iOS only — opt into Apple's 7-day phased rollout", false)
    .option("--create-app", "iOS only — show the one-time App Store Connect setup checklist and exit", false)
    .option("--explain", "expand each step", false);
  addEnvFlags(command).action(async (platform: string, options: ReleaseCommandOptions) => {
    if (platform !== "ios" && platform !== "android") {
      throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
    }
    await runRelease(platform, options);
  });
}

/** Load config + app + env, then dispatch to the platform's release path. */
async function runRelease(platform: Platform, options: ReleaseCommandOptions): Promise<void> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const profile = config.profiles[options.profile] ?? { name: options.profile };

  // Release resolves env (for the submit/fastlane subprocess) but never gates on it — it promotes a
  // prebuilt artifact, so the app's env was already baked at build time.
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

  if (platform === "ios") await runIosRelease(app, profile, options, config, resolvedEnv);
  else await runAndroidRelease(app, profile, options, config, resolvedEnv);
}

/** Resolve the per-run release type, with `--scheduled`/`--manual` overriding the config default. */
function resolveReleaseType(
  release: ReleaseConfig | undefined,
  options: ReleaseCommandOptions,
): { releaseType: ReleaseType; earliestReleaseDate?: string } {
  if (options.scheduled) return { releaseType: "SCHEDULED", earliestReleaseDate: options.scheduled };
  if (options.manual) return { releaseType: "MANUAL" };
  return {
    releaseType: release?.releaseType ?? "AFTER_APPROVAL",
    ...(release?.earliestReleaseDate ? { earliestReleaseDate: release.earliestReleaseDate } : {}),
  };
}

/** Normalize config release notes (a bare string targets the primary locale) into a per-locale map. */
function resolveReleaseNotes(release: ReleaseConfig | undefined, primaryLocale: string): Record<string, string> {
  const notes = release?.releaseNotes;
  if (!notes) return {};
  return typeof notes === "string" ? { [primaryLocale]: notes } : notes;
}

/** The newest build that's processed and not expired — i.e. attachable to an App Store version. */
function newestValidBuild(builds: BuildResource[]): BuildResource | null {
  return builds.find((build) => build.processingState === "VALID" && !build.expired) ?? null;
}

/** The marketing version to release: the app's own version, else the highest already on App Store Connect. */
async function resolveVersionString(
  client: AppStoreConnectClient,
  app: AppDescriptor,
  bundleId: string,
): Promise<string> {
  const version = app.version ?? (await client.getLatestMarketingVersion(bundleId));
  if (!version) {
    throw new Error(`Could not determine a marketing version for ${app.name}. Set "version" in app.json.`);
  }
  return version;
}

/** Prompt for a yes/no, treating a cancel as "no". */
async function askConfirm(message: string): Promise<boolean> {
  const proceed = await confirm({ message });
  return !isCancel(proceed) && proceed;
}

/** iOS public release — API-driven submit (see module header). */
async function runIosRelease(
  app: AppDescriptor,
  profile: BuildProfile,
  options: ReleaseCommandOptions,
  config: LaunchConfig,
  resolvedEnv: ResolvedEnv,
): Promise<void> {
  const log = createLogger(options.explain);
  const bundleId = app.bundleId;
  if (!bundleId) throw new Error(`${app.name} has no iOS bundle id (ios.bundleIdentifier in app.json).`);

  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  const client = new AppStoreConnectClient(ascKey);

  const appId = await client.getAppId(bundleId);
  if (options.createApp || !appId) {
    log.info(appRecordMissingMessage(bundleId));
    process.exitCode = 1;
    return;
  }

  const ctx: ResolvedBuildContext = {
    platform: "ios",
    app,
    profile,
    env: resolvedEnv.values,
    explain: options.explain,
    dryRun: false,
    forceClean: false,
  };

  const chosen = await resolveIosBuild(client, appId, app, bundleId, config, options, ctx, log);
  if (!chosen) return; // cancelled, or uploaded-and-returned under --no-wait
  const { build, versionString } = chosen;

  const { releaseType, earliestReleaseDate } = resolveReleaseType(config.release, options);
  const whatsNew = resolveReleaseNotes(config.release, config.release?.primaryLocale ?? "en-US");
  if (Object.keys(whatsNew).length === 0) {
    log.warn("No release notes configured (release.releaseNotes) — the version keeps any existing “What's New”.");
  }

  const input: ReleaseInput = {
    bundleId,
    platform: IOS_PLATFORM,
    versionString,
    releaseType,
    ...(earliestReleaseDate ? { earliestReleaseDate } : {}),
    phasedRelease: options.phased === true || config.release?.phasedRelease === true,
    usesNonExemptEncryption: config.release?.usesNonExemptEncryption ?? false,
    whatsNew,
    build,
  };

  const buildNumber = Number.parseInt(build.version, 10);
  const event: NotifyEvent = {
    event: "submit",
    status: "success",
    app: app.name,
    platform: "ios",
    version: versionString,
    destination: "App Store review",
    ...(Number.isNaN(buildNumber) ? {} : { buildNumber }),
  };

  let report: ReleaseReport;
  try {
    report = await releaseApp(client, input);
  } catch (error) {
    await notifyCompletion(config, {
      ...event,
      status: "failure",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (report.alreadyInReview) {
    log.info(`${app.name} ${report.versionString} is already ${report.appStoreState} — nothing to submit.`);
  } else {
    log.box("Submitted for App Store review", [
      `${app.name} ${report.versionString} (build ${build.version})`,
      ...report.actions.map((action) => `• ${action.description}`),
    ]);
  }
  await notifyCompletion(config, event);
  log.info(`Track the review with \`launch status -a ${app.name} --watch\`.`);
}

/**
 * Resolve the build to submit: promote an explicit/`latest` processed build, or upload the latest local
 * artifact and wait for it to process. Returns null when the user cancels or when `--no-wait` uploaded
 * and returned without submitting.
 */
async function resolveIosBuild(
  client: AppStoreConnectClient,
  appId: string,
  app: AppDescriptor,
  bundleId: string,
  config: LaunchConfig,
  options: ReleaseCommandOptions,
  ctx: ResolvedBuildContext,
  log: ReturnType<typeof createLogger>,
): Promise<{ build: BuildResource; versionString: string } | null> {
  // Promote a specific build number, or the latest processed one.
  if (options.build !== undefined) {
    const build = await resolveBuildToPromote(client, appId, app.name, options.build);
    const versionString = await resolveVersionString(client, app, bundleId);
    if (!(await askConfirm(`Submit ${app.name} ${versionString} (build ${build.version}) for App Store review?`))) {
      cancel("Cancelled — nothing submitted.");
      return null;
    }
    return { build, versionString };
  }

  // Default: upload the latest local artifact; fall back to promoting a processed build if none is local.
  const artifact = (await getStorageProvider(config.storage).list()).find(
    (stored) => stored.appName === app.name && stored.platform === "ios",
  );
  if (!artifact) {
    const build = newestValidBuild(await client.listBuilds(appId));
    if (!build) {
      throw new Error(
        `No stored iOS build for ${app.name}, and no processed build on App Store Connect. Run \`launch build ios\` first.`,
      );
    }
    const versionString = await resolveVersionString(client, app, bundleId);
    if (!(await askConfirm(`No local build found — submit the latest processed build ${build.version} for review?`))) {
      cancel("Cancelled — nothing submitted.");
      return null;
    }
    return { build, versionString };
  }

  const size = worstDownloadBytes(artifact.sizeReport);
  log.notice(
    `Release ${app.name} ${artifact.version} (build ${artifact.buildNumber}) to the App Store`,
    ...(size > 0 ? [`download size ~${mb(size)} (size budget already checked at build)`] : []),
  );
  if (!(await askConfirm(`Upload and submit ${app.name} ${artifact.version} (${artifact.buildNumber}) for review?`))) {
    cancel("Cancelled — nothing submitted.");
    return null;
  }
  if (
    shouldNudgeRelease(artifact) &&
    !(await askConfirm(
      "This build was incremental, not clean — promote anyway? (`launch build ios --clean` for a fresh one)",
    ))
  ) {
    cancel("Cancelled — nothing submitted.");
    return null;
  }

  const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
  log.step("upload", `uploading build ${artifact.buildNumber} to App Store Connect`, "testflight");
  await getSubmitter(resolveSubmitterName(config, "ios")).submit(artifact.path, "production", credentials, ctx);

  if (!options.wait) {
    log.info(
      `Uploaded build ${artifact.buildNumber}; Apple is processing it. Once \`launch status -a ${app.name}\` shows it VALID, ` +
        `submit with \`launch release ios -a ${app.name} --build ${artifact.buildNumber}\`.`,
    );
    return null;
  }

  log.step("processing", "waiting for App Store Connect to finish processing the build");
  const build = await waitForValidBuild(client, appId, artifact.buildNumber, {
    onTick: (state) => {
      log.info(`build ${artifact.buildNumber}: ${state}`);
    },
  });
  return { build, versionString: artifact.version };
}

/** Resolve `--build <n|latest>` to a concrete processed build, erroring if it isn't found/processed. */
async function resolveBuildToPromote(
  client: AppStoreConnectClient,
  appId: string,
  appName: string,
  selector: string,
): Promise<BuildResource> {
  if (selector === "latest") {
    const build = newestValidBuild(await client.listBuilds(appId));
    if (!build) throw new Error(`No processed build on App Store Connect for ${appName}. Upload one first.`);
    return build;
  }
  const number = Number.parseInt(selector, 10);
  if (Number.isNaN(number)) throw new Error(`--build must be a build number or "latest" (got "${selector}").`);
  const build = await client.findBuildByVersion(appId, number);
  if (!build) throw new Error(`No build ${number} on App Store Connect for ${appName}.`);
  return build;
}

/** Android public release — promote the latest stored artifact to the Play production track (unchanged). */
async function runAndroidRelease(
  app: AppDescriptor,
  profile: BuildProfile,
  options: ReleaseCommandOptions,
  config: LaunchConfig,
  resolvedEnv: ResolvedEnv,
): Promise<void> {
  const latest = (await getStorageProvider(config.storage).list()).find(
    (artifact) => artifact.appName === app.name && artifact.platform === "android",
  );
  if (!latest) {
    throw new Error(`No stored android build for ${app.name}. Run \`launch build android\` first.`);
  }

  const proceed = await confirm({
    message: `Submit ${app.name} ${latest.version} (${latest.buildNumber}) to the PUBLIC Play production track?`,
  });
  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — nothing submitted.");
    return;
  }

  if (shouldNudgeRelease(latest)) {
    const proceedIncremental = await confirm({
      message: `This build was incremental, not clean — promote anyway? Run \`launch build android --clean\` first for a from-scratch artifact.`,
    });
    if (isCancel(proceedIncremental) || !proceedIncremental) {
      cancel("Cancelled — nothing submitted.");
      return;
    }
  }

  const rollout = options.rollout !== undefined ? Number.parseFloat(options.rollout) : (profile.rollout ?? 1.0);
  const android: AndroidReleaseOptions = { track: "production", rollout };
  const ctx: ResolvedBuildContext = {
    platform: "android",
    app,
    profile,
    env: resolvedEnv.values,
    explain: options.explain,
    dryRun: false,
    forceClean: false,
    android,
  };
  const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
  const event: NotifyEvent = {
    event: "submit",
    status: "success",
    app: app.name,
    platform: "android",
    version: latest.version,
    buildNumber: latest.buildNumber,
    destination: "the Play production track",
  };
  const size = worstDownloadBytes(latest.sizeReport);
  if (size > 0) event.sizeBytes = size;

  try {
    await getSubmitter(resolveSubmitterName(config, "android")).submit(latest.path, "production", credentials, ctx);
  } catch (error) {
    await notifyCompletion(config, {
      ...event,
      status: "failure",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  console.log(`Submitted ${app.name} ${latest.version} (${latest.buildNumber}) to the Play production track.`);
  await notifyCompletion(config, event);
}
