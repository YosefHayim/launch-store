/**
 * `launch release <platform>` — the deliberate, separate path to a store's PUBLIC production track.
 *
 * Keeping public release out of `launch build` is what makes an accidental public release impossible.
 *
 * - **Android** promotes the latest stored `.aab` to the Play production track via the submitter
 *   (fastlane `supply`), exactly as before.
 * - **iOS** runs the native App Store release state machine (`core/appStoreRelease.ts`): it either
 *   uploads the latest local build to TestFlight or promotes an already-verified one, then creates/reuses
 *   the App Store version, answers export compliance, attaches the build, writes the per-version release
 *   notes, picks an immediate or phased rollout, and submits for review — no trip through the website.
 *   Re-running is the resume / post-rejection hotfix loop. App-record creation stays manual (Apple has no
 *   API for it), so a missing record deep-links the developer to create it once.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type {
  AndroidReleaseOptions,
  BuildArtifact,
  BuildCredentials,
  Platform,
  ReleaseType,
  ResolvedBuildContext,
} from "../../core/types.js";
import { loadConfig, readResolvedConfig } from "../../core/config.js";
import {
  interactiveConfirm,
  resolveCommandEnv,
  resolveIosAccount,
  resolveSubmitterName,
  selectApp,
  worstDownloadBytes,
} from "../../core/pipeline.js";
import { loadAscKeyById } from "../../core/accounts.js";
import { formatEnvTable } from "../../core/env.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { isInteractive, withSpinner } from "../../core/progress.js";
import { pickOne } from "../../core/prompt.js";
import { notifyCompletion, type NotifyEvent } from "../../core/notify.js";
import { getCredentialsProvider, getStorageProvider, getSubmitter } from "../../core/registry.js";
import { AppStoreConnectClient, type BuildResource } from "../../apple/ascClient.js";
import { runAppStoreRelease, type ReleaseReport, type WhatsNewEntry } from "../../core/appStoreRelease.js";
import { resolveExportCompliance } from "../../core/exportCompliance.js";
import { loadStoreConfig } from "../../core/storeConfig.js";
import { addEnvFlags, envOverrides, type EnvFlags } from "../options.js";

interface ReleaseCommandOptions extends EnvFlags {
  app?: string;
  profile: string;
  explain: boolean;
  /** iOS: Apple account selector (label or Key ID); falls back to the active account. */
  account?: string;
  /** iOS: promote an already-uploaded build instead of uploading — a build number or `latest`. */
  build?: string;
  /** iOS: force uploading the latest local build (skip the promote picker). */
  upload?: boolean;
  /** iOS: upload then exit without waiting for processing (resume later with `--build <n>`). */
  wait: boolean;
  /** iOS: hold the approved build until you release it manually. */
  manual?: boolean;
  /** iOS: schedule the go-live for an ISO-8601 instant. */
  scheduled?: string;
  /** iOS: roll out gradually over 7 days (Apple phased release). */
  phased?: boolean;
  /** iOS: override the release version string (defaults to the build's marketing version). */
  appVersion?: string;
  /** Android-only: staged-rollout fraction for the production release (`--rollout`). */
  rollout?: string;
}

/** The store's public-release destination, phrased per platform for the confirmation prompt. */
const PUBLIC_DESTINATION: Record<Platform, string> = {
  ios: "the PUBLIC App Store review queue",
  android: "the PUBLIC Play production track",
};

/** How long to wait for a freshly-uploaded build to finish processing before suggesting a resume. */
const PROCESSING_POLL_ATTEMPTS = 30;
const PROCESSING_POLL_INTERVAL_MS = 30_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
    .option("--account <id>", "iOS only — Apple account label or Key ID (default: the active account)")
    .option("--build <n|latest>", "iOS only — promote an already-uploaded build instead of uploading")
    .option("--upload", "iOS only — upload the latest local build (skip the promote picker)")
    .option("--no-wait", "iOS only — upload then exit without waiting for processing (resume with --build)")
    .option("--manual", "iOS only — hold the approved build for manual release")
    .option("--scheduled <iso>", "iOS only — schedule the go-live for an ISO-8601 instant")
    .option("--phased", "iOS only — roll out gradually over 7 days")
    .option("--app-version <v>", "iOS only — override the release version string")
    .option("--rollout <fraction>", "Android only — staged-rollout fraction (default: 1.0)")
    .option("--explain", "expand each step", false);
  addEnvFlags(command).action(async (platform: string, options: ReleaseCommandOptions) => {
    if (platform !== "ios" && platform !== "android") {
      throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
    }
    if (platform === "ios") await runIosRelease(options);
    else await runAndroidRelease(options);
  });
}

