/**
 * `launch accessibility` — reconcile an app's **accessibility declarations** (Apple's 2025 "Accessibility
 * Nutrition Labels") from a declarative `accessibility.config.json`, using the App Store Connect API key
 * alone. Same plan→confirm→apply flow as `launch game-center` / `launch sync`: a read-only plan is
 * printed, you confirm, then it applies. `--dry-run` stops after the plan; `--yes` skips the prompt for CI.
 *
 * Thin glue over `core/accessibility.ts`: this file resolves the account + app, loads the config, drives
 * the plan/apply passes, and renders the plan/summary — all diff logic and request shaping live in the
 * core module and the ASC client. Declarations are published only when the config sets `publish: true`;
 * otherwise they're left as drafts to review in App Store Connect.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { PlannedAction } from "../../core/ascSync.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { createLogger } from "../../core/logger.js";
import { loadAccessibilityConfig, reconcileAccessibility, summarizeAccessibility } from "../../core/accessibility.js";

/** CLI options for `launch accessibility`. */
interface AccessibilityOptions {
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

/**
 * Render one action line: `✗` for a failure (with Apple's detail), `+` for a planned/applied change.
 * Total over every {@link PlannedAction} status so an apply-phase failure is never shown as a successful
 * change. Exported for tests.
 */
export function renderAction(action: PlannedAction): string {
  if (action.status === "failed") return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
  return `+ ${action.description}`;
}

/** Attach the `accessibility` command to the program. */
export function registerAccessibilityCommand(program: Command): void {
  program
    .command("accessibility")
    .description("reconcile accessibility declarations (nutrition labels) from accessibility.config.json")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--config <path>", "path to the accessibility config file", "accessibility.config.json")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (options: AccessibilityOptions) => {
      const log = createLogger(false);
      const config = loadAccessibilityConfig(options.config);
      const bundleId = await resolveBundleId(options.app);
      const client = await activeClient();

      const plan = await reconcileAccessibility(client, { bundleId, config, dryRun: true });
      const planned = plan.actions.filter((action) => action.status === "planned");

      log.gap();
      if (plan.actions.length === 0) {
        log.step(bundleId, "accessibility declarations already in sync");
        return;
      }
      log.notice(bundleId, ...plan.actions.map(renderAction));

      log.gap();
      log.info(`${planned.length} change(s) for ${bundleId}.`);
      if (options.dryRun === true) {
        log.info("Dry run — no changes made. Re-run without --dry-run to apply.");
        return;
      }

      if (options.yes !== true) {
        if (!process.stdout.isTTY) {
          throw new Error("Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).");
        }
        const proceed = await confirm({
          message: `Apply ${planned.length} accessibility change(s) to App Store Connect?`,
        });
        if (isCancel(proceed) || !proceed) {
          cancel("Aborted — no changes made.");
          return;
        }
      }

      const applied = await reconcileAccessibility(client, { bundleId, config, dryRun: false });
      const summary = summarizeAccessibility(applied.actions);
      const rows = applied.actions.map((action) => {
        if (action.status === "failed") return `✗ ${action.description} — ${action.error ?? "failed"}`;
        return `${action.status === "skipped" ? "•" : "✓"} ${action.description}`;
      });
      log.box(summary.failed > 0 ? "Applied with errors" : "Applied", rows);
      if (summary.failed > 0) process.exitCode = 1;
    });
}
