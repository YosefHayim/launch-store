/**
 * `relay release <platform>` — the deliberate, separate path to the PUBLIC App Store review queue.
 *
 * It does not build: it takes the most recent stored artifact for the app and, after an explicit
 * confirmation, submits it for review. Keeping public release out of `relay build` is what makes an
 * accidental public release impossible.
 */

import type { Command } from "commander";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Platform, ResolvedBuildContext } from "../../core/types.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { getCredentialsProvider, getStorageProvider, getSubmitter } from "../../core/registry.js";

interface ReleaseCommandOptions {
  app?: string;
  profile: string;
  explain: boolean;
}

/** Attach the `release` command to the program. */
export function registerReleaseCommand(program: Command): void {
  program
    .command("release")
    .argument("<platform>", "ios or android")
    .option("-a, --app <name>", "app handle")
    .option("-p, --profile <name>", "build profile", "production")
    .option("--explain", "expand each step", false)
    .action(async (platform: string, options: ReleaseCommandOptions) => {
      if (platform !== "ios" && platform !== "android") {
        throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
      }
      await runRelease(platform, options);
    });
}

/** Submit the latest stored artifact for `app` to the public App Store review queue. */
async function runRelease(platform: Platform, options: ReleaseCommandOptions): Promise<void> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, options.app);

  const latest = (await getStorageProvider(config.storage).list()).find(
    (artifact) => artifact.appName === app.name && artifact.platform === platform,
  );
  if (!latest) {
    throw new Error(`No stored ${platform} build for ${app.name}. Run \`relay build ${platform}\` first.`);
  }

  const proceed = await confirm({
    message: `Submit ${app.name} ${latest.version} (${latest.buildNumber}) to the PUBLIC App Store review queue?`,
  });
  if (isCancel(proceed) || !proceed) {
    cancel("Cancelled — nothing submitted.");
    process.exit(0);
  }

  const profile = config.profiles[options.profile] ?? { name: options.profile };
  const ctx: ResolvedBuildContext = { platform, app, profile, env: {}, explain: options.explain, dryRun: false };
  const credentials = await getCredentialsProvider(config.credentials).resolve(ctx);
  await getSubmitter("app-store-connect").submit(latest.path, "appstore", credentials, ctx);
  console.log(`Submitted ${app.name} ${latest.version} (${latest.buildNumber}) for App Store review.`);
}
