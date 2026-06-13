/**
 * `launch build <platform>` — the main command: runs the full pipeline and, by default, uploads to
 * TestFlight. `--no-submit` stops after building; public release is the separate `launch release`.
 */

import type { Command } from "commander";
import type { PlayTrack, RemoteTarget } from "../../core/types.js";
import { runBuild } from "../../core/pipeline.js";

interface BuildCommandOptions {
  profile: string;
  app?: string;
  explain: boolean;
  /** commander sets this false when `--no-submit` is passed. */
  submit: boolean;
  dryRun: boolean;
  /** `--remote` (bare → AWS) or `--remote <target>` where target is `aws` or `user@host`. iOS-only. */
  remote?: string | boolean;
  /** Android-only: Play track (`--track`). */
  track?: string;
  /** Android-only: staged-rollout fraction (`--rollout`). */
  rollout?: string;
}

/** Valid Play tracks, used to validate `--track` before it reaches the pipeline. */
const PLAY_TRACKS: readonly PlayTrack[] = ["internal", "closed", "open", "production"];

/**
 * Turn the `--remote` flag into a {@link RemoteTarget}: bare `--remote` or `--remote aws` → AWS EC2 Mac;
 * `--remote user@host` → that Mac over SSH. Returns undefined for a local build.
 */
function resolveRemote(remote: string | boolean | undefined): RemoteTarget | undefined {
  if (remote === undefined || remote === false) return undefined;
  if (remote === true || remote === "aws") return { kind: "aws" };
  return { kind: "ssh", target: remote };
}

/** Validate `--track` against the known Play tracks, throwing a clear error on a typo. */
function parseTrack(track: string | undefined): PlayTrack | undefined {
  if (track === undefined) return undefined;
  if (!(PLAY_TRACKS as readonly string[]).includes(track)) {
    throw new Error(`Unknown --track "${track}". Use one of: ${PLAY_TRACKS.join(", ")}.`);
  }
  return track as PlayTrack;
}

/** Parse `--rollout` into a 0–1 fraction, rejecting out-of-range or non-numeric input. */
function parseRollout(rollout: string | undefined): number | undefined {
  if (rollout === undefined) return undefined;
  const value = Number.parseFloat(rollout);
  if (Number.isNaN(value) || value <= 0 || value > 1) {
    throw new Error(`Invalid --rollout "${rollout}". Pass a fraction between 0 (exclusive) and 1.`);
  }
  return value;
}

/** Attach the `build` command to the program. */
export function registerBuildCommand(program: Command): void {
  program
    .command("build")
    .description("run the full pipeline and upload to the testing track (--no-submit to build only)")
    .argument("<platform>", "ios or android")
    .option("-p, --profile <name>", "build profile", "production")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--explain", "expand each step into a plain-English teaching block", false)
    .option("--no-submit", "build only; do not upload")
    .option("--remote [target]", "iOS only — build on a remote Mac: 'aws' (default) or user@host over SSH")
    .option("--track <track>", "Android only — Play track: internal|closed|open|production (default: internal)")
    .option("--rollout <fraction>", "Android only — staged-rollout fraction for production (default: 1.0)")
    .option("--dry-run", "rehearse every step and print what it would do, changing nothing", false)
    .action(async (platform: string, options: BuildCommandOptions) => {
      if (platform !== "ios" && platform !== "android") {
        throw new Error(`Unknown platform "${platform}". Use "ios" or "android".`);
      }
      const remote = resolveRemote(options.remote);
      const track = parseTrack(options.track);
      const rollout = parseRollout(options.rollout);
      await runBuild({
        platform,
        profileName: options.profile,
        appName: options.app,
        explain: options.explain,
        submit: options.submit,
        target: "testing",
        dryRun: options.dryRun,
        ...(remote ? { remote } : {}),
        ...(track ? { track } : {}),
        ...(rollout !== undefined ? { rollout } : {}),
      });
    });
}
