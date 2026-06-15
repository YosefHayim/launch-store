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

import { existsSync } from "node:fs";
import { join } from "node:path";
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
import {
  mb,
  resolveCommandEnv,
  resolveIosAccount,
  resolveSubmitterName,
  selectApp,
  worstDownloadBytes,
} from "../../core/pipeline.js";
import { formatEnvTable, type ResolvedEnv } from "../../core/env.js";
import { notifyCompletion, type NotifyEvent } from "../../core/notify.js";
import { getCredentialsProvider, getStorageProvider, getSubmitter } from "../../core/registry.js";
import { createLogger, type Logger } from "../../core/logger.js";
import { loadAscKeyById } from "../../core/accounts.js";
import { isInteractive } from "../../core/progress.js";
import { pickOne } from "../../core/prompt.js";
import { loadStoreConfig } from "../../core/storeConfig.js";
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
  /** iOS-only: Apple account selector (label or Key ID); falls back to `ASC_ACCOUNT`, then the active account. */
  account?: string;
  /** Android-only: staged-rollout fraction for the production release (`--rollout`). */
  rollout?: string;
  /** iOS-only: promote an existing build number, or `"latest"`, instead of uploading the local artifact. */
  build?: string;
  /** iOS-only: force uploading the latest local build (skip the upload-vs-promote picker). */
  upload?: boolean;
  /** iOS-only: `--no-wait` sets this false — upload the binary and return without waiting/submitting. */
  wait: boolean;
  /** iOS-only: hold the approved build for manual release. */
  manual?: boolean;
  /** iOS-only: schedule go-live at an ISO-8601 instant. */
  scheduled?: string;
  /** iOS-only: opt into Apple's 7-day phased rollout. */
  phased?: boolean;
  /** iOS-only: print the release plan (read-only — touches nothing on App Store Connect) and exit. */
  dryRun?: boolean;
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
    .option(
      "--account <id>",
      "iOS only — Apple account label or Key ID (default: ASC_ACCOUNT, then the active account)",
    )
    .option("--rollout <fraction>", "Android only — staged-rollout fraction (default: 1.0)")
    .option("--build <n>", 'iOS only — promote an existing build number, or "latest", instead of uploading')
    .option("--upload", "iOS only — upload the latest local build (skip the upload-vs-promote picker)", false)
    .option("--no-wait", "iOS only — after uploading, return without waiting for processing/submit")
    .option("--manual", "iOS only — hold the approved build for manual release", false)
    .option("--scheduled <iso>", "iOS only — schedule the go-live at an ISO-8601 instant")
    .option("--phased", "iOS only — opt into Apple's 7-day phased rollout", false)
    .option("--dry-run", "iOS only — print the release plan (touches nothing) and exit", false)
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
export function resolveReleaseNotes(release: ReleaseConfig | undefined, primaryLocale: string): Record<string, string> {
  const notes = release?.releaseNotes;
  if (!notes) return {};
  return typeof notes === "string" ? { [primaryLocale]: notes } : notes;
}

/**
 * Per-locale `releaseNotes` from the app's `store.config.json` — the same listing file `launch sync`
 * and `launch metadata` read — or `{}` when the file is absent. A malformed file fails loudly via
 * {@link loadStoreConfig}, consistent with those commands (the developer fixes the typo once).
 */
export function readStoreReleaseNotes(appDir: string): Record<string, string> {
  const path = join(appDir, "store.config.json");
  if (!existsSync(path)) return {};
  const info = loadStoreConfig(path).apple?.info ?? {};
  const notes: Record<string, string> = {};
  for (const [locale, localeInfo] of Object.entries(info)) {
    if (localeInfo.releaseNotes) notes[locale] = localeInfo.releaseNotes;
  }
  return notes;
}

/**
 * The "What's New" to write, merging both sources Launch supports: `release.releaseNotes` from
 * `launch.config.ts` as the base, with `store.config.json`'s per-locale `releaseNotes` taking precedence
 * (it's the richer, per-locale, EAS-compatible listing file). Empty leaves the version's notes untouched.
 */
