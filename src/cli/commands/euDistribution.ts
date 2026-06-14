/**
 * `launch eu-distribution` — config-as-code setup for EU **alternative distribution** (DMA web
 * distribution / alternative marketplaces), via the App Store Connect API key alone. Fills a gap no tool
 * covers and EAS ignores entirely: authorizing the domains you distribute from and registering the
 * package-signing public key are otherwise hand-clicked in App Store Connect.
 *
 * The default `launch eu-distribution` reconciles the authorized **domains** from `eu-distribution.config.json`
 * with the same plan→confirm→apply / `--dry-run` flow as `launch sync`. The imperative subcommands cover
 * the team-level public key — a register-once action, not declarative state: `set-key <pem>` registers
 * the package-signing public key, and `list` shows the current domains and whether a key is registered.
 *
 * These are team-level resources, so there's no `--app` selection; everything acts on the active account's
 * team. The public key is the *public* half (not a secret), so it's read from a plain PEM file.
 */

import { readFileSync } from "node:fs";
import { cancel, confirm, isCancel } from "@clack/prompts";
import type { Command } from "commander";
import type { PlannedAction } from "../../core/ascSync.js";
import { AppStoreConnectClient } from "../../apple/ascClient.js";
import { loadActiveAscKey } from "../../core/accounts.js";
import { createLogger } from "../../core/logger.js";
import {
  loadEuDistributionConfig,
  reconcileEuDistributionDomains,
  summarizeEuDistribution,
} from "../../core/euDistribution.js";

/** CLI options for the default `launch eu-distribution` domain reconcile. */
interface EuDistributionOptions {
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
 * Render one action line: `✗` for a failure (with Apple's detail), `+` for a planned/applied change.
 * (Domain reconcile never skips, but the failed branch keeps the summary honest.) Exported for tests.
 */
export function renderAction(action: PlannedAction): string {
  if (action.status === "failed") return `✗ ${action.description}${action.error ? ` — ${action.error}` : ""}`;
  return `+ ${action.description}`;
}

/** The body of `launch eu-distribution`: plan domain authorizations, print, confirm, apply. */
async function runReconcile(options: EuDistributionOptions): Promise<void> {
  const log = createLogger(false);
  const config = loadEuDistributionConfig(options.config);
  const client = await activeClient();

  const plan = await reconcileEuDistributionDomains(client, config, true);

  log.gap();
  if (plan.length === 0) {
    log.step("eu-distribution", "distribution domains already authorized");
    return;
  }
  log.notice("EU alternative distribution", ...plan.map(renderAction));

  log.gap();
  log.info(`${plan.length} domain(s) to authorize.`);
  if (options.dryRun === true) {
    log.info("Dry run — no changes made. Re-run without --dry-run to apply.");
    return;
  }

  if (options.yes !== true) {
    if (!process.stdout.isTTY) {
      throw new Error("Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).");
    }
    const proceed = await confirm({ message: `Authorize ${plan.length} distribution domain(s)?` });
    if (isCancel(proceed) || !proceed) {
      cancel("Aborted — no changes made.");
      return;
    }
  }

  const applied = await reconcileEuDistributionDomains(client, config, false);
  const summary = summarizeEuDistribution(applied);
  const rows = applied.map((action) =>
    action.status === "failed" ? `✗ ${action.description} — ${action.error ?? "failed"}` : `✓ ${action.description}`,
  );
  log.box(summary.failed > 0 ? "Authorized with errors" : "Domains authorized", rows);
  if (summary.failed > 0) process.exitCode = 1;
}

/** Attach the `eu-distribution` command (domain reconcile) and its imperative subcommands to the program. */
export function registerEuDistributionCommand(program: Command): void {
  const eu = program
    .command("eu-distribution")
    .description("authorize EU alternative-distribution domains from eu-distribution.config.json (DMA)")
    .option("--config <path>", "path to the EU distribution config file", "eu-distribution.config.json")
    .option("--dry-run", "print the plan and exit, making no changes", false)
    .option("-y, --yes", "skip the confirmation prompt (for CI)", false)
    .action((options: EuDistributionOptions) => runReconcile(options));

  eu.command("set-key <pemPath>")
    .description("register the team's package-signing public key (the public half — a plain .pem file)")
    .action(async (pemPath: string) => {
      const log = createLogger(false);
      const publicKey = readFileSync(pemPath, "utf8").trim();
      if (!publicKey) throw new Error(`${pemPath} is empty — expected a PEM public key.`);
      const client = await activeClient();
      const existing = await client.listAlternativeDistributionKeys();
      if (existing.length > 0) {
        log.info(
          `A distribution key is already registered (id ${existing[0]?.id}). Delete it in App Store Connect to replace it.`,
        );
        return;
      }
      await client.createAlternativeDistributionKey(publicKey);
      log.step("eu-distribution", "registered the alternative-distribution public key");
    });

  eu.command("list")
    .description("show the team's authorized distribution domains and whether a key is registered")
    .action(async () => {
      const log = createLogger(false);
      const client = await activeClient();
      const [domains, keys] = await Promise.all([
        client.listAlternativeDistributionDomains(),
        client.listAlternativeDistributionKeys(),
      ]);
      log.notice(
        `EU alternative distribution — key ${keys.length > 0 ? "registered" : "not registered"}`,
        ...(domains.length > 0
          ? domains.map((entry) => `• ${entry.domain ?? "?"}${entry.referenceName ? ` (${entry.referenceName})` : ""}`)
          : ["• no domains authorized"]),
      );
    });
}
