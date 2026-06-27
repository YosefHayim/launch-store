/**
 * `launch offers` — config-as-code subscription offers + promoted-purchase ordering, via the App Store
 * Connect API key alone (no portal clicking, no 2FA). Fills the monetization gap EAS leaves entirely:
 * `eas` ships binaries but never touches offer codes, promotional/introductory/win-back offers, or which
 * products are promoted on the App Store product page.
 *
 * The default `launch offers` reconciles the declared offers (under each subscription in `products`) and
 * the promoted-purchase order, with the same plan → confirm → apply / `--dry-run` flow as `launch sync`:
 * a read-only plan lists every offer/price/reorder write, you confirm, then it applies. The imperative
 * subcommands cover the actions that aren't declarative state — generating redeemable codes under an
 * existing campaign, listing them, and deactivating one.
 */

import { cancel, confirm, isCancel } from '@clack/prompts';
import type { Command } from 'commander';
import type { AppDescriptor, AppProducts } from '../../core/types.js';
import { loadConfig } from '../../core/config.js';
import { createLogger } from '../../core/logger.js';
import { loadActiveAscKey } from '../../core/accounts.js';
import { runPool } from '../../core/asyncPool.js';
import { AppStoreConnectClient } from '../../apple/ascClient.js';
import { reconcileOffers, type ReconcileOffersInput } from '../../core/offers.js';
import type { ReconcileReport } from '../../core/ascSync.js';

/** How many apps reconcile concurrently — bounded so the single ASC key stays under Apple's rate ceiling. */
const OFFERS_CONCURRENCY = 4;

/** CLI options for the default `launch offers` reconcile. */
interface OffersOptions {
  /** Comma-separated app handles to limit the run to. Omit to reconcile every app with offers declared. */
  app?: string;
  /** Show the plan and exit, making no changes. */
  dryRun?: boolean;
  /** Skip the confirmation prompt (for CI / non-interactive use). */
  yes?: boolean;
}

/** Options shared by the imperative subcommands that act on one app. */
interface AppScopedOptions {
  /** App handle to act on; required only when the project defines more than one app. */
  app?: string;
}

/** Whether an app's product catalog declares any offer or promoted purchase worth reconciling. */
function hasOffersWork(products: AppProducts | undefined): boolean {
  if (!products) return false;
  if ((products.promotedPurchases?.length ?? 0) > 0) return true;
  return (products.subscriptionGroups ?? []).some((group) =>
    group.subscriptions.some(
      (sub) =>
        (sub.offerCodes?.length ?? 0) > 0 ||
        (sub.promotionalOffers?.length ?? 0) > 0 ||
        (sub.introductoryOffers?.length ?? 0) > 0 ||
        (sub.winBackOffers?.length ?? 0) > 0,
    ),
  );
}

/** Resolve the apps to act on from discovery + an optional comma-separated selector, erroring on unknowns. */
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
        `Unknown app "${name}". Discovered: ${apps.map((a) => a.name).join(', ') || 'none'}.`,
      );
    return app;
  });
}

/** Pick the single app an imperative subcommand targets (explicit `--app`, else the only one), or error. */
function pickApp(apps: AppDescriptor[], selector: string | undefined): AppDescriptor {
  const withBundle = apps.filter((app) => app.bundleId);
  if (selector) {
    const match = withBundle.find((app) => app.name === selector);
    if (!match)
      throw new Error(
        `Unknown app "${selector}". Discovered: ${withBundle.map((a) => a.name).join(', ')}.`,
      );
    return match;
  }
  if (withBundle.length === 1 && withBundle[0]) return withBundle[0];
  throw new Error(
    `Several apps found — pass --app <name> (one of: ${withBundle.map((a) => a.name).join(', ')}).`,
  );
}

/** One app's reconcile outcome — its job plus the report, or a precondition error that skipped it. */
type JobOutcome =
  | { app: AppDescriptor; report: ReconcileReport }
  | { app: AppDescriptor; error: string };

