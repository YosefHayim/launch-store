/**
 * `launch release <platform>` — the deliberate, separate path to the PUBLIC App Store review queue.
 *
 * It does not build: it takes the most recent stored artifact for the app and, after an explicit
 * confirmation, submits it for review. Keeping public release out of `launch build` is what makes an
 * accidental public release impossible.
 */

import type { Command } from "commander";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { AndroidReleaseOptions, BuildArtifact, Platform, ResolvedBuildContext } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { resolveCommandEnv, resolveSubmitterName, selectApp, worstDownloadBytes } from "../../core/pipeline.js";
import { formatEnvTable } from "../../core/env.js";
import { notifyCompletion, type NotifyEvent } from "../../core/notify.js";
import { getCredentialsProvider, getStorageProvider, getSubmitter } from "../../core/registry.js";
import { addEnvFlags, envOverrides, type EnvFlags } from "../options.js";

interface ReleaseCommandOptions extends EnvFlags {
  app?: string;
  profile: string;
  explain: boolean;
  /** Android-only: staged-rollout fraction for the production release (`--rollout`). */
  rollout?: string;
}

/** The store's public-release destination, phrased per platform for the confirmation prompt. */
const PUBLIC_DESTINATION: Record<Platform, string> = {
  ios: "the PUBLIC App Store review queue",
  android: "the PUBLIC Play production track",
};

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
    .description("submit the latest stored build to the store's PUBLIC production track (with confirmation)")
    .argument("<platform>", "ios or android")
    .option("-a, --app <name>", "app handle")
    .option("-p, --profile <name>", "build profile", "production")
    .option("--rollout <fraction>", "Android only — staged-rollout fraction (default: 1.0)")
    .option("--explain", "expand each step", false);
  addEnvFlags(command).action(async (platform: string, options: ReleaseCommandOptions) => {
    if (platform !== "ios" && platform !== "android") {
      throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
    }
    await runRelease(platform, options);
  });
}

/** Submit the latest stored artifact for `app` to the store's public production track. */
async function runRelease(platform: Platform, options: ReleaseCommandOptions): Promise<void> {
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
    (artifact) => artifact.appName === app.name && artifact.platform === platform,
  );
  if (!latest) {
    throw new Error(`No stored ${platform} build for ${app.name}. Run \`launch build ${platform}\` first.`);
  }

  const proceed = await confirm({
    message: `Submit ${app.name} ${latest.version} (${latest.buildNumber}) to ${PUBLIC_DESTINATION[platform]}?`,
  });
  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — nothing submitted.");
    process.exit(0);
  }

  // Reproducibility guard: release never rebuilds, so warn before promoting an incrementally-built artifact.
  if (shouldNudgeRelease(latest)) {
    const proceedIncremental = await confirm({
      message: `This build was incremental, not clean — promote anyway? Run \`launch build ${platform} --clean\` first for a from-scratch artifact.`,
    });
    if (isCancel(proceedIncremental) || !proceedIncremental) {
      cancel("Cancelled — nothing submitted.");
      process.exit(0);
    }
  }

  // Production releases roll out fully unless an Android `--rollout` (or the profile) narrows it.
  const rollout = options.rollout !== undefined ? Number.parseFloat(options.rollout) : (profile.rollout ?? 1.0);
  const android: AndroidReleaseOptions | undefined =
    platform === "android" ? { track: "production", rollout } : undefined;
  const ctx: ResolvedBuildContext = {
    platform,
    app,
    profile,
    env: resolvedEnv.values,
    explain: options.explain,
    dryRun: false,
    // Release never compiles — it promotes a stored artifact — so the clean/incremental decision is moot.
    forceClean: false,
    ...(android ? { android } : {}),
  };
  const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
  const destination = platform === "ios" ? "App Store review" : "the Play production track";
  const event: NotifyEvent = {
    event: "submit",
    status: "success",
    app: app.name,
    platform,
    version: latest.version,
    buildNumber: latest.buildNumber,
    destination,
  };
  const size = worstDownloadBytes(latest.sizeReport);
  if (size > 0) event.sizeBytes = size;

  try {
    await getSubmitter(resolveSubmitterName(config, platform)).submit(latest.path, "production", credentials, ctx);
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