/** Resolve the release type + scheduled date from the flags and config, defaulting to `AFTER_APPROVAL`. */
export function resolveReleaseType(
  flags: { manual?: boolean; scheduled?: string },
  configured: ReleaseType | undefined,
): { releaseType: ReleaseType; earliestReleaseDate?: string } {
  if (flags.manual && flags.scheduled) {
    throw new Error("Pass only one of --manual or --scheduled.");
  }
  if (flags.manual) return { releaseType: "MANUAL" };
  if (flags.scheduled) {
    if (Number.isNaN(Date.parse(flags.scheduled))) {
      throw new Error(`--scheduled must be an ISO-8601 instant (e.g. 2026-07-01T12:00:00Z), got "${flags.scheduled}".`);
    }
    return { releaseType: "SCHEDULED", earliestReleaseDate: flags.scheduled };
  }
  return { releaseType: configured ?? "AFTER_APPROVAL" };
}

/** Read per-locale release notes from the app's `store.config.json`, or [] when there are none. */
export function readWhatsNew(appDir: string): WhatsNewEntry[] {
  const path = join(appDir, "store.config.json");
  if (!existsSync(path)) return [];
  const info = loadStoreConfig(path).apple?.info ?? {};
  return Object.entries(info).flatMap(([locale, localeInfo]) =>
    localeInfo.releaseNotes ? [{ locale, text: localeInfo.releaseNotes }] : [],
  );
}

