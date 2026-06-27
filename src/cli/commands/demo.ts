/**
 * `launch demo [platform]` — replay the first-run walkthrough on demand.
 *
 * Same simulated tour the no-args `launch` plays the first time (see `tour.ts`): it narrates the whole
 * build → sign → submit pipeline with no build, network, or account changes. Handy any time — to learn
 * the flow, to show a teammate, or to screenshot. With a platform argument it runs straight through
 * (deterministic, good for docs/CI); without one it prompts, defaulting to iOS.
 *
 * Unlike the first-run auto-play, the standalone command ends with a concrete "next steps" panel rather
 * than dropping into the wizard menu — the user invoked it deliberately, so we just point the way.
 */

import type { Command } from "commander";
import { createLogger } from "../../core/logger.js";
import { parsePlatform } from "../../core/platform.js";
import { isInteractive } from "../../core/progress.js";
import { runTour } from "../../core/tour.js";
import type { Platform } from "../../core/types.js";
import { promptTourPlatform } from "./wizard.js";

/**
 * Resolve which platform to tour: an explicit argument wins; otherwise prompt on a TTY, or fall back to
 * iOS when there's no one to ask (piped/CI). Returns null only when the user skips the interactive pick.
 */
async function resolveDemoPlatform(arg: string | undefined): Promise<Platform | null> {
  if (arg) return parsePlatform(arg);
  if (isInteractive()) return promptTourPlatform();
  return "ios";
}

/** The "now do it for real" panel shown after a standalone demo. */
function printNextSteps(): void {
  createLogger(false).box("Next — go from zero to the testing track", [
    "launch init             scaffold launch.config.ts",
    "launch creds set-key    import your App Store Connect API key",
    "launch creds setup      create or reuse your cert + provisioning profile",
    "launch build ios        build, sign, size-check, and upload to TestFlight",
  ]);
}

/** Attach the `demo` command to the program. */
export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("replay the simulated walkthrough of the build → sign → submit pipeline")
    .argument("[platform]", "ios, android, tvos, macos, or visionos (prompts if omitted, defaults to ios)")
    .action(async (platform?: string) => {
      const resolved = await resolveDemoPlatform(platform);
      if (resolved === null) return; // user skipped the pick
      await runTour(resolved, isInteractive());
      printNextSteps();
    });
}
