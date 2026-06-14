/**
 * `launch availability` — set the App Store territories an app sells in, from a declarative
 * `availability.config.json`, using the App Store Connect API key alone. Same plan→confirm→apply flow as
 * `launch accessibility`: a read-only plan is printed, you confirm, then it applies. `--dry-run` stops
 * after the plan; `--yes` skips the prompt for CI.
 *
 * Thin glue over `core/availability.ts`: this file resolves the account + app, loads the config, drives
 * the plan/apply, and renders it. Apple's availability is a single atomic set (replacing the whole
 * territory list), so the plan is one line; when it removes territories the app currently sells in, the
 * prompt warns that the app is pulled from sale there.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { PlannedAction } from "../../core/ascSync.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { createLogger } from "../../core/logger.js";
import { loadAvailabilityConfig, reconcileAvailability } from "../../core/availability.js";

/** CLI options for `launch availability`. */
interface AvailabilityOptions {
  app?: string;
  config: string;
  dryRun?: boolean;
  yes?: boolean;
}

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error("No active Apple account. Run `launch creds set-key` first.");
  return new AppStoreConnectClient(ascKey);
}

/** Resolve the selected app's iOS bundle id, erroring when the app has none. */
async function resolveBundleId(appSelector: string | undefined): Promise<string> {
  const { apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.bundleId) {
    throw new Error(`No iOS bundle identifier for ${app.name} (set ios.bundleIdentifier in app.json).`);
  }
  return app.bundleId;
}

/** Render the (single) plan line: `✗` for a failure, `!` for a destructive removal, `+` otherwise. Exported for tests. */
export function renderAction(action: PlannedAction): string {
  if (action.status === "failed") return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
  return `${action.destructive ? "!" : "+"} ${action.description}`;
}

/** Attach the `availability` command to the program. */
export function registerAvailabilityCommand(program: Command): void {
  program
    .command("availability")
    .description("set the App Store territories the app sells in, from availability.config.json")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--config <path>", "path to the availability config file", "availability.config.json")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (options: AvailabilityOptions) => {
      const log = createLogger(false);
      const config = loadAvailabilityConfig(options.config);
      const bundleId = await resolveBundleId(options.app);
      const client = await activeClient();

      const plan = await reconcileAvailability(client, { bundleId, config, dryRun: true });

      log.gap();
      if (plan.actions.length === 0) {
        log.step(bundleId, "store availability already in sync");
        return;
      }
      const [action] = plan.actions;
      log.notice(bundleId, ...plan.actions.map(renderAction));

      log.gap();
      if (options.dryRun === true) {
        log.info("Dry run — no changes made. Re-run without --dry-run to apply.");
        return;
      }

      if (options.yes !== true) {
        if (!process.stdout.isTTY) {
          throw new Error("Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).");
        }
        const message = action?.destructive
          ? "This removes the app from sale in some territories. Apply the new store availability?"
          : "Apply the new store availability?";
        const proceed = await confirm({ message });
        if (isCancel(proceed) || !proceed) {
          cancel("Aborted — no changes made.");
          return;
        }
      }

      const applied = await reconcileAvailability(client, { bundleId, config, dryRun: false });
      const result = applied.actions[0];
      if (result?.status === "failed") {
        log.box("Failed", [`✗ ${result.description} — ${result.error ?? "failed"}`]);
        process.exitCode = 1;
        return;
      }
      log.box(
        "Applied",
        applied.actions.map((entry) => `✓ ${entry.description}`),
      );
    });
}
