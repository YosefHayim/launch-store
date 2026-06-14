/**
 * Shared command-line flags for env resolution, attached identically to `build`, `release`, and
 * `update`. Defining them once is the point of issue #25 — the three commands must expose the SAME
 * env surface and precedence, so the flags live here rather than being re-typed (and drifting) in
 * each command file. See `core/env.ts` `resolveEnv` for the ladder these feed.
 */

import type { Command } from "commander";
import { parseCliEnv } from "../core/env.js";

/**
 * The parsed env flags shared by build/release/update. `env` is the raw repeated `--env KEY=VAL`
 * strings (commander collects them); `includeLocal` and `printEnv` are the two booleans. Each
 * command's own options interface extends this shape.
 */
export interface EnvFlags {
  env: string[];
  includeLocal: boolean;
  printEnv: boolean;
}

/** Commander reducer: collect a repeatable string option into an array. */
function collectEnv(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Attach `--env`, `--include-local`, and `--print-env` to a command. Returns the command for
 * chaining so it slots into the existing `.option(...).option(...)` builders.
 */
export function addEnvFlags(command: Command): Command {
  return command
    .option("--env <KEY=VALUE>", "inline env override (repeatable); highest precedence", collectEnv, [])
    .option("--include-local", "also load .env.local (off by default to avoid surprise local env)", false)
    .option("--print-env", "print the resolved env (masked) with its sources, then exit without running", false);
}

/** Parse the repeated `--env KEY=VAL` flags into a map, throwing on a malformed pair. */
export function envOverrides(flags: EnvFlags): Record<string, string> {
  return parseCliEnv(flags.env);
}
