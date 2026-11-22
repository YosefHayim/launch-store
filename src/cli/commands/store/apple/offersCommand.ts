import { loadConfig } from '@/config/config.js';
import type { AppStoreConnectClient } from '@/apple/ascClient.js';
import { errorMessage } from '@/services/platform/errorMessage.js';
import { createLogger } from '@/services/platform/logger.js';
import { readLaunchDirectories } from '@/services/platform/paths.js';
import { LaunchPrompt } from '@/services/platform/prompt.js';
import { checkTerminalIsInteractive } from '@/services/platform/progress.js';
import { completeCommand } from '@/terminal/commandExit.js';
import type { AppDescriptor } from '@/types/app.js';
import type { AppProducts } from '@/types/catalog.js';
import type { OfferCodeResource } from '@/types/appleCatalog.js';
import type { PlannedAction, ReconcileReport } from '@/types/reconcile.js';
import { loadActiveAppleStore } from './appleStoreCommand.js';
import { appDeclaresOffers, reconcileOffers } from '@/store/apple/offers.js';
import { summarize } from '@/store/shared/reconcile.js';

export type OffersReconcileInput = {
  operation: 'reconcile';
  app?: string;
  dryRun: boolean;
  yes: boolean;
};

export type OffersGenerateCodesInput = {
  operation: 'generate-codes';
  productId: string;
  offerName: string;
  app?: string;
  count: string;
  expires?: string;
  custom?: string;
};

export type OffersListInput = {
  operation: 'list';
  productId: string;
  app?: string;
};

export type OffersDeactivateInput = {
  operation: 'deactivate';
  productId: string;
  offerName: string;
  app?: string;
};

type OffersCommandInput =
  | OffersReconcileInput
  | OffersGenerateCodesInput
  | OffersListInput
  | OffersDeactivateInput;

/** An offers command step failed. */
type OffersCommandFailure = Readonly<{
  readonly _tag: 'OffersCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeOffersCommandFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): OffersCommandFailure {
  return { _tag: 'OffersCommandFailure', ...fields };
}

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

type ResolvedSubscription = Readonly<{
  readonly appleStore: AppStoreConnectClient;
  readonly appName: string;
  readonly subscriptionId: string;
}>;

type AppleAppChoice = Readonly<{ app: AppDescriptor; bundleId: string }>;

function readCommandRecord(rawCommandInput: unknown): Record<string, unknown> {
  if (rawCommandInput == null) {
    throw new Error('Offers command input must be an object.');
  }

  const isObject = typeof rawCommandInput == 'object';

  if (isObject == false) {
    throw new Error('Offers command input must be an object.');
  }

  const isArray = Array.isArray(rawCommandInput);

  if (isArray) {
    throw new Error('Offers command input must be an object.');
  }

  return rawCommandInput as Record<string, unknown>;
}

function readRequiredString(record: Record<string, unknown>, field: string): string {
  const fieldText = record[field];
  const isString = typeof fieldText == 'string';

  if (isString == false) {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return fieldText;
}

function readRequiredBoolean(record: Record<string, unknown>, field: string): boolean {
  const fieldFlag = record[field];
  const isBoolean = typeof fieldFlag == 'boolean';

  if (isBoolean == false) {
    throw new Error(`Expected ${field} to be a boolean.`);
  }

  return fieldFlag;
}

function readExactOptionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const hasField = Object.hasOwn(record, field);

  if (hasField == false) {
    return undefined;
  }

  const fieldText = record[field];
  const isString = typeof fieldText == 'string';

  if (isString == false) {
    throw new Error(`Expected ${field} to be a string.`);
  }

  return fieldText;
}

function optionalApp(record: Record<string, unknown>): { app?: string } {
  const appName = readExactOptionalString(record, 'app');
  const hasAppName = appName != null;

  if (hasAppName == false) {
    return {};
  }

  return { app: appName };
}

function decodeOffersReconcile(record: Record<string, unknown>): OffersReconcileInput {
  return {
    operation: 'reconcile',
    ...optionalApp(record),
    dryRun: readRequiredBoolean(record, 'dryRun'),
    yes: readRequiredBoolean(record, 'yes'),
  };
}

function optionalText(
  record: Record<string, unknown>,
  field: 'expires' | 'custom',
): {
  expires?: string;
  custom?: string;
} {
  const fieldText = readExactOptionalString(record, field);
  const hasFieldText = fieldText != null;

  if (hasFieldText == false) {
    return {};
  }

  if (field == 'expires') {
    return { expires: fieldText };
  }

  return { custom: fieldText };
}

