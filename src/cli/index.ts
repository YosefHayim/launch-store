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
import { migrateLegacyAccounts } from "../core/accounts.js";
import { renderBanner } from "../core/banner.js";
import { runAutoUpgrade } from "../core/updateCheck.js";
import { registerInitCommand } from "./commands/init.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerCredsCommand } from "./commands/creds.js";
import { registerSecretCommand } from "./commands/secret.js";
import { registerMetadataCommand } from "./commands/metadata.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerDeviceCommand } from "./commands/device.js";
import { registerTestflightCommand } from "./commands/testflight.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerExplainCommand } from "./commands/explain.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerUpdatesCommand } from "./commands/updates.js";
import { registerCloudCommand } from "./commands/cloud.js";
import { registerDemoCommand } from "./commands/demo.js";
import { registerBuildsCommand } from "./commands/builds.js";
import { registerCiCommand } from "./commands/ci.js";
import { registerRunCommand } from "./commands/run.js";
import { registerFingerprintCommand } from "./commands/fingerprint.js";
import { registerDiagnoseCommand } from "./commands/diagnose.js";
import { registerResignCommand } from "./commands/resign.js";
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
registerSecretCommand(program);
registerMetadataCommand(program);
registerSyncCommand(program);
registerDeviceCommand(program);
registerTestflightCommand(program);
registerDoctorCommand(program);
registerExplainCommand(program);
registerUpdateCommand(program);
registerUpdatesCommand(program);
registerCloudCommand(program);
registerDemoCommand(program);
registerBuildsCommand(program);
registerCiCommand(program);
registerRunCommand(program);
registerFingerprintCommand(program);
registerDiagnoseCommand(program);
registerResignCommand(program);

// No subcommand → the animated rocket banner, then the interactive wizard (the Expo-style front
// door that detects the host OS and routes the build accordingly).
program.action(async () => {
  await renderBanner();
  await runWizard();
});

/**
 * Boot the CLI: silently self-upgrade first (guarded/throttled — usually an instant no-op), then let
 * commander dispatch. With no subcommand it falls through to the action above (banner + wizard); with
 * a subcommand it runs that command. Both the upgrade and the banner degrade to no-ops in CI, when
 * piped, and for agents, so scripts are unaffected.
 */
async function main(): Promise<void> {
  await runAutoUpgrade(readVersion());
  // One-time, near-instant no-op after the first post-upgrade run: moves a pre-multi-account key into
  // the registry. Best-effort — a hiccup must not block the CLI; commands re-attempt it on next run.
  await migrateLegacyAccounts().catch(() => undefined);
  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
