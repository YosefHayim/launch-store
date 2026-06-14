/**
 * `launch play-subscriptions` — reconcile an app's **Google Play subscriptions** from the shared product
 * catalog in `launch.config.ts`. The Play twin of the subscription leg of `launch sync`: every
 * auto-renewable subscription declared under `products[bundleId].subscriptionGroups[].subscriptions[]`
 * that carries a `play` override is published to Play (product + base plan + offers). Same
 * plan→confirm→apply flow as `launch sync` / `launch play-products`: a read-only plan is printed, you
 * confirm, then it applies. `--dry-run` stops after the plan; `--yes` skips the prompt for CI.
 *
 * Thin glue over `core/playSubscriptions.ts`: this file resolves the app + Play account, collects the
 * declared subscriptions, drives the plan/apply passes, and renders the result.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { SubscriptionConfig } from "../../core/types.js";
import type { PlannedAction } from "../../core/ascSync.js";
import { GooglePlayClient, parseServiceAccount } from "../../google/playClient.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger } from "../../core/logger.js";
import { reconcilePlaySubscriptions, summarizePlaySubscriptions } from "../../core/playSubscriptions.js";

/** CLI options for `launch play-subscriptions`. */
interface PlaySubscriptionsOptions {
  app?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/** Build a Play client bound to the stored service account, or fail with the onboarding hint. */
async function activeClient(): Promise<GooglePlayClient> {
  const json = await loadServiceAccount();
  if (!json) throw new Error("No Play service account. Run `launch creds set-key --platform android` first.");
  return new GooglePlayClient(parseServiceAccount(json));
}

/**
 * Resolve the selected app's Play package name plus its declared Play subscriptions. Subscriptions live
 * under `products[bundleId].subscriptionGroups[].subscriptions[]` (the catalog is keyed by iOS bundle id),
 * so the app needs both a package name (to reach Play) and a bundle id (to locate its catalog); only
 * subscriptions carrying a `play` override are reconciled.
 */
async function resolveTarget(
  appSelector: string | undefined,
): Promise<{ packageName: string; subscriptions: SubscriptionConfig[] }> {
  const { config, apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.packageName) {
    throw new Error(`No Android application id for ${app.name} (set android.package in app.json).`);
  }
  if (!app.bundleId) {
    throw new Error(
      `No iOS bundle identifier for ${app.name} — the product catalog is keyed by bundle id; set ios.bundleIdentifier.`,
    );
  }
  const subscriptions = (config.products?.[app.bundleId]?.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .filter((subscription) => subscription.play);
  return { packageName: app.packageName, subscriptions };
}

/** Render one action line: `✗` for a failure (with Play's detail), `+` for a planned/applied change. Exported for tests. */
export function renderAction(action: PlannedAction): string {
  if (action.status === "failed") return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
  return `+ ${action.description}`;
}

/** Attach the `play-subscriptions` command to the program. */
export function registerPlaySubscriptionsCommand(program: Command): void {
  program
    .command("play-subscriptions")
    .description("reconcile Google Play subscriptions (base plans + offers) from the launch.config.ts catalog")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (options: PlaySubscriptionsOptions) => {
      const log = createLogger(false);
      const { packageName, subscriptions } = await resolveTarget(options.app);

      if (subscriptions.length === 0) {
        log.gap();
        log.step(packageName, "no subscriptions carry a `play` override — nothing to reconcile");
        return;
      }

      const client = await activeClient();
      const plan = await reconcilePlaySubscriptions(client, { packageName, subscriptions, dryRun: true });
      const planned = plan.actions.filter((action) => action.status === "planned");

      log.gap();
      if (plan.actions.length === 0) {
        log.step(packageName, "Play subscriptions already in sync");
        return;
      }
      log.notice(packageName, ...plan.actions.map(renderAction));

      log.gap();
      log.info(`${planned.length} change(s) for ${packageName}.`);
      if (options.dryRun === true) {
        log.info("Dry run — no changes made. Re-run without --dry-run to apply.");
        return;
      }

      if (options.yes !== true) {
        if (!process.stdout.isTTY) {
          throw new Error("Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).");
        }
        const proceed = await confirm({
          message: `Apply ${planned.length} Play subscription change(s) to ${packageName}?`,
        });
        if (isCancel(proceed) || !proceed) {
          cancel("Aborted — no changes made.");
          return;
        }
      }

      const applied = await reconcilePlaySubscriptions(client, { packageName, subscriptions, dryRun: false });
      const summary = summarizePlaySubscriptions(applied.actions);
      const rows = applied.actions.map((action) => {
        if (action.status === "failed") return `✗ ${action.description} — ${action.error ?? "failed"}`;
        return `${action.status === "skipped" ? "•" : "✓"} ${action.description}`;
      });
      log.box(summary.failed > 0 ? "Applied with errors" : "Applied", rows);
      if (summary.failed > 0) process.exitCode = 1;
    });
}
