/**
 * `launch play-products` — reconcile an app's **Google Play in-app managed products** from the shared
 * product catalog in `launch.config.ts`, using the Play service account alone. The Play twin of the
 * in-app-purchase leg of `launch sync`: every one-off purchase declared under `products[bundleId]
 * .inAppPurchases` that carries a `play` override is published to Play. Same plan→confirm→apply flow as
 * `launch sync` / `launch accessibility`: a read-only plan is printed, you confirm, then it applies.
 * `--dry-run` stops after the plan; `--yes` skips the prompt for CI.
 *
 * Thin glue over `core/playProducts.ts`: this file resolves the app + Play account, pulls the declared
 * products from config, drives the plan/apply passes, and renders the result — all diff logic and request
 * shaping live in the core module and the Play client.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { InAppPurchaseConfig } from "../../core/types.js";
import type { PlannedAction } from "../../core/ascSync.js";
import { GooglePlayClient, parseServiceAccount } from "../../google/playClient.js";
import { loadServiceAccount } from "../../google/credentials.js";
import { loadConfig } from "../../core/config.js";
import { selectApp } from "../../core/pipeline.js";
import { createLogger } from "../../core/logger.js";
import { reconcilePlayProducts, summarizePlayProducts } from "../../core/playProducts.js";

/** CLI options for `launch play-products`. */
interface PlayProductsOptions {
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
 * Resolve the selected app's Play package name plus its declared Play products. Products live under
 * `products[bundleId]` (the catalog is keyed by iOS bundle id), so the app needs both a package name (to
 * reach Play) and a bundle id (to locate its catalog); only purchases carrying a `play` override are
 * reconciled.
 */
async function resolveTarget(
  appSelector: string | undefined,
): Promise<{ packageName: string; products: InAppPurchaseConfig[] }> {
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
  const products = (config.products?.[app.bundleId]?.inAppPurchases ?? []).filter((product) => product.play);
  return { packageName: app.packageName, products };
}

/** Render one action line: `✗` for a failure (with Play's detail), `+` for a planned/applied change. Exported for tests. */
export function renderAction(action: PlannedAction): string {
  if (action.status === "failed") return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
  return `+ ${action.description}`;
}

/** Attach the `play-products` command to the program. */
export function registerPlayProductsCommand(program: Command): void {
  program
    .command("play-products")
    .description("reconcile Google Play in-app products from the launch.config.ts product catalog")
    .option("-a, --app <name>", "app handle (auto-selected if there's only one)")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action(async (options: PlayProductsOptions) => {
      const log = createLogger(false);
      const { packageName, products } = await resolveTarget(options.app);

      if (products.length === 0) {
        log.gap();
        log.step(packageName, "no in-app purchases carry a `play` override — nothing to reconcile");
        return;
      }

      const client = await activeClient();
      const plan = await reconcilePlayProducts(client, { packageName, products, dryRun: true });
      const planned = plan.actions.filter((action) => action.status === "planned");

      log.gap();
      if (plan.actions.length === 0) {
        log.step(packageName, "Play in-app products already in sync");
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
        const proceed = await confirm({ message: `Apply ${planned.length} Play product change(s) to ${packageName}?` });
        if (isCancel(proceed) || !proceed) {
          cancel("Aborted — no changes made.");
          return;
        }
      }

      const applied = await reconcilePlayProducts(client, { packageName, products, dryRun: false });
      const summary = summarizePlayProducts(applied.actions);
      const rows = applied.actions.map((action) => {
        if (action.status === "failed") return `✗ ${action.description} — ${action.error ?? "failed"}`;
        return `${action.status === "skipped" ? "•" : "✓"} ${action.description}`;
      });
      log.box(summary.failed > 0 ? "Applied with errors" : "Applied", rows);
      if (summary.failed > 0) process.exitCode = 1;
    });
}