function decodeOffersGenerateCodes(record: Record<string, unknown>): OffersGenerateCodesInput {
  return {
    operation: 'generate-codes',
    productId: readRequiredString(record, 'productId'),
    offerName: readRequiredString(record, 'offerName'),
    count: readRequiredString(record, 'count'),
    ...optionalApp(record),
    ...optionalText(record, 'expires'),
    ...optionalText(record, 'custom'),
  };
}

function decodeOffersList(record: Record<string, unknown>): OffersListInput {
  return {
    operation: 'list',
    productId: readRequiredString(record, 'productId'),
    ...optionalApp(record),
  };
}

function decodeOffersDeactivate(record: Record<string, unknown>): OffersDeactivateInput {
  return {
    operation: 'deactivate',
    productId: readRequiredString(record, 'productId'),
    offerName: readRequiredString(record, 'offerName'),
    ...optionalApp(record),
  };
}

export function OffersCommandInputSchema(rawCommandInput: unknown): OffersCommandInput {
  const record = readCommandRecord(rawCommandInput);
  const operation = readRequiredString(record, 'operation');

  if (operation == 'reconcile') {
    return decodeOffersReconcile(record);
  }

  if (operation == 'generate-codes') {
    return decodeOffersGenerateCodes(record);
  }

  if (operation == 'list') {
    return decodeOffersList(record);
  }

  if (operation == 'deactivate') {
    return decodeOffersDeactivate(record);
  }

  throw new Error('Unknown offers command.');
}

/** Convert a dependency failure into the offers command channel. */
function offersFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): OffersCommandFailure {
  const hasExplicitMessage = explicitMessage != null;

  if (hasExplicitMessage) {
    return makeOffersCommandFailure({ operation, message: explicitMessage, cause });
  }

  return makeOffersCommandFailure({ operation, message: errorMessage(cause), cause });
}

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

/** Render an offer-code campaign without Unicode status glyphs. */
export function renderOfferCodeState(
  offerCode: Readonly<{ name: string; active: boolean }>,
): string {
  if (offerCode.active) {
    return `[active] ${offerCode.name}`;
  }

  return `[inactive] ${offerCode.name}`;
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
  appleStore: AppStoreConnectClient,
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
    confirmed = await LaunchPrompt.confirm(
      `Apply ${mutationCount} offer change(s) to App Store Connect?`,
    );
  } catch (cause) {
    throw offersFailure('confirm offers write', cause);
  }

  if (confirmed) {
    return true;
  }

  LaunchPrompt.cancel('Aborted - no changes made.');
  return false;
}

