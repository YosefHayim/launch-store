/**
 * `launch build <platform>` — the main command: runs the full pipeline and, by default, uploads to
 * TestFlight. `--no-submit` stops after building; public release is the separate `launch release`.
 */

import type { Command } from "commander";
import { runBuild } from "../../core/pipeline.js";

interface BuildCommandOptions {
  profile: string;
  app?: string;
  explain: boolean;
  /** commander sets this false when `--no-submit` is passed. */
  submit: boolean;
  dryRun: boolean;
}

/** Attach the `build` command to the program. */
export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("run the full pipeline and upload to TestFlight (--no-submit to build only)")
    .argument("<platform>", "ios or android")
    .option("-p, --profile <name>", "build profile", "production")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--explain", "expand each step into a plain-English teaching block", false)
    .option("--no-submit", "build only; do not upload to TestFlight")
    .option("--dry-run", "rehearse every step and print what it would do, changing nothing", false)
    .action(async (platform: string, options: BuildCommandOptions) => {
      if (platform !== "ios" && platform !== "android") {
        throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
      }
      await runBuild({
        platform,
        profileName: options.profile,
        appName: options.app,
        explain: options.explain,
        submit: options.submit,
        target: "testflight",
        dryRun: options.dryRun,
      });
    });
}
