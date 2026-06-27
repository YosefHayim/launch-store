/**
 * `launch release-config` — reconcile an app's App Store *release attributes* (age rating, App Store
 * categories, base price, App Review details) from a declarative `release.config.json`, using the App
 * Store Connect API key alone. It runs the same plan→confirm→apply flow as `launch sync`: a read-only
 * plan is printed, you confirm, then it applies. `--dry-run` stops after the plan; `--yes` skips the
 * prompt for CI.
 *
 * Thin glue over `core/releaseAttrs.ts`: this file resolves the account + app, loads the config, drives
 * the two passes, and renders the plan/summary. All diff logic and request shaping live in the core
 * module and the ASC client. It's a standalone command (not a `launch sync` subcommand) because the sync
 * orchestrator is owned by a parallel in-flight change and these app-level attributes are a separate
 * concern from the product catalog `sync` reconciles.
 */

import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import type { PlannedAction } from '../../core/ascSync.js';
import type { LaunchConfig } from '../../core/types.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { loadConfig, resolveSidecarConfig } from '../../core/config.js';
import { selectApp } from '../../core/pipeline.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { createLogger } from '../../core/logger.js';
import { summarize } from '../../core/asc/storeSync.js';
import { loadReleaseConfig, reconcileRelease } from '../../core/releaseAttrs.js';

/** CLI options for `launch release-config`. */
interface ReleaseConfigOptions {
  app?: string;
  config: string;
  dryRun?: boolean;
  yes?: boolean;
}

/** Build a client bound to the active Apple account, or fail with the onboarding hint. */
async function activeClient(): Promise<AppStoreConnectClient> {
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  return new AppStoreConnectClient(ascKey);
}

/** Resolve the selected app's iOS bundle id plus the loaded Launch config (for its typed config sections). */
async function resolveApp(
  appSelector: string | undefined,
): Promise<{ launchConfig: LaunchConfig; bundleId: string }> {
  const { config: launchConfig, apps } = await loadConfig();
  const app = await selectApp(apps, appSelector);
  if (!app.bundleId) {
    throw new Error(
      `No iOS bundle identifier for ${app.name} (set ios.bundleIdentifier in app.json).`,
    );
  }
  return { launchConfig, bundleId: app.bundleId };
}

/**
 * Render one action line: `•` for a skipped (can't-act-yet) area, `✗` for a failure (with Apple's
 * detail), `+` for a planned/applied change. Total over every {@link PlannedAction} status so an
 * apply-phase failure is never shown as a successful change. Exported for tests.
 */
export function renderAction(action: PlannedAction): string {
  if (action.status === 'skipped') return `• ${action.description}`;
  if (action.status === 'failed')
    return `✗ ${action.description}${action.error ? ` — ${action.error}` : ''}`;
  return `+ ${action.description}`;
}

/** Attach the `release-config` command to the program. */
export function registerReleaseConfigCommand(program: Command): void {
  program
    .command('release-config')
    .description(
      'reconcile App Store release attributes (age rating, categories, price, review details) from release.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the release config file', 'release.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (options: ReleaseConfigOptions, command: Command) => {
      const log = createLogger(false);
      const { launchConfig, bundleId } = await resolveApp(options.app);
      const config = resolveSidecarConfig({
        typed: launchConfig.releaseAttributes?.[bundleId],
        configPath: options.config,
        explicitPath: command.getOptionValueSource('config') === 'cli',
        load: loadReleaseConfig,
      });
      if (!config) {
        throw new Error(
          `No release attributes for ${bundleId}. Add a \`releaseAttributes\` entry to launch.config.ts or create ${options.config}.`,
        );
      }
      const client = await activeClient();

      const plan = await reconcileRelease(client, { bundleId, config, dryRun: true });
      const planned = plan.actions.filter((action) => action.status === 'planned');

      log.gap();
      if (plan.actions.length === 0) {
        log.step(bundleId, 'release attributes already in sync');
        return;
      }
      log.notice(bundleId, ...plan.actions.map(renderAction));

      if (planned.length === 0) {
        log.gap();
        log.step(
          'release-config',
          'nothing to apply (everything in sync; skipped areas need a version first)',
        );
        return;
      }

      log.gap();
      log.info(`${planned.length} change(s) for ${bundleId}.`);
      if (options.dryRun === true) {
        log.info('Dry run — no changes made. Re-run without --dry-run to apply.');
        return;
      }

      if (options.yes !== true) {
        if (!process.stdout.isTTY) {
          throw new Error(
            'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
          );
        }
        const proceed = await confirm({
          message: `Apply ${planned.length} change(s) to App Store Connect?`,
        });
        if (isCancel(proceed) || !proceed) {
          cancel('Aborted — no changes made.');
          return;
        }
      }

      const applied = await reconcileRelease(client, { bundleId, config, dryRun: false });
      const summary = summarize(applied.actions);
      const rows = applied.actions.map((action) => {
        if (action.status === 'failed')
          return `✗ ${action.description} — ${action.error ?? 'failed'}`;
        return `${action.status === 'skipped' ? '•' : '✓'} ${action.description}`;
      });
      log.box(summary.failed > 0 ? 'Applied with errors' : 'Applied', rows);
      if (summary.failed > 0) process.exitCode = 1;
    });
}
