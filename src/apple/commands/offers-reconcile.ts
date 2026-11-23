// Syncs subscription offers and promoted-purchase order to App Store Connect.

import { loadConfig } from '@/config/config.js';
import type { AppStoreConnect } from '../app-store-connect.ts';
import { createLogger } from '@/services/platform/logger.js';
import { readLaunchDirectories } from '@/services/platform/paths.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import { checkTerminalIsInteractive } from '@/services/platform/progress.js';
import type { AppDescriptor } from '@/types/app.js';
import type { AppProducts } from '@/types/catalog.js';
import type { PlannedAction, ReconcileReport } from '@/types/reconcile.js';
import { loadActiveAppleStore } from './apple-store-command.ts';
import { appDeclaresOffers, reconcileOffers } from '@/apple/store/offers.js';
import { summarize } from '@/store/shared/reconcile.js';
import type { OffersReconcileInput } from './offers-command.ts';
import { offersFailure } from './offers-subscription.ts';

type OffersJob = Readonly<{
  readonly app: AppDescriptor;
  readonly bundleId: string;
  readonly products: AppProducts;
}>;

type OffersJobOutcome =
  | Readonly<{
      readonly _tag: 'OffersJobSucceeded';
      readonly job: OffersJob;
      readonly report: ReconcileReport;
    }>
  | Readonly<{
      readonly _tag: 'OffersJobFailed';
      readonly job: OffersJob;
      readonly message: string;
    }>;

/** Whether one product catalog declares offers or promoted-purchase ordering. */
export function hasOffersWork(products: AppProducts | undefined): boolean {
  if (products == null) {
    return false;
  }

  return appDeclaresOffers(products);
}

/** Render one offer action with stable ASCII markers. */
export function renderOfferAction(plannedAction: PlannedAction): string {
  switch (plannedAction.status) {
    case 'skipped':
      return `- ${plannedAction.description}`;
    case 'failed': {
      let failureText = 'failed';
      const actionError = plannedAction.error;

      const hasActionError = actionError != null;

      if (hasActionError) {
        failureText = actionError;
      }

      return `x ${plannedAction.description} - ${failureText}`;
    }
    case 'planned':
    case 'applied':
      return `+ ${plannedAction.description}`;
  }
}

function trimAppName(appName: string): string {
  return appName.trim();
}

function isPresentName(appName: string): boolean {
  return appName.length > 0;
}

function readAppName(discoveredApp: AppDescriptor): string {
  return discoveredApp.name;
}

/** Select all apps or a comma-separated subset. */
function selectOffersApps(apps: AppDescriptor[], appSelector: string | undefined): AppDescriptor[] {
  if (appSelector == null) {
    return apps;
  }

  const isBlankSelector = appSelector.length == 0;

  if (isBlankSelector) {
    return apps;
  }

  const requestedNames = appSelector.split(',').map(trimAppName).filter(isPresentName);
  const appsByName = new Map<string, AppDescriptor>();

  for (const discoveredApp of apps) {
    appsByName.set(discoveredApp.name, discoveredApp);
  }

  const selectedApps: AppDescriptor[] = [];

  for (const requestedName of requestedNames) {
    const selectedApp = appsByName.get(requestedName);

    const isUnknownApp = selectedApp == null;

    if (isUnknownApp) {
      let discoveredNames = apps.map(readAppName).join(', ');
      const hasDiscoveredNames = discoveredNames.length > 0;

      if (hasDiscoveredNames == false) {
        discoveredNames = 'none';
      }

      throw offersFailure(
        'select offers apps',
        requestedName,
        `Unknown app "${requestedName}". Discovered: ${discoveredNames}.`,
      );
    }

    selectedApps.push(selectedApp);
  }

  return selectedApps;
}

