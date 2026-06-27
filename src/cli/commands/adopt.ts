/**
 * `launch adopt` — onboard an app that already ships: pull its App Store Connect setup down into config.
 *
 * The read counterpart of `launch sync`. A developer who built their products, capabilities, signing, and
 * listing by hand (or via EAS) and then installs Launch runs this once to get a populated, reviewable
 * `launch.config.ts` (+ `app.json` entitlements + `store.config.json`), then drives everything forward
 * with `sync`. Thin glue over `core/adopt`: detect adoptable apps → collect every adopter's planned writes
 * → print the plan → confirm → apply. `--dry-run` stops after the plan; `--app` limits to named apps;
 * `--all` (the default when `--app` is omitted) adopts every discovered app; `--yes` skips the prompt for CI.
 *
 * See `docs/adr/0002-adopt-existing-app.md`.
 */

import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import type { AppDescriptor } from '../../core/types.js';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { detectAppRoot } from '../../core/configScaffold.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { registerBuiltinAdopters, listAdopters } from '../../core/adopt/registry.js';
import {
  applyAdopt,
  detectTargets,
  planTargets,
  type AdoptApplyResult,
  type TargetPlan,
} from '../../core/adopt/orchestrator.js';
import type { Fidelity } from '../../core/adopt/types.js';
import { pullAppleListing } from './metadata.js';

/** CLI options for `launch adopt`. */
interface AdoptOptions {
  /** Adopt every discovered app (the default when `--app` is omitted; explicit for clarity/CI). */
  all?: boolean;
  /** Comma-separated app handles to limit the run to. */
  app?: string;
  /** Print the plan and exit, importing nothing. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (for CI / non-interactive use). */
  yes?: boolean;
}

/** The leading glyph for a planned write, by fidelity: import / advisory / detect-only. */
function glyph(fidelity: Fidelity): string {
  switch (fidelity) {
    case 'importable':
      return '+';
    case 'advisory':
      return '~';
    case 'detect':
      return '•';
  }
}

/** Resolve the apps to adopt from discovery + the optional `--app` selector, erroring on an unknown name. */
function selectApps(apps: AppDescriptor[], selector: string | undefined): AppDescriptor[] {
  if (!selector) return apps;
  const wanted = selector
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const byName = new Map(apps.map((app) => [app.name, app]));
  return wanted.map((name) => {
    const app = byName.get(name);
    if (!app)
      throw new Error(
        `Unknown app "${name}". Discovered apps: ${apps.map((a) => a.name).join(', ') || 'none'}.`,
      );
    return app;
  });
}

/** How many of a plan's writes actually change a file (detect-only `keychain` reports don't). */
function mutationCount(plans: TargetPlan[]): number {
  return plans.reduce(
    (total, plan) => total + plan.writes.filter((write) => write.change.home !== 'keychain').length,
    0,
  );
}

/** Render one app's planned writes (and any adopter read errors) as a titled notice block. */
function renderPlan(log: ReturnType<typeof createLogger>, plan: TargetPlan): void {
  const lines: string[] = [];
  for (const write of plan.writes) {
    lines.push(`${glyph(write.fidelity)} ${write.description}`);
    if (write.note) lines.push(`    ↳ ${write.note}`);
  }
  for (const error of plan.errors) lines.push(`✗ ${error.domain}: ${error.message}`);
  if (lines.length === 0) lines.push('nothing to adopt');
  log.notice(
    `${plan.detected.target.app.name} (${plan.detected.target.bundleId}) · ${plan.detected.signal}`,
    ...lines,
  );
}

