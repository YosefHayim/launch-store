/**
 * `launch app-clips` — reconcile an app's **App Clip card** metadata (the default experience's action and
 * per-locale subtitle) from a declarative `appclips.config.json`, using the App Store Connect API key
 * alone. Same plan→confirm→apply flow as `launch release-config` / `launch sync`: a read-only plan is
 * printed, you confirm, then it applies. `--dry-run` stops after the plan; `--yes` skips the prompt for CI.
 *
 * Thin glue over `core/appClips.ts`: this file resolves the account + app, loads the config, drives the
 * two passes, and renders the plan/summary — all diff logic and request shaping live in the core module
 * and the ASC client. It's a standalone command (not a `launch sync` subcommand) because the sync
 * orchestrator is owned separately and App Clips are a distinct, opt-in concern.
 *
 * Scope: the App Clip card image is a separate asset upload and is intentionally out of scope here; this
 * command manages the card's text (subtitle) and its call-to-action. App Clips are read-only via the API
 * (created by a build with an App Clip target), so a clip the build hasn't produced yet is reported as
 * skipped rather than created.
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
import { loadAppClipsConfig, reconcileAppClips } from '../../core/appClips.js';

/** CLI options for `launch app-clips`. */
interface AppClipsOptions {
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

/** Attach the `app-clips` command to the program. */
export function registerAppClipsCommand(program: Command): void {
  program
    .command('app-clips')
    .description(
      'reconcile App Clip card metadata (action, per-locale subtitle) from appclips.config.json',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--config <path>', 'path to the App Clips config file', 'appclips.config.json')
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action(async (options: AppClipsOptions, command: Command) => {
      const log = createLogger(false);
      const { launchConfig, bundleId } = await resolveApp(options.app);
      const config = resolveSidecarConfig({
        typed: launchConfig.appClips?.[bundleId],
        configPath: options.config,
        explicitPath: command.getOptionValueSource('config') === 'cli',
        load: loadAppClipsConfig,
      });
      if (!config) {
        throw new Error(
          `No App Clips config for ${bundleId}. Add an \`appClips\` entry to launch.config.ts or create ${options.config}.`,
        );
      }
      const client = await activeClient();

      const plan = await reconcileAppClips(client, { bundleId, config, dryRun: true });
      const planned = plan.actions.filter((action) => action.status === 'planned');

      log.gap();
      if (plan.actions.length === 0) {
        log.step(bundleId, 'App Clip cards already in sync');
        return;
      }
      log.notice(bundleId, ...plan.actions.map(renderAction));

      if (planned.length === 0) {
        log.gap();
        log.step(
          'app-clips',
          'nothing to apply (everything in sync; skipped clips need a build or version first)',
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
          message: `Apply ${planned.length} App Clip change(s) to App Store Connect?`,
        });
        if (isCancel(proceed) || !proceed) {
          cancel('Aborted — no changes made.');
          return;
        }
      }

      const applied = await reconcileAppClips(client, { bundleId, config, dryRun: false });
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