/** Reconcile one app's offers, never throwing: a precondition failure becomes `{ error }` for the pool. */
async function reconcileJob(
  client: AppStoreConnectClient,
  app: AppDescriptor,
  products: AppProducts,
  dryRun: boolean,
): Promise<JobOutcome> {
  try {
    const input: ReconcileOffersInput = { bundleId: app.bundleId ?? '', products, dryRun };
    const report = await reconcileOffers(client, input);
    return { app, report };
  } catch (error) {
    return { app, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Tally a report's action statuses for the run summary. */
function summarize(report: ReconcileReport): { applied: number; failed: number; skipped: number } {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of report.actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
}

/** The body of `launch offers`: plan all apps, print, confirm, apply. Mirrors `launch sync`'s flow. */
async function runReconcile(options: OffersOptions): Promise<void> {
  const log = createLogger(false);
  const { config, apps } = await loadConfig();
  const jobs = selectApps(apps, options.app).flatMap((app) => {
    const products = app.bundleId ? config.products?.[app.bundleId] : undefined;
    return app.bundleId && hasOffersWork(products) && products ? [{ app, products }] : [];
  });

  if (jobs.length === 0) {
    log.info(
      'Nothing to reconcile — no app declares offers or promoted purchases. Add them under `products`.',
    );
    return;
  }

  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  const client = new AppStoreConnectClient(ascKey);

  const planResults = await runPool(jobs, OFFERS_CONCURRENCY, (job) =>
    reconcileJob(client, job.app, job.products, true),
  );
  const plans = planResults.flatMap((result) => (result.ok ? [result.value] : []));

  let mutationCount = 0;
  let planErrors = 0;
  log.gap();
  for (const plan of plans) {
    if ('error' in plan) {
      planErrors++;
      log.error(`${plan.app.name} (${plan.app.bundleId ?? '?'}): ${plan.error}`);
      continue;
    }
    const { actions } = plan.report;
    mutationCount += actions.filter((action) => action.status === 'planned').length;
    if (actions.length === 0) {
      log.step(plan.app.name, 'offers already in sync');
      continue;
    }
    log.notice(
      `${plan.app.name} (${plan.app.bundleId ?? '?'})`,
      ...actions.map((action) =>
        action.status === 'skipped' ? `• ${action.description}` : `+ ${action.description}`,
      ),
    );
  }

  if (mutationCount === 0) {
    log.gap();
    if (planErrors > 0) {
      log.error(`${planErrors} app(s) could not be planned (see above).`);
      process.exitCode = 1;
    } else {
      log.step('offers', 'everything is already in sync');
    }
    return;
  }

  log.gap();
  log.info(`${mutationCount} change(s) across ${jobs.length} app(s).`);
  if (options.dryRun === true) {
    log.info('Dry run — no changes made. Re-run without --dry-run to apply.');
    if (planErrors > 0) process.exitCode = 1;
    return;
  }

  if (options.yes !== true) {
    if (!process.stdout.isTTY) {
      throw new Error(
        'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
      );
    }
    const proceed = await confirm({
      message: `Apply ${mutationCount} offer change(s) to App Store Connect?`,
    });
    if (isCancel(proceed) || !proceed) {
      cancel('Aborted — no changes made.');
      return;
    }
  }

  const toApply = plans.flatMap((plan) =>
    'report' in plan && plan.report.actions.some((action) => action.status === 'planned')
      ? [plan]
      : [],
  );
  const applyResults = await runPool(toApply, OFFERS_CONCURRENCY, (plan) =>
    reconcileJob(client, plan.app, jobs.find((job) => job.app === plan.app)?.products ?? {}, false),
  );
  const applied = applyResults.flatMap((result) => (result.ok ? [result.value] : []));

  let failures = planErrors;
  const rows: string[] = [];
  for (const outcome of applied) {
    if ('error' in outcome) {
      failures++;
      rows.push(`✗ ${outcome.app.name}: ${outcome.error}`);
      continue;
    }
    const summary = summarize(outcome.report);
    failures += summary.failed;
    rows.push(
      `${summary.failed > 0 ? '✗' : '✓'} ${outcome.app.name}: ${summary.applied} applied, ${summary.failed} failed, ${summary.skipped} skipped`,
    );
    for (const action of outcome.report.actions) {
      if (action.status === 'failed')
        rows.push(`    ✗ ${action.description} — ${action.error ?? 'failed'}`);
    }
  }
  log.box(failures > 0 ? 'Offers synced with errors' : 'Offers synced', rows);
  if (failures > 0) process.exitCode = 1;
}

/** Resolve a client + the ASC subscription id for one product, for the imperative subcommands. */
async function resolveSubscription(
  options: AppScopedOptions,
  productId: string,
): Promise<{ client: AppStoreConnectClient; appName: string; subscriptionId: string }> {
  const { apps } = await loadConfig();
  const app = pickApp(apps, options.app);
  const ascKey = await loadActiveAscKey();
  if (!ascKey) throw new Error('No active Apple account. Run `launch creds set-key` first.');
  const client = new AppStoreConnectClient(ascKey);
  const appId = await client.getAppId(app.bundleId ?? '');
  if (!appId) throw new Error(`No App Store Connect app record for ${app.bundleId ?? app.name}.`);
  for (const group of await client.listSubscriptionGroups(appId)) {
    const sub = (await client.listSubscriptions(group.id)).find(
      (entry) => entry.productId === productId,
    );
    if (sub) return { client, appName: app.name, subscriptionId: sub.id };
  }
  throw new Error(`No subscription ${productId} in App Store Connect for ${app.name}.`);
}

/** Attach the `offers` command (reconcile) and its imperative subcommands to the program. */
export function registerOffersCommand(program: Command): void {
  const offers = program
    .command('offers')
    .description(
      'reconcile subscription offers (codes, promo/intro/win-back) and promoted-purchase order from config',
    )
    .option(
      '-a, --app <names>',
      'comma-separated app handles (default: all apps with offers declared)',
    )
    .option('--dry-run', 'print the plan and exit, making no changes', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((options: OffersOptions) => runReconcile(options));

  offers
    .command('generate-codes <productId> <offerName>')
    .description('generate redeemable codes under an existing offer-code campaign')
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .option('-n, --count <number>', 'how many codes to generate', '100')
    .option('-e, --expires <date>', 'expiration date (YYYY-MM-DD); required for one-time-use codes')
    .option(
      '--custom <code>',
      'create one shareable custom code with this value instead of one-time-use codes',
    )
    .action(
      async (
        productId: string,
        offerName: string,
        options: AppScopedOptions & { count: string; expires?: string; custom?: string },
      ) => {
        const log = createLogger(false);
        const count = Number.parseInt(options.count, 10);
        if (!Number.isInteger(count) || count < 1)
          throw new Error('--count must be a positive integer.');
        const { client, appName, subscriptionId } = await resolveSubscription(options, productId);
        const code = (await client.listSubscriptionOfferCodes(subscriptionId)).find(
          (entry) => entry.name === offerName,
        );
        if (!code)
          throw new Error(`No offer code named "${offerName}" on ${productId} (${appName}).`);

        if (options.custom !== undefined) {
          await client.createOfferCodeCustomCode(code.id, options.custom, count, options.expires);
          log.step(
            'offers',
            `created custom code "${options.custom}" (${count} uses) on "${offerName}"`,
          );
          return;
        }
        if (!options.expires)
          throw new Error('One-time-use codes need an expiration date: --expires YYYY-MM-DD.');
        await client.createOfferCodeOneTimeUseBatch(code.id, count, options.expires);
        log.step(
          'offers',
          `generated ${count} one-time-use code(s) on "${offerName}" (expire ${options.expires})`,
        );
      },
    );

  offers
    .command('list <productId>')
    .description("list a subscription's offer-code campaigns and their states")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action(async (productId: string, options: AppScopedOptions) => {
      const log = createLogger(false);
      const { client, appName, subscriptionId } = await resolveSubscription(options, productId);
      const codes = await client.listSubscriptionOfferCodes(subscriptionId);
      if (codes.length === 0) {
        log.info(`No offer codes on ${productId} (${appName}).`);
        return;
      }
      log.notice(
        `Offer codes — ${productId} (${appName})`,
        ...codes.map(
          (code) => `${code.active ? '●' : '○'} ${code.name}${code.active ? '' : ' (inactive)'}`,
        ),
      );
    });

  offers
    .command('deactivate <productId> <offerName>')
    .description("deactivate an offer-code campaign (its terms can't be edited, only switched off)")
    .option('-a, --app <name>', 'app handle (default: the only app)')
    .action(async (productId: string, offerName: string, options: AppScopedOptions) => {
      const log = createLogger(false);
      const { client, appName, subscriptionId } = await resolveSubscription(options, productId);
      const code = (await client.listSubscriptionOfferCodes(subscriptionId)).find(
        (entry) => entry.name === offerName,
      );
      if (!code)
        throw new Error(`No offer code named "${offerName}" on ${productId} (${appName}).`);
      await client.deactivateOfferCode(code.id);
      log.step('offers', `deactivated offer code "${offerName}" on ${productId}`);
    });
}
