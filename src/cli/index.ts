#!/usr/bin/env node
/**
 * Relay CLI entry point.
 *
 * Registers the built-in providers, wires the commands onto commander, and runs. Each command
 * lives in its own file and attaches itself via a `register*` function, keeping this entry thin.
 */

import { Command } from "commander";
import { registerBuiltins } from "../providers/index.js";
import { registerInitCommand } from "./commands/init.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerCredsCommand } from "./commands/creds.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerExplainCommand } from "./commands/explain.js";

registerBuiltins();

const program = new Command();
program
  .name("relay")
  .description("Build and ship your iOS/Android apps to the stores from your own machine — no Expo bill.")
  .version("0.0.0");

registerInitCommand(program);
registerBuildCommand(program);
registerReleaseCommand(program);
registerCredsCommand(program);
registerDoctorCommand(program);
registerExplainCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