/** Build runnable offer jobs from discovered apps and their bundle-keyed catalogs. */
async function resolveOffersJobs(appSelector: string | undefined): Promise<OffersJob[]> {
  const launchPaths = readLaunchDirectories();
  let loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>;

  try {
    loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  } catch (cause) {
    throw offersFailure('load offers configuration', cause);
  }

  const selectedApps = selectOffersApps(loadedConfiguration.apps, appSelector);
  const offersJobs: OffersJob[] = [];

  for (const selectedApp of selectedApps) {
    const bundleId = selectedApp.bundleId;

    const isBundleMissing = bundleId == null;

    if (isBundleMissing) {
      continue;
    }

    const productCatalog = loadedConfiguration.config.products;

    const isCatalogMissing = productCatalog == null;

    if (isCatalogMissing) {
      continue;
    }

    const appProducts = productCatalog[bundleId];

    const isProductsMissing = appProducts == null;

    if (isProductsMissing) {
      continue;
    }

    const declaresOffers = hasOffersWork(appProducts);

    if (declaresOffers == false) {
      continue;
    }

    offersJobs.push({ app: selectedApp, bundleId, products: appProducts });
  }

  return offersJobs;
}

/** Reconcile one app while keeping its failure isolated from concurrent jobs. */
async function reconcileOffersJob(
  appleStore: AppStoreConnect,
  offersJob: OffersJob,
  dryRun: boolean,
): Promise<OffersJobOutcome> {
  try {
    const reconcileReport = await reconcileOffers(appleStore, {
      bundleId: offersJob.bundleId,
      products: offersJob.products,
      dryRun,
    });

    return { _tag: 'OffersJobSucceeded', job: offersJob, report: reconcileReport };
  } catch (cause) {
    return {
      _tag: 'OffersJobFailed',
      job: offersJob,
      message: offersFailure('reconcile app offers', cause).message,
    };
  }
}

/** Confirm an App Store Connect write unless --yes was supplied. */
async function confirmOffersWrite(mutationCount: number, assumeYes: boolean): Promise<boolean> {
  const skipsConfirmation = assumeYes == true;

  if (skipsConfirmation) {
    return true;
  }

  const isInteractive = checkTerminalIsInteractive();

  if (isInteractive == false) {
    throw offersFailure(
      'confirm offers write',
      'confirmation-required',
      'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
    );
  }

  let confirmed = false;

  try {
    confirmed = await new LaunchPrompt().confirm(
      `Apply ${mutationCount} offer change(s) to App Store Connect?`,
    );
  } catch (cause) {
    throw offersFailure('confirm offers write', cause);
  }

  if (confirmed) {
    return true;
  }

  new LaunchPrompt().cancel('Aborted - no changes made.');

  return false;
}

async function runWithConcurrency<Member, Mapped>(
  members: readonly Member[],
  concurrency: number,
  convertItem: (member: Member) => Promise<Mapped>,
): Promise<Mapped[]> {
  const mappedMembers: Mapped[] = new Array(members.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < members.length) {
      const memberIndex = nextIndex;

      nextIndex += 1;

      const member = members[memberIndex];

      const isMemberMissing = member == null;

      if (isMemberMissing) {
        continue;
      }

      mappedMembers[memberIndex] = await convertItem(member);
    }
  }

  const workerCount = Math.min(concurrency, members.length);
  const workers: Promise<void>[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const worker = runWorker();
    workers.push(worker);
  }

  await Promise.all(workers);

  return mappedMembers;
}

function countPlannedActions(plannedActions: readonly PlannedAction[]): number {
  let plannedCount = 0;

  for (const plannedAction of plannedActions) {
    const isPlanned = plannedAction.status == 'planned';

    if (isPlanned) {
      plannedCount += 1;
    }
  }

  return plannedCount;
}

function hasPlannedAction(plannedActions: readonly PlannedAction[]): boolean {
  for (const plannedAction of plannedActions) {
    const isPlanned = plannedAction.status == 'planned';

    if (isPlanned) {
      return true;
    }
  }

  return false;
}