async function mapWithConcurrency<Member, Mapped>(
  members: readonly Member[],
  concurrency: number,
  mapMember: (member: Member) => Promise<Mapped>,
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

      mappedMembers[memberIndex] = await mapMember(member);
    }
  }

  const workerCount = Math.min(concurrency, members.length);
  const workers: Promise<void>[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(runWorker());
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
async function executeOffersReconcile(commandInput: OffersReconcileInput): Promise<number> {
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

    let appleStore: AppStoreConnectClient;

    try {
      appleStore = await loadActiveAppleStore();
    } catch (cause) {
      throw offersFailure('load App Store Connect client', cause);
    }

    const offerJobConcurrency = 4;

    async function planOffersJob(offersJob: OffersJob): Promise<OffersJobOutcome> {
      return reconcileOffersJob(appleStore, offersJob, true);
    }

    const planOutcomes = await mapWithConcurrency(offersJobs, offerJobConcurrency, planOffersJob);
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
        actionLines.push(renderOfferAction(plannedAction));
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

    const applyOutcomes = await mapWithConcurrency(
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

function appleAppNames(appleApps: readonly AppleAppChoice[]): string {
  const names: string[] = [];

  for (const appleApp of appleApps) {
    names.push(appleApp.app.name);
  }

  return names.join(', ');
}

function readOnlyAppleApp(appleApps: readonly AppleAppChoice[]): AppleAppChoice | null {
  const isOnlyApp = appleApps.length == 1;

  if (isOnlyApp == false) {
    return null;
  }

  const onlyApp = appleApps[0];

  if (onlyApp == null) {
    return null;
  }

  return onlyApp;
}

/** Pick the explicit app, or the only app with an iOS bundle identifier. */
function pickSubscriptionApp(
  apps: AppDescriptor[],
  appSelector: string | undefined,
): AppleAppChoice {
  const appleApps: AppleAppChoice[] = [];

  for (const discoveredApp of apps) {
    const bundleId = discoveredApp.bundleId;
    const hasBundleId = bundleId != null;

    if (hasBundleId) {
      appleApps.push({ app: discoveredApp, bundleId });
    }
  }

  const hasSelector = appSelector != null;

  if (hasSelector) {
    let selectedApp: AppleAppChoice | null = null;

    for (const appleApp of appleApps) {
      const nameMatches = appleApp.app.name == appSelector;

      if (nameMatches) {
        selectedApp = appleApp;
      }
    }

    const chosenApp = selectedApp;
    const hasSelectedApp = chosenApp != null;

    if (hasSelectedApp) {
      return chosenApp;
    }

    throw offersFailure(
      'select offer-code app',
      appSelector,
      `Unknown app "${appSelector}". Discovered: ${appleAppNames(appleApps)}.`,
    );
  }

  const onlyApp = readOnlyAppleApp(appleApps);
  const hasOnlyApp = onlyApp != null;

  if (hasOnlyApp) {
    return onlyApp;
  }

  throw offersFailure(
    'select offer-code app',
    appleApps,
    `Several apps found - pass --app <name> (one of: ${appleAppNames(appleApps)}).`,
  );
}

/** Resolve an App Store subscription id for an imperative offer-code command. */
async function resolveSubscription(
  appSelector: string | undefined,
  productId: string,
): Promise<ResolvedSubscription> {
  const launchPaths = readLaunchDirectories();
  let loadedConfiguration: Awaited<ReturnType<typeof loadConfig>>;

  try {
    loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  } catch (cause) {
    throw offersFailure('load offer-code configuration', cause);
  }

  const selectedApp = pickSubscriptionApp(loadedConfiguration.apps, appSelector);
  let appleStore: AppStoreConnectClient;

  try {
    appleStore = await loadActiveAppleStore();
  } catch (cause) {
    throw offersFailure('load App Store Connect client', cause);
  }

  let appId: string | null;

  try {
    appId = await appleStore.getAppId(selectedApp.bundleId);
  } catch (cause) {
    throw offersFailure('find App Store Connect app', cause);
  }

  const foundAppId = appId;
  const isAppMissing = foundAppId == null;

  if (isAppMissing) {
    throw offersFailure(
      'find App Store Connect app',
      selectedApp.bundleId,
      `No App Store Connect app record for ${selectedApp.bundleId}.`,
    );
  }

  try {
    var subscriptionGroups = await appleStore.listSubscriptionGroups(foundAppId);
  } catch (cause) {
    throw offersFailure('list subscription groups', cause);
  }

  for (const subscriptionGroup of subscriptionGroups) {
    try {
      var subscriptions = await appleStore.listSubscriptions(subscriptionGroup.id);
    } catch (cause) {
      throw offersFailure('list subscriptions', cause);
    }

    for (const subscription of subscriptions) {
      const productMatches = subscription.productId == productId;

      if (productMatches) {
        return {
          appleStore,
          appName: selectedApp.app.name,
          subscriptionId: subscription.id,
        };
      }
    }
  }

  throw offersFailure(
    'find subscription',
    productId,
    `No subscription ${productId} in App Store Connect for ${selectedApp.app.name}.`,
  );
}

/** Find an offer-code campaign by its configured name. */
async function findOfferCode(
  resolvedSubscription: ResolvedSubscription,
  productId: string,
  offerName: string,
): Promise<OfferCodeResource> {
  let offerCodes: OfferCodeResource[];

  try {
    offerCodes = await resolvedSubscription.appleStore.listSubscriptionOfferCodes(
      resolvedSubscription.subscriptionId,
    );
  } catch (cause) {
    throw offersFailure('list offer-code campaigns', cause);
  }

  let matchingOfferCode: OfferCodeResource | null = null;

  for (const offerCode of offerCodes) {
    const nameMatches = offerCode.name == offerName;

    if (nameMatches) {
      matchingOfferCode = offerCode;
    }
  }

  const foundOfferCode = matchingOfferCode;
  const isOfferMissing = foundOfferCode == null;

  if (isOfferMissing) {
    throw offersFailure(
      'find offer-code campaign',
      offerName,
      `No offer code named "${offerName}" on ${productId} (${resolvedSubscription.appName}).`,
    );
  }

  return foundOfferCode;
}

function isInvalidCodeCount(codeCount: number): boolean {
  const isWholeNumber = Number.isInteger(codeCount);

  if (isWholeNumber == false) {
    return true;
  }

  return codeCount < 1;
}

/** Generate custom or one-time-use redeemable codes. */
async function executeGenerateCodes(commandInput: OffersGenerateCodesInput): Promise<void> {
  try {
    const logger = createLogger(false);
    const codeCount = Number.parseInt(commandInput.count, 10);
    const countIsInvalid = isInvalidCodeCount(codeCount);

    if (countIsInvalid) {
      throw offersFailure(
        'validate offer code count',
        commandInput.count,
        '--count must be a positive integer.',
      );
    }

    const resolvedSubscription = await resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCode = await findOfferCode(
      resolvedSubscription,
      commandInput.productId,
      commandInput.offerName,
    );
    const customCode = commandInput.custom;
    const hasCustomCode = customCode != null;

    if (hasCustomCode) {
      try {
        await resolvedSubscription.appleStore.createOfferCodeCustomCode(
          offerCode.id,
          customCode,
          codeCount,
          commandInput.expires,
        );
      } catch (cause) {
        throw offersFailure('create custom offer code', cause);
      }

      logger.step(
        'offers',
        `created custom code "${customCode}" (${codeCount} uses) on "${commandInput.offerName}"`,
      );
      return;
    }

    const expirationDate = commandInput.expires;
    const isExpirationMissing = expirationDate == null;

    if (isExpirationMissing) {
      throw offersFailure(
        'validate one-time offer codes',
        commandInput,
        'One-time-use codes need an expiration date: --expires YYYY-MM-DD.',
      );
    }

    const isExpirationBlank = expirationDate.length == 0;

    if (isExpirationBlank) {
      throw offersFailure(
        'validate one-time offer codes',
        commandInput,
        'One-time-use codes need an expiration date: --expires YYYY-MM-DD.',
      );
    }

    try {
      await resolvedSubscription.appleStore.createOfferCodeOneTimeUseBatch(
        offerCode.id,
        codeCount,
        expirationDate,
      );
    } catch (cause) {
      throw offersFailure('create one-time offer codes', cause);
    }

    logger.step(
      'offers',
      `generated ${codeCount} one-time-use code(s) on "${commandInput.offerName}" (expire ${expirationDate})`,
    );
  } catch (cause) {
    throw offersFailure('generate offer codes', cause);
  }
}

/** List a subscription's offer-code campaigns. */
async function executeListOfferCodes(commandInput: OffersListInput): Promise<void> {
  try {
    const logger = createLogger(false);
    const resolvedSubscription = await resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    let offerCodes: OfferCodeResource[];

    try {
      offerCodes = await resolvedSubscription.appleStore.listSubscriptionOfferCodes(
        resolvedSubscription.subscriptionId,
      );
    } catch (cause) {
      throw offersFailure('list offer-code campaigns', cause);
    }

    const hasNoOfferCodes = offerCodes.length == 0;

    if (hasNoOfferCodes) {
      logger.note(`No offer codes on ${commandInput.productId} (${resolvedSubscription.appName}).`);
      return;
    }

    const offerLines: string[] = [];

    for (const offerCode of offerCodes) {
      offerLines.push(renderOfferCodeState(offerCode));
    }

    logger.notice(
      `Offer codes - ${commandInput.productId} (${resolvedSubscription.appName})`,
      ...offerLines,
    );
  } catch (cause) {
    throw offersFailure('list offer codes', cause);
  }
}

/** Deactivate one offer-code campaign. */
async function executeDeactivateOfferCode(commandInput: OffersDeactivateInput): Promise<void> {
  try {
    const logger = createLogger(false);
    const resolvedSubscription = await resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCode = await findOfferCode(
      resolvedSubscription,
      commandInput.productId,
      commandInput.offerName,
    );

    try {
      await resolvedSubscription.appleStore.deactivateOfferCode(offerCode.id);
    } catch (cause) {
      throw offersFailure('deactivate offer-code campaign', cause);
    }

    logger.step(
      'offers',
      `deactivated offer code "${commandInput.offerName}" on ${commandInput.productId}`,
    );
  } catch (cause) {
    throw offersFailure('deactivate offer code', cause);
  }
}

/** Decode and run the selected offers command operation. */
async function executeOffersCommand(rawCommandInput: unknown): Promise<number> {
  try {
    let commandInput: OffersCommandInput;

    try {
      commandInput = OffersCommandInputSchema(rawCommandInput);
    } catch (cause) {
      throw offersFailure('decode offers command input', cause);
    }

    if (commandInput.operation == 'reconcile') {
      return await executeOffersReconcile(commandInput);
    }

    if (commandInput.operation == 'generate-codes') {
      await executeGenerateCodes(commandInput);
      return 0;
    }

    if (commandInput.operation == 'list') {
      await executeListOfferCodes(commandInput);
      return 0;
    }

    await executeDeactivateOfferCode(commandInput);
    return 0;
  } catch (cause) {
    throw offersFailure('run offers command', cause);
  }
}

/** Run a schema-decoded offers operation. */
export async function offersCommandProgram(rawCommandInput: unknown): Promise<void> {
  const failureCount = await executeOffersCommand(rawCommandInput);
  const hasFailures = failureCount > 0;

  if (hasFailures) {
    completeCommand(1);
  }
}