/** The native iOS App Store release: resolve a build, then drive the version → review state machine. */
async function runIosRelease(options: ReleaseCommandOptions): Promise<void> {
  const log = createLogger(options.explain);
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const profile = config.profiles[options.profile] ?? { name: options.profile };
  const bundleId = app.bundleId;
  if (!bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);

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

  const account = await resolveIosAccount(options, log);
  const ascKey = await loadAscKeyById(account.keyId);
  if (!ascKey)
    throw new Error(`No App Store Connect key stored for account ${account.label}. Run \`launch creds set-key\`.`);
  const client = new AppStoreConnectClient(ascKey);

  const appId = await withSpinner("Resolving the app on App Store Connect", () => client.getAppId(bundleId));
  if (!appId) throw appRecordMissingError(app.name, bundleId);

  // Resolve the build to release: upload a fresh one, or promote an already-verified TestFlight build.
  const source = await resolveBuildSource(client, bundleId, options, log);
  const ctx: ResolvedBuildContext = {
    platform: "ios",
    app,
    profile,
    env: resolvedEnv.values,
    explain: options.explain,
    dryRun: false,
    forceClean: false,
    account: account.keyId,
  };

  let buildId: string;
  let buildNumber: number;
  let versionString: string;
  let sizeBytes = 0;

  if (source.kind === "promote") {
    buildId = source.build.id;
    buildNumber = Number.parseInt(source.build.buildNumber, 10);
    const marketingVersion = await client.getBuildMarketingVersion(buildId);
    if (!marketingVersion) {
      throw new Error(`Could not read the marketing version of build ${source.build.buildNumber}. Re-upload it.`);
    }
    if (options.appVersion && options.appVersion !== marketingVersion) {
      log.warn(
        `Ignoring --app-version ${options.appVersion}: promoted build ${source.build.buildNumber} is ${marketingVersion}.`,
      );
    }
    versionString = marketingVersion;
    log.step("build", `promoting build ${source.build.buildNumber} (${marketingVersion}) · already verified`);
  } else {
    const uploaded = await uploadLatestBuild({ client, config, app, ctx, ascKey, bundleId, options, log });
    if (!uploaded) return; // --no-wait: uploaded and exited with resume instructions
    buildId = uploaded.buildId;
    buildNumber = uploaded.buildNumber;
    versionString = options.appVersion ?? uploaded.version;
    sizeBytes = uploaded.sizeBytes;
  }

  const { releaseType, earliestReleaseDate } = resolveReleaseType(options, config.release?.releaseType);
  const phased = options.phased ?? config.release?.phasedRelease ?? false;
  const whatsNew = readWhatsNew(app.dir);
  const compliance = await resolveExportCompliance({
    bundleId,
    appConfig: await readResolvedConfig(app.dir),
    interactive: isInteractive(),
    prompt: () =>
      interactiveConfirm("Does this app use non-exempt encryption (anything beyond standard HTTPS / OS crypto)?"),
  });
  log.step("export compliance", `usesNonExemptEncryption=${compliance.usesNonExemptEncryption} (${compliance.source})`);

  const scheduleNote = earliestReleaseDate ? ` · scheduled ${earliestReleaseDate}` : "";
  const rolloutNote = phased ? " · phased" : "";
  const proceed = await confirm({
    message:
      `Submit ${app.name} ${versionString} (build ${buildNumber}) to ${PUBLIC_DESTINATION.ios}` +
      ` — ${releaseType.toLowerCase()}${scheduleNote}${rolloutNote}?`,
  });
  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — nothing submitted.");
    process.exit(0);
  }

  const event: NotifyEvent = {
    event: "submit",
    status: "success",
    app: app.name,
    platform: "ios",
    version: versionString,
    buildNumber,
    destination: "App Store review",
  };
  if (sizeBytes > 0) event.sizeBytes = sizeBytes;

  let report: ReleaseReport;
  try {
    report = await withSpinner("Submitting to App Store review", () =>
      runAppStoreRelease(client, {
        appId,
        versionString,
        buildId,
        usesNonExemptEncryption: compliance.usesNonExemptEncryption,
        releaseType,
        ...(earliestReleaseDate ? { earliestReleaseDate } : {}),
        phased,
        whatsNew,
        dryRun: false,
      }),
    );
  } catch (error) {
    await notifyCompletion(config, {
      ...event,
      status: "failure",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const failures = renderReleaseReport(report, appId, log);
  if (failures > 0) {
    process.exitCode = 1;
    await notifyCompletion(config, { ...event, status: "failure", error: `${failures} release step(s) failed` });
    return;
  }
  await notifyCompletion(config, event);
}

/** What an upload resolved to once the build is processed and ready to attach. */
interface UploadedBuild {
  buildId: string;
  buildNumber: number;
  version: string;
  sizeBytes: number;
}

/**
 * Upload the latest stored artifact to TestFlight, then wait for Apple to finish processing it so it can
 * be attached to a version. Returns null under `--no-wait` (uploaded, then prints resume instructions).
 */
async function uploadLatestBuild(args: {
  client: AppStoreConnectClient;
  config: Awaited<ReturnType<typeof loadConfig>>["config"];
  app: Awaited<ReturnType<typeof loadConfig>>["apps"][number];
  ctx: ResolvedBuildContext;
  ascKey: NonNullable<Awaited<ReturnType<typeof loadAscKeyById>>>;
  bundleId: string;
  options: ReleaseCommandOptions;
  log: Logger;
}): Promise<UploadedBuild | null> {
  const { client, config, app, ctx, ascKey, bundleId, options, log } = args;
  const latest = (await getStorageProvider(config.storage).list()).find(
    (artifact) => artifact.appName === app.name && artifact.platform === "ios",
  );
  if (!latest) {
    throw new Error(
      `No stored iOS build for ${app.name}. Run \`launch build ios\` first, or promote one with --build.`,
    );
  }

  if (shouldNudgeRelease(latest)) {
    const proceedIncremental = await confirm({
      message: `This build was incremental, not clean — upload anyway? Run \`launch build ios --clean\` first for a from-scratch artifact.`,
    });
    if (isCancel(proceedIncremental) || !proceedIncremental) {
      cancel("Cancelled — nothing uploaded.");
      process.exit(0);
    }
  }

  const credentials: BuildCredentials = { platform: "ios", ascKey };
  await getSubmitter(resolveSubmitterName(config, "ios")).submit(latest.path, "testing", credentials, ctx);
  log.step("upload", `build ${latest.buildNumber} (${latest.version}) sent to TestFlight`);

  if (!options.wait) {
    log.info(
      `Processing on Apple's side. Re-run \`launch release ios --build ${latest.buildNumber}\` once it's verified.`,
    );
    return null;
  }

  const buildId = await waitForBuildProcessed(client, bundleId, latest.buildNumber, log);
  if (!buildId) {
    log.info(
      `Build ${latest.buildNumber} is still processing. Re-run \`launch release ios --build ${latest.buildNumber}\` when it's verified.`,
    );
    return null;
  }
  return {
    buildId,
    buildNumber: latest.buildNumber,
    version: latest.version,
    sizeBytes: worstDownloadBytes(latest.sizeReport),
  };
}

/**
 * Poll until an uploaded build reaches `VALID`, returning its resource id — or null if it's still
 * processing when the budget runs out (the caller then prints resume instructions). Safe to Ctrl-C.
 */
async function waitForBuildProcessed(
  client: AppStoreConnectClient,
  bundleId: string,
  buildNumber: number,
  log: Logger,
): Promise<string | null> {
  return withSpinner("Waiting for App Store Connect to verify the build (safe to Ctrl-C)", async () => {
    for (let attempt = 0; attempt < PROCESSING_POLL_ATTEMPTS; attempt++) {
      const build = (await client.listBuilds(bundleId).catch(() => [])).find(
        (candidate) => candidate.buildNumber === String(buildNumber),
      );
      if (build?.processingState === "VALID") return build.id;
      if (build?.processingState === "INVALID") {
        log.warn(`Build ${buildNumber} failed Apple's processing (INVALID). Check App Store Connect for the reason.`);
        return null;
      }
      await delay(PROCESSING_POLL_INTERVAL_MS);
    }
    return null;
  });
}

/** A resolved build source: upload the latest local build, or promote an already-uploaded one. */
type BuildSource = { kind: "upload" } | { kind: "promote"; build: BuildResource };

/**
 * Choose the build to release. `--upload` forces a fresh upload; `--build <n|latest>` promotes a
 * specific verified build; otherwise an interactive picker offers upload-vs-promote (cursor on the
 * newest verified build), and CI defaults to uploading the latest local build.
 */
async function resolveBuildSource(
  client: AppStoreConnectClient,
  bundleId: string,
  options: ReleaseCommandOptions,
  log: Logger,
): Promise<BuildSource> {
  if (options.upload) return { kind: "upload" };

  const builds = (await withSpinner("Reading uploaded builds", () => client.listBuilds(bundleId))).filter(
    (build) => build.processingState === "VALID" && !build.expired,
  );

  if (options.build) {
    if (options.build === "latest") {
      const newest = builds[0];
      if (!newest) throw new Error("No verified TestFlight build to promote. Upload one (omit --build).");
      return { kind: "promote", build: newest };
    }
    const match = builds.find((build) => build.buildNumber === options.build);
    if (!match) {
      const available = builds.map((build) => build.buildNumber).join(", ") || "none";
      throw new Error(`No verified build ${options.build} to promote. Verified builds: ${available}.`);
    }
    return { kind: "promote", build: match };
  }

  if (builds.length === 0) {
    if (isInteractive()) log.info("No verified TestFlight builds yet — will upload the latest local build.");
    return { kind: "upload" };
  }

  const promoteOptions = builds.map((build) => ({
    value: { kind: "promote", build } satisfies BuildSource,
    label: `Promote build ${build.buildNumber}`,
    hint: build.uploadedDate ? `verified · uploaded ${build.uploadedDate.slice(0, 10)}` : "verified",
  }));
  return pickOne<BuildSource>({
    message: "Release which build?",
    options: [
      { value: { kind: "upload" }, label: "Upload the latest local build", hint: "send a fresh .ipa to TestFlight" },
      ...promoteOptions,
    ],
    canPrompt: isInteractive(),
    // Highlight the newest verified build, but CI (no TTY) defaults to uploading the latest local build.
    ...(promoteOptions[0] ? { initialValue: promoteOptions[0].value } : {}),
    nonInteractive: {
      kind: "fallback",
      value: { kind: "upload" },
      note: "Non-interactive: uploading the latest local build (pass --build <n> to promote a verified one).",
    },
  });
}

/** The actionable error when an app has no App Store Connect record yet (Apple has no API to create one). */
function appRecordMissingError(appName: string, bundleId: string): Error {
  return new Error(
    `No App Store Connect record for ${bundleId}. Apple's API can't create app records — only the website can.\n` +
      `  1. Open https://appstoreconnect.apple.com/apps and click "+" → New App\n` +
      `  2. Platform: iOS · Name: ${appName} · Bundle ID: ${bundleId} · SKU: ${bundleId}\n` +
      `  3. Re-run \`launch release ios\`.`,
  );
}

/** Print the release report (each step + a deep link) and return the number of failed steps. */
function renderReleaseReport(report: ReleaseReport, appId: string, log: Logger): number {
  log.gap();
  let failures = 0;
  for (const action of report.actions) {
    if (action.status === "failed") {
      failures++;
      log.error(`${action.description} — ${action.error ?? "failed"}`);
    } else if (action.status === "skipped") {
      log.info(`skipped: ${action.description}${action.note ? ` (${action.note})` : ""}`);
    } else {
      log.step(action.description);
    }
  }

  const link = `https://appstoreconnect.apple.com/apps/${appId}/appstore`;
  if (report.alreadyInFlight) {
    log.box("Already in review", [`${report.versionString} is already submitted.`, link]);
  } else if (failures === 0) {
    log.box("Submitted for review", [
      `${report.versionString} → App Store review${report.reused ? " (resumed)" : ""}`,
      link,
    ]);
  } else {
    log.box("Submitted with errors", [`${failures} step(s) failed — see above.`, link]);
  }
  return failures;
}

/** Submit the latest stored artifact for `app` to the Play production track (unchanged Android path). */
async function runAndroidRelease(options: ReleaseCommandOptions): Promise<void> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.app);
  const profile = config.profiles[options.profile] ?? { name: options.profile };

  // Release resolves env (for the submit/fastlane subprocess) but never gates on it — it promotes a
  // prebuilt artifact, so the app's env was already baked at build time. See `validateResolvedEnv`.
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

  const latest = (await getStorageProvider(config.storage).list()).find(
    (artifact) => artifact.appName === app.name && artifact.platform === "android",
  );
  if (!latest) {
    throw new Error(`No stored android build for ${app.name}. Run \`launch build android\` first.`);
  }

  const proceed = await confirm({
    message: `Submit ${app.name} ${latest.version} (${latest.buildNumber}) to ${PUBLIC_DESTINATION.android}?`,
  });
  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — nothing submitted.");
    process.exit(0);
  }

  // Reproducibility guard: release never rebuilds, so warn before promoting an incrementally-built artifact.
  if (shouldNudgeRelease(latest)) {
    const proceedIncremental = await confirm({
      message: `This build was incremental, not clean — promote anyway? Run \`launch build android --clean\` first for a from-scratch artifact.`,
    });
    if (isCancel(proceedIncremental) || !proceedIncremental) {
      cancel("Cancelled — nothing submitted.");
      process.exit(0);
    }
  }

  // Production releases roll out fully unless an Android `--rollout` (or the profile) narrows it.
  const rollout = options.rollout !== undefined ? Number.parseFloat(options.rollout) : (profile.rollout ?? 1.0);
  const android: AndroidReleaseOptions = { track: "production", rollout };
  const ctx: ResolvedBuildContext = {
    platform: "android",
    app,
    profile,
    env: resolvedEnv.values,
    explain: options.explain,
    dryRun: false,
    // Release never compiles — it promotes a stored artifact — so the clean/incremental decision is moot.
    forceClean: false,
    android,
  };
  const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
  const destination = "the Play production track";
  const event: NotifyEvent = {
    event: "submit",
    status: "success",
    app: app.name,
    platform: "android",
    version: latest.version,
    buildNumber: latest.buildNumber,
    destination,
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
  console.log(`Submitted ${app.name} ${latest.version} (${latest.buildNumber}) to ${destination}.`);
  await notifyCompletion(config, event);
}