/** Render what `applyAdopt` changed, as a summary box plus paste-blocks for files we won't splice. */
function renderResult(
  log: ReturnType<typeof createLogger>,
  cwd: string,
  result: AdoptApplyResult,
): void {
  const rows: string[] = [];
  if (result.configWritten)
    rows.push(`✓ wrote ${relative(cwd, result.configWritten)} (review the imported products)`);
  for (const patched of result.appJsonPatched) {
    rows.push(
      `✓ ${patched.app}: added ${patched.added.length} entitlement(s) to ${relative(cwd, patched.configPath)}`,
    );
  }
  for (const pulled of result.listingsPulled)
    rows.push(`✓ ${pulled}: pulled App Store listing → store.config.json`);
  for (const failed of result.listingErrors)
    rows.push(`✗ ${failed.app}: listing pull failed — ${failed.message}`);
  if (rows.length > 0)
    log.box(result.listingErrors.length > 0 ? 'Adopted with errors' : 'Adopted', rows);

  if (result.configBlock) {
    log.notice(
      'launch.config.ts already exists — add this `products` block, then run `launch sync`:',
      result.configBlock,
    );
  }
  for (const block of result.appJsonBlocks) {
    log.notice(
      `${block.app}: ${relative(cwd, block.configPath)} is dynamic — paste this into your config:`,
      block.block,
    );
  }
  if (result.listingErrors.length > 0) process.exitCode = 1;
}

/**
 * Run the full adopt flow. Exported so the wizard's "Adopt an existing app" path runs the same code as
 * the `launch adopt` command (no second copy of the detect/plan/apply logic).
 */
export async function runAdopt(options: AdoptOptions): Promise<void> {
  const log = createLogger(false);
  const { apps } = await loadConfig();
  const selected = selectApps(apps, options.app);
  if (selected.length === 0) {
    log.info('No apps discovered. Run `launch init` (or check your appRoots) first.');
    return;
  }

  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  const client = new AppStoreConnectClient(ascKey);

  const cwd = process.cwd();
  const hasLaunchConfig = existsSync(join(cwd, 'launch.config.ts'));
  registerBuiltinAdopters();

  const detection = await detectTargets(client, selected, {
    keyId: ascKey.keyId,
    cwd,
    hasLaunchConfig,
  });
  if (detection.skipped.length > 0) {
    log.notice('Skipped', ...detection.skipped.map((skip) => `• ${skip.app.name}: ${skip.reason}`));
  }
  if (detection.detected.length === 0) {
    log.info(
      'No adoptable apps — none of the discovered apps have an App Store Connect record yet.',
    );
    return;
  }

  const plans = await planTargets(client, detection, listAdopters());
  log.gap();
  for (const plan of plans) renderPlan(log, plan);

  const changes = mutationCount(plans);
  log.gap();
  if (changes === 0) {
    log.info('Nothing to import — the detect-only findings above need no config changes.');
    return;
  }
  log.info(`${changes} import(s) across ${plans.length} app(s).`);

  if (options.dryRun === true) {
    log.info('Dry run — nothing imported. Re-run without --dry-run to apply.');
    return;
  }

  if (options.yes !== true) {
    if (!process.stdout.isTTY) {
      throw new Error(
        'Refusing to import without confirmation. Re-run with --yes (or --dry-run to preview).',
      );
    }
    const proceed = await confirm({
      message: `Import ${changes} change(s) into your local config?`,
    });
    if (isCancel(proceed) || !proceed) {
      cancel('Aborted — nothing imported.');
      return;
    }
  }

  const result = await applyAdopt(plans, {
    cwd,
    hasLaunchConfig,
    appRoot: detectAppRoot(selected, cwd),
    pullListing: (bundleId, configPath) => pullAppleListing(bundleId, configPath, false),
  });
  log.gap();
  renderResult(log, cwd, result);
}

/** Attach the `adopt` command to the program. */
export function registerAdoptCommand(program: Command): void {
  program
    .command('adopt')
    .description(
      'onboard an app that already ships: import its App Store Connect setup into config',
    )
    .option('--all', 'adopt every discovered app (the default when --app is omitted)', false)
    .option(
      '-a, --app <names>',
      'comma-separated app handles to adopt (default: all discovered apps)',
    )
    .option('--dry-run', 'print the plan and exit, importing nothing', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (options: AdoptOptions) => {
      await runAdopt(options);
    });
}
