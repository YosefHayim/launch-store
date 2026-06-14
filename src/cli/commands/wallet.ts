/**
 * `launch wallet` — config-as-code registration of **Apple Pay merchant ids** and **Wallet pass type
 * ids** from a declarative `wallet.config.json`, via the App Store Connect API key alone. These team-level
 * Identifiers are otherwise registered by hand in Certificates, Identifiers & Profiles; fastlane's
 * `spaceship` exposes them but EAS doesn't, and they gate the certificates that sign payments / passes.
 *
 * The default `launch wallet` reconciles the declared identifiers with the same plan→confirm→apply /
 * `--dry-run` flow as `launch sync` (additive — existing ids are left as-is, undeclared ones untouched).
 * `list` shows what's currently registered. There's no `--app`: these belong to the team, not an app.
 */

import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { PlannedAction } from "../../core/ascSync.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { loadConfig, resolveSidecarConfig } from "../../core/config.js";
import { createLogger } from "../../core/logger.js";
import { loadWalletConfig, reconcileWalletIds, summarizeWallet } from "../../core/walletIds.js";

/** CLI options for the default `launch wallet` reconcile. */
interface WalletOptions {
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

/**
 * Render one action line: `✗` for a failure (with Apple's detail), `+` for a planned/applied
 * registration. (Identifier reconcile never skips.) Exported for tests.
 */
export function renderAction(action: PlannedAction): string {
  if (action.status === "failed") return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
  return `+ ${action.description}`;
}

/** The body of `launch wallet`: plan identifier registrations, print, confirm, apply. */
async function runReconcile(options: WalletOptions, command: Command): Promise<void> {
  const log = createLogger(false);
  const { config: launchConfig } = await loadConfig();
  const config = resolveSidecarConfig({
    typed: launchConfig.wallet,
    configPath: options.config,
    explicitPath: command.getOptionValueSource("config") === "cli",
    load: loadWalletConfig,
  });
  if (!config) {
    throw new Error(`No wallet config. Add a \`wallet\` field to launch.config.ts or create ${options.config}.`);
  }
  const client = await activeClient();

  const plan = await reconcileWalletIds(client, config, true);

  log.gap();
  if (plan.length === 0) {
    log.step("wallet", "merchant ids & pass type ids already registered");
    return;
  }
  log.notice("Apple Pay / Wallet identifiers", ...plan.map(renderAction));

  log.gap();
  log.info(`${plan.length} identifier(s) to register.`);
  if (options.dryRun === true) {
    log.info("Dry run — no changes made. Re-run without --dry-run to apply.");
    return;
  }

  if (options.yes !== true) {
    if (!process.stdout.isTTY) {
      throw new Error("Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).");
    }
    const proceed = await confirm({ message: `Register ${plan.length} identifier(s)?` });
    if (isCancel(proceed) || !proceed) {
      cancel("Aborted — no changes made.");
      return;
    }
  }

  const applied = await reconcileWalletIds(client, config, false);
  const summary = summarizeWallet(applied);
  const rows = applied.map((action) =>
    action.status === "failed" ? `✗ ${action.description} — ${action.error ?? "failed"}` : `✓ ${action.description}`,
  );
  log.box(summary.failed > 0 ? "Registered with errors" : "Identifiers registered", rows);
  if (summary.failed > 0) process.exitCode = 1;
}

/** Attach the `wallet` command (identifier reconcile) and its `list` subcommand to the program. */
export function registerWalletCommand(program: Command): void {
  const wallet = program
    .command("wallet")
    .description("register Apple Pay merchant ids & Wallet pass type ids from wallet.config.json")
    .option("--config <path>", "path to the wallet config file", "wallet.config.json")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action((options: WalletOptions, command: Command) => runReconcile(options, command));

  wallet
    .command("list")
    .description("show the team's registered Apple Pay merchant ids and Wallet pass type ids")
    .action(async () => {
      const log = createLogger(false);
      const client = await activeClient();
      const [merchantIds, passTypeIds] = await Promise.all([client.listMerchantIds(), client.listPassTypeIds()]);
      log.notice(
        "Apple Pay merchant ids",
        ...(merchantIds.length > 0
          ? merchantIds.map((entry) => `• ${entry.identifier ?? "?"}${entry.name ? ` (${entry.name})` : ""}`)
          : ["• none registered"]),
      );
      log.notice(
        "Wallet pass type ids",
        ...(passTypeIds.length > 0
          ? passTypeIds.map((entry) => `• ${entry.identifier ?? "?"}${entry.name ? ` (${entry.name})` : ""}`)
          : ["• none registered"]),
      );
    });
}
