/**
 * `launch build <platform>` — the main command: runs the full pipeline and, by default, uploads to
 * TestFlight. `--no-submit` stops after building; public release is the separate `launch release`.
 */

import type { Command } from "commander";
import type { RemoteTarget } from "../../core/types.js";
import { runBuild } from "../../core/pipeline.js";

interface BuildCommandOptions {
  profile: string;
  app?: string;
  explain: boolean;
  /** commander sets this false when `--no-submit` is passed. */
  submit: boolean;
  dryRun: boolean;
  /** `--remote` (bare → AWS) or `--remote <target>` where target is `aws` or `user@host`. */
  remote?: string | boolean;
}

/**
 * Turn the `--remote` flag into a {@link RemoteTarget}: bare `--remote` or `--remote aws` → AWS EC2 Mac;
 * `--remote user@host` → that Mac over SSH. Returns undefined for a local build.
 */
function resolveRemote(remote: string | boolean | undefined): RemoteTarget | undefined {
  if (remote === undefined || remote === false) return undefined;
  if (remote === true || remote === "aws") return { kind: "aws" };
  return { kind: "ssh", target: remote };
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
    .option("--remote [target]", "build on a remote Mac: 'aws' (default) or user@host over SSH")
    .option("--dry-run", "rehearse every step and print what it would do, changing nothing", false)
    .action(async (platform: string, options: BuildCommandOptions) => {
      if (platform !== "ios" && platform !== "android") {
        throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
      }
      const remote = resolveRemote(options.remote);
      await runBuild({
        platform,
        profileName: options.profile,
        appName: options.app,
        explain: options.explain,
        submit: options.submit,
        target: "testflight",
        dryRun: options.dryRun,
        ...(remote ? { remote } : {}),
      });
    });
}
