#!/usr/bin/env node
/**
 * Launch CLI entry point.
 *
 * Registers the built-in providers, wires the commands onto commander, and runs. Each command
 * lives in its own file and attaches itself via a `register*` function, keeping this entry thin.
 */

import { readFileSync } from "node:fs";
import { Command } from "commander";
import { registerBuiltins } from "../providers/index.js";
import { registerInitCommand } from "./commands/init.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerCredsCommand } from "./commands/creds.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerCloudCommand } from "./commands/cloud.js";
import { runWizard } from "./commands/wizard.js";

/**
 * Read the CLI version straight from the package manifest so `package.json` stays the single
 * source of truth (no second copy to keep in sync at release time). package.json always ships
 * with the published package, and sits two levels above the compiled `dist/cli/index.js`.
 */
function readVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : "0.0.0";
}

registerBuiltins();

const program = new Command();
program
  .name("launch")
  .description("Build and ship your iOS/Android apps to the stores from your own machine — no Expo bill.")
  .version(readVersion());

registerInitCommand(program);
registerBuildCommand(program);
registerReleaseCommand(program);
registerCredsCommand(program);
registerDoctorCommand(program);
registerExplainCommand(program);
registerCloudCommand(program);

// No subcommand → the interactive wizard (the Expo-style front door that routes by OS).
program.action(async () => {
  await runWizard();
});

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