/** Plan, confirm, and apply declared offers across selected apps. */
export async function executeOffersReconcile(commandInput: OffersReconcileInput): Promise<number> {
  try {
    const logger = createLogger(false);
    const offersJobs = await resolveOffersJobs(commandInput.app);

    const hasNoJobs = offersJobs.length == 0;

    if (hasNoJobs) {
      logger.note(
        'Nothing to reconcile - no app declares offers or promoted purchases. Add them under `products`.',
      );
      return 0;
    }

    let appleStore: AppStoreConnect;

    try {
      appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw offersFailure('load App Store Connect client', cause);
    }

    const offerJobConcurrency = 4;

    async function planOffersJob(offersJob: OffersJob): Promise<OffersJobOutcome> {
      return reconcileOffersJob(appleStore, offersJob, true);
    }

    const planOutcomes = await runWithConcurrency(offersJobs, offerJobConcurrency, planOffersJob);
    let mutationCount = 0;
    let planFailureCount = 0;

    logger.gap();

    for (const planOutcome of planOutcomes) {
      const isPlanFailed = planOutcome._tag == 'OffersJobFailed';

      if (isPlanFailed) {
        planFailureCount += 1;
        logger.error(
          `${planOutcome.job.app.name} (${planOutcome.job.bundleId}): ${planOutcome.message}`,
        );

        continue;
      }

      const plannedActions = planOutcome.report.actions;

      mutationCount += countPlannedActions(plannedActions);

      const isAlreadyInSync = plannedActions.length == 0;

      if (isAlreadyInSync) {
        logger.step(planOutcome.job.app.name, 'offers already in sync');
        continue;
      }

      const actionLines: string[] = [];

      for (const plannedAction of plannedActions) {
        const offerAction = renderOfferAction(plannedAction);
        actionLines.push(offerAction);
      }

      logger.notice(`${planOutcome.job.app.name} (${planOutcome.job.bundleId})`, ...actionLines);
    }

    const hasNoMutations = mutationCount == 0;

    if (hasNoMutations) {
      logger.gap();

      const hasPlanFailures = planFailureCount > 0;

      if (hasPlanFailures) {
        logger.error(`${planFailureCount} app(s) could not be planned (see above).`);
        return planFailureCount;
      }

      logger.step('offers', 'everything is already in sync');

      return 0;
    }

    logger.gap();
    logger.note(`${mutationCount} change(s) across ${offersJobs.length} app(s).`);

    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return planFailureCount;
    }

    const confirmed = await confirmOffersWrite(mutationCount, commandInput.yes);

    if (confirmed == false) {
      return planFailureCount;
    }

    const jobsToApply: OffersJob[] = [];

    for (const planOutcome of planOutcomes) {
      const isPlanFailed = planOutcome._tag == 'OffersJobFailed';

      if (isPlanFailed) {
        continue;
      }

      const shouldApply = hasPlannedAction(planOutcome.report.actions);

      if (shouldApply) {
        jobsToApply.push(planOutcome.job);
      }
    }

    async function applyOffersJob(offersJob: OffersJob): Promise<OffersJobOutcome> {
      return reconcileOffersJob(appleStore, offersJob, false);
    }

    const applyOutcomes = await runWithConcurrency(
      jobsToApply,
      offerJobConcurrency,
      applyOffersJob,
    );
    let failureCount = planFailureCount;
    const receiptLines: string[] = [];

    for (const applyOutcome of applyOutcomes) {
      const isApplyFailed = applyOutcome._tag == 'OffersJobFailed';

      if (isApplyFailed) {
        failureCount += 1;
        receiptLines.push(`x ${applyOutcome.job.app.name}: ${applyOutcome.message}`);
        continue;
      }

      const offersSummary = summarize(applyOutcome.report.actions);

      failureCount += offersSummary.failed;

      let receiptStatus = 'OK';

      const hasFailedActions = offersSummary.failed > 0;

      if (hasFailedActions) {
        receiptStatus = 'x';
      }

      receiptLines.push(
        `${receiptStatus} ${applyOutcome.job.app.name}: ${offersSummary.applied} applied, ${offersSummary.failed} failed, ${offersSummary.skipped} skipped`,
      );

      for (const appliedAction of applyOutcome.report.actions) {
        const isFailedAction = appliedAction.status == 'failed';

        if (isFailedAction == false) {
          continue;
        }

        let failureText = 'failed';
        const actionError = appliedAction.error;

        const hasActionError = actionError != null;

        if (hasActionError) {
          failureText = actionError;
        }

        receiptLines.push(`    x ${appliedAction.description} - ${failureText}`);
      }
    }

    let receiptTitle = 'Offers synced';

    const hasFailures = failureCount > 0;

    if (hasFailures) {
      receiptTitle = 'Offers synced with errors';
    }

    logger.box(receiptTitle, receiptLines);

    return failureCount;
  } catch (cause) {
    throw offersFailure('reconcile offers', cause);
  }
}
