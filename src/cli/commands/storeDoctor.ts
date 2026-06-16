/**
 * `launch store doctor` — a read-only store-**account** readiness check, distinct from `launch doctor`
 * (which checks the local iOS/Android toolchain). Submissions silently fail on account-level
 * prerequisites that have nothing to do with the build: a missing App Store Connect app record, no
 * uploaded build on Play, an unauthorized service account. This command grades those up front.
 *
 * It owns no check logic of its own — it resolves credentials (via the shared `core/storeClients.ts`
 * resolvers), selects the `account`-tagged probes from the readiness registry, runs them, and renders the
 * result. `--json` plus the documented exit codes (0 ready · 2 blockers · 1 unreadable, error wins) make
 * it scriptable. New account checks are new probe files, never edits here. See issue #170.
 */

import type { Command } from "commander";
import { loadConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { createAscClientResolver, createPlayClientResolver } from "../../core/storeClients.js";
import { selectApps } from "../../core/syncJobs.js";
import { registerBuiltinProbes, selectReadinessProbes } from "../../core/readiness/registry.js";
import { runProbes } from "../../core/readiness/orchestrator.js";
import type { ReadinessContext } from "../../core/readiness/types.js";
import { renderReadinessOutcome } from "./readinessReport.js";

/** CLI options for `launch store doctor`. */
interface StoreDoctorOptions {
  /** Comma-separated app handles; default is every discovered app. */
  app?: string;
  /** Machine-readable output (the full {@link import("../../core/readiness/types.js").ReadinessOutcome}) for CI/agents. */
  json?: boolean;
}

/**
 * Run the store-doctor flow. Exported so a test (or a future caller) can drive it directly: it loads the
 * config, resolves the read-only clients once via the shared resolvers, runs the `account` probes, and
 * renders. Sets `process.exitCode` per the {@link READINESS_EXIT} contract.
 */
export async function runStoreDoctor(input: StoreDoctorOptions): Promise<void> {
  registerBuiltinProbes();
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const ctx: ReadinessContext = {
    config,
    apps: selectApps(apps, input.app),
    resolveAscApi: createAscClientResolver(),
    resolvePlayApi: createPlayClientResolver(),
  };

  const outcome = await runProbes(ctx, selectReadinessProbes("account"));

  if (input.json === true) console.log(JSON.stringify(outcome, null, 2));
  else {
    renderReadinessOutcome(log, outcome, {
      summary: "Store readiness",
      empty: "No store-readiness checks ran — no apps with a bundle id or package name were found.",
    });
  }
  process.exitCode = outcome.exitCode;
}

/**
 * Attach the `store` command group and its `doctor` subcommand to the program. `store` is a namespace for
 * store-account operations (today just `doctor`); keeping it a group leaves room without crowding the
 * top-level surface, and keeps `launch store doctor` unmistakably separate from `launch doctor`.
 */
export function registerStoreCommand(program: Command): void {
  const store = program.command("store").description("store-account readiness and operations");
  store
    .command("doctor")
    .description("check store-account readiness: Apple app record, Play onboarding & access (read-only)")
    .option("-a, --app <names>", "comma-separated app handles (default: all apps)")
    .option("--json", "machine-readable output for CI/agents", false)
    .action(async (options: StoreDoctorOptions) => {
      await runStoreDoctor(options);
    });
}
