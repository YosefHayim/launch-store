/**
 * `launch build <platform>` — the main command: runs the full pipeline and, by default, uploads to
 * TestFlight. `--no-submit` stops after building; public release is the separate `launch release`.
 */

import type { Command } from "commander";
import type { Distribution, PlayTrack, RemoteTarget } from "../../core/types.js";
import type { BumpKind } from "../../core/version.js";
import { parsePlatform } from "../../core/platform.js";
import { runBuild } from "../../core/pipeline.js";
import { setVerboseOutput } from "../../core/progress.js";
import { addEnvFlags, envOverrides, type EnvFlags } from "../options.js";

interface BuildCommandOptions extends EnvFlags {
  profile: string;
  app?: string;
  explain: boolean;
  /** commander sets this false when `--no-submit` is passed. */
  submit: boolean;
  dryRun: boolean;
  /** Skip the interactive pre-upload size confirmation (`--yes`); auto-confirm. */
  yes: boolean;
  /** Stream the raw xcodebuild/gradle/prebuild output instead of the spinner (`--verbose`). */
  verbose: boolean;
  /** `--remote` (bare → AWS) or `--remote <target>` where target is `aws` or `user@host`. iOS-only. */
  remote?: string | boolean;
  /** Android-only: Play track (`--track`). */
  track?: string;
  /** Android-only: staged-rollout fraction (`--rollout`). */
  rollout?: string;
  /** Force a from-scratch build instead of the default fingerprint-gated incremental (`--clean`). */
  clean: boolean;
  /** iOS-only: Apple account to build with (`--account`) — a label or Key ID. Defaults to the active one. */
  account?: string;
  /** How to distribute (`--distribution`): `store` (default) or `internal` (ad-hoc install link). */
  distribution?: string;
  /** iOS-only version bump (`--bump`): patch|minor|major|keep, or `ask` to force the prompt. */
  bump?: string;
}

/** The accepted `--bump` values: the rememberable {@link BumpKind} kinds plus `ask` (force the prompt). */
const BUMP_SELECTORS: readonly (BumpKind | "ask")[] = ["patch", "minor", "major", "keep", "ask"];

/**
 * Validate `--bump`. Returns undefined when omitted (→ remembered pick, else prompt). An explicit value
 * wins over a remembered one and makes the version scriptable in CI; `ask` forces the interactive prompt.
 */
function parseBump(bump: string | undefined): BumpKind | "ask" | undefined {
  if (bump === undefined) return undefined;
  if (!(BUMP_SELECTORS as readonly string[]).includes(bump)) {
    throw new Error(`Unknown --bump "${bump}". Use one of: ${BUMP_SELECTORS.join(", ")}.`);
  }
  return bump as BumpKind | "ask";
}

/** Valid distribution modes, used to validate `--distribution` before it reaches the pipeline. */
const DISTRIBUTIONS: readonly Distribution[] = ["store", "internal"];

/** Validate `--distribution`, defaulting to `store`. */
function parseDistribution(distribution: string | undefined): Distribution {
  const value = distribution ?? "store";
  if (!(DISTRIBUTIONS as readonly string[]).includes(value)) {
    throw new Error(`Unknown --distribution "${value}". Use one of: ${DISTRIBUTIONS.join(", ")}.`);
  }
  return value as Distribution;
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
  const command = program
    .command("build")
    .description("run the full pipeline and upload to the testing track (--no-submit to build only)")
    .argument("<platform>", "ios, android, tvos, macos, or visionos")
    .option("-p, --profile <name>", "build profile", "production")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--account <name>", "iOS only — Apple account to build with: label or Key ID (default: active)")
    .option("--explain", "expand each step into a plain-English teaching block", false)
    .option("--no-submit", "build only; do not upload")
    .option("--remote [target]", "iOS only — build on a remote Mac: 'aws' (default) or user@host over SSH")
    .option("--distribution <mode>", "store (default, TestFlight/Play) or internal (ad-hoc install link)")
    .option(
      "--bump <kind>",
      "iOS only — version bump: patch|minor|major|keep (default: last used, else prompt) or 'ask' to force the prompt",
    )
    .option("--track <track>", "Android only — Play track: internal|closed|open|production (default: internal)")
    .option("--rollout <fraction>", "Android only — staged-rollout fraction for production (default: 1.0)")
    .option(
      "--clean",
      "force a from-scratch build (default: fast incremental, clean only when native deps change)",
      false,
    )
    .option("--dry-run", "rehearse every step and print what it would do, changing nothing", false)
    .option("-y, --yes", "skip the pre-upload size confirmation (auto-confirm)", false)
    .option("-v, --verbose", "stream the full xcodebuild/gradle output instead of a progress spinner", false);
  addEnvFlags(command).action(async (platformArg: string, options: BuildCommandOptions) => {
    const platform = parsePlatform(platformArg);
    setVerboseOutput(options.verbose);
    const remote = resolveRemote(options.remote);
    const track = parseTrack(options.track);
    const rollout = parseRollout(options.rollout);
    const distribution = parseDistribution(options.distribution);
    const bump = parseBump(options.bump);
    await runBuild({
      platform,
      profileName: options.profile,
      appName: options.app,
      explain: options.explain,
      submit: options.submit,
      target: "testing",
      dryRun: options.dryRun,
      yes: options.yes,
      forceClean: options.clean,
      distribution,
      envOverrides: envOverrides(options),
      includeLocal: options.includeLocal,
      printEnv: options.printEnv,
      ...(remote ? { remote } : {}),
      ...(track ? { track } : {}),
      ...(rollout !== undefined ? { rollout } : {}),
      ...(options.account ? { account: options.account } : {}),
      ...(bump ? { bump } : {}),
    });
  });
}