export function resolveWhatsNew(release: ReleaseConfig | undefined, appDir: string): Record<string, string> {
  return { ...resolveReleaseNotes(release, release?.primaryLocale ?? "en-US"), ...readStoreReleaseNotes(appDir) };
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

/** The release-input fields that don't depend on the chosen build — shared by the dry-run and real paths. */
type ReleaseInputCommon = Omit<ReleaseInput, "versionString" | "build" | "dryRun">;

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

  const account = await resolveIosAccount(options, log);
  const ascKey = await loadAscKeyById(account.keyId);
  if (!ascKey) {
    throw new Error(`No App Store Connect key stored for account ${account.label}. Run \`launch creds set-key\`.`);
  }
  const client = new AppStoreConnectClient(ascKey);

  const appId = await client.getAppId(bundleId);
  if (options.createApp || !appId) {
    log.info(appRecordMissingMessage(bundleId));
    process.exitCode = 1;
    return;
  }

  const { releaseType, earliestReleaseDate } = resolveReleaseType(config.release, options);
  const whatsNew = resolveWhatsNew(config.release, app.dir);
  if (Object.keys(whatsNew).length === 0) {
    log.warn(
      "No release notes configured (release.releaseNotes or store.config.json) — keeps the existing “What's New”.",
    );
  }
  const common: ReleaseInputCommon = {
    bundleId,
    platform: IOS_PLATFORM,
    releaseType,
    ...(earliestReleaseDate ? { earliestReleaseDate } : {}),
    phasedRelease: options.phased === true || config.release?.phasedRelease === true,
    usesNonExemptEncryption: config.release?.usesNonExemptEncryption ?? false,
    whatsNew,
  };

  // --dry-run: a read-only plan. Resolve state only (never upload, never prompt), then print what it'd do.
  if (options.dryRun) {
    const build =
      options.build !== undefined ? await resolveBuildToPromote(client, appId, app.name, options.build) : null;
    if (!build) {
      log.info("Plan assumes uploading the latest local build (pass --build <n> to plan against a verified build).");
    }
    const versionString = await resolveVersionString(client, app, bundleId);
    const report = await releaseApp(client, { ...common, versionString, build, dryRun: true });
    renderReleasePlan(report, app.name, log);
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

  const input: ReleaseInput = { ...common, versionString, build, dryRun: false };
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

  const failures = renderReleaseReport(report, app.name, build.version, log);
  if (failures > 0) {
    process.exitCode = 1;
    await notifyCompletion(config, { ...event, status: "failure", error: `${failures} release step(s) failed` });
    return;
  }
  await notifyCompletion(config, event);
  log.info(`Track the review with \`launch status -a ${app.name} --watch\`.`);
}

/** Render the read-only `--dry-run` plan: the steps the release WOULD perform, with nothing submitted. */
function renderReleasePlan(report: ReleaseReport, appName: string, log: Logger): void {
  const lines = report.actions.map((action) =>
    action.status === "skipped"
      ? `– ${action.description}${action.note ? ` (${action.note})` : ""}`
      : `• ${action.description}`,
  );
  log.box(
    `Plan — ${appName} ${report.versionString} (dry run, nothing submitted)`,
    lines.length > 0 ? lines : ["nothing to do — already submitted or up to date"],
  );
}

/** Render a real release run (applied / skipped / failed per step) and return the number of failed steps. */
function renderReleaseReport(report: ReleaseReport, appName: string, buildLabel: string, log: Logger): number {
  if (report.alreadyInReview) {
    log.info(`${appName} ${report.versionString} is already ${report.appStoreState} — nothing to submit.`);
    return 0;
  }
  let failures = 0;
  const lines = report.actions.map((action) => {
    if (action.status === "failed") {
      failures++;
      return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
    }
    if (action.status === "skipped") return `– ${action.description}${action.note ? ` (${action.note})` : ""}`;
    return `• ${action.description}`;
  });
  const title =
    failures > 0 ? `Submitted with ${failures} failed step(s) — see below` : "Submitted for App Store review";
  log.box(title, [`${appName} ${report.versionString} (build ${buildLabel})`, ...lines]);
  return failures;
}

/** A resolved build source: upload the latest local build, or promote an already-verified one. */
type BuildSource = { kind: "upload" } | { kind: "promote"; build: BuildResource };

/**
 * Choose which build to release. `--upload` forces a fresh upload; `--build <n|latest>` promotes a
 * specific verified build; otherwise an interactive picker offers upload-vs-promote (cursor on the
 * newest verified TestFlight build), and a non-interactive run (CI) defaults to uploading the latest
 * local build. Surfacing already-verified builds turns the common "promote what I already tested in
 * TestFlight" case into one keystroke instead of a re-upload.
 */
async function resolveBuildSource(
  client: AppStoreConnectClient,
  appId: string,
  appName: string,
  options: ReleaseCommandOptions,
  log: Logger,
): Promise<BuildSource> {
  if (options.upload === true) return { kind: "upload" };
  if (options.build !== undefined) {
    return { kind: "promote", build: await resolveBuildToPromote(client, appId, appName, options.build) };
  }

  const verified = (await client.listBuilds(appId)).filter(
    (build) => build.processingState === "VALID" && !build.expired,
  );
  if (verified.length === 0) {
    if (isInteractive()) log.info("No verified TestFlight build to promote yet — will upload the latest local build.");
    return { kind: "upload" };
  }

  const promoteOptions = verified.map((build) => ({
    value: { kind: "promote", build } satisfies BuildSource,
    label: `Promote build ${build.version}`,
    hint: build.uploadedDate ? `verified · uploaded ${build.uploadedDate.slice(0, 10)}` : "verified",
  }));
  return pickOne<BuildSource>({
    message: "Release which build?",
    options: [
      { value: { kind: "upload" }, label: "Upload the latest local build", hint: "send a fresh .ipa to TestFlight" },
      ...promoteOptions,
    ],
    canPrompt: isInteractive(),
    // Highlight the newest verified build, but a non-TTY run defaults to uploading the latest local build.
    ...(promoteOptions[0] ? { initialValue: promoteOptions[0].value } : {}),
    nonInteractive: {
      kind: "fallback",
      value: { kind: "upload" },
      note: "Non-interactive: uploading the latest local build (pass --build <n> to promote a verified one).",
    },
  });
}

/**
 * Guard a promote that reuses a stored binary. The newest build per app+platform is never auto-pruned,
 * so this normally passes — but a manually-deleted or pruned binary turns a deep submit failure into a
 * clear "rebuild first" message instead.
 */
function ensureArtifactPresent(artifact: BuildArtifact, appName: string, platform: Platform): void {
  if (artifact.prunedAt || !existsSync(artifact.path)) {
    throw new Error(
      `The latest stored ${appName} ${platform} build was pruned to reclaim disk. ` +
        `Run \`launch build ${platform}\` to rebuild before releasing.`,
    );
  }
}

/**
 * Resolve the build to submit: promote an already-verified build, or upload the latest local artifact
 * and wait for it to process. Returns null when the user cancels or when `--no-wait` uploaded and
 * returned without submitting.
 */
async function resolveIosBuild(
  client: AppStoreConnectClient,
  appId: string,
  app: AppDescriptor,
  bundleId: string,
  config: LaunchConfig,
  options: ReleaseCommandOptions,
  ctx: ResolvedBuildContext,
  log: Logger,
): Promise<{ build: BuildResource; versionString: string } | null> {
  const source = await resolveBuildSource(client, appId, app.name, options, log);

  if (source.kind === "promote") {
    const { build } = source;
    const versionString = await resolveVersionString(client, app, bundleId);
    if (!(await askConfirm(`Submit ${app.name} ${versionString} (build ${build.version}) for App Store review?`))) {
      cancel("Cancelled — nothing submitted.");
      return null;
    }
    return { build, versionString };
  }

  const artifact = (await getStorageProvider(config.storage).list()).find(
    (stored) => stored.appName === app.name && stored.platform === "ios",
  );
  if (!artifact) {
    throw new Error(
      `No stored iOS build for ${app.name}. Run \`launch build ios\` first, or promote one with --build.`,
    );
  }
  ensureArtifactPresent(artifact, app.name, "ios");

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
  ensureArtifactPresent(latest, app.name, "android");

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
