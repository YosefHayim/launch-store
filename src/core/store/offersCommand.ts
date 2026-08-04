import { type FileSystem, type Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { loadConfig } from '../config/config.js';
import type { EffectAppStoreConnectClient } from '../services/appleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppDescriptor } from '../types/app.js';
import type { AppProducts } from '../types/catalog.js';
import type { PlannedAction, ReconcileReport } from '../types/reconcile.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';
import { reconcileOffers } from './offers.js';

const OffersReconcileInputSchema = Schema.Struct({
  operation: Schema.Literal('reconcile'),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

const OffersGenerateCodesInputSchema = Schema.Struct({
  operation: Schema.Literal('generate-codes'),
  productId: Schema.String,
  offerName: Schema.String,
  app: Schema.optionalWith(Schema.String, { exact: true }),
  count: Schema.String,
  expires: Schema.optionalWith(Schema.String, { exact: true }),
  custom: Schema.optionalWith(Schema.String, { exact: true }),
});

const OffersListInputSchema = Schema.Struct({
  operation: Schema.Literal('list'),
  productId: Schema.String,
  app: Schema.optionalWith(Schema.String, { exact: true }),
});

const OffersDeactivateInputSchema = Schema.Struct({
  operation: Schema.Literal('deactivate'),
  productId: Schema.String,
  offerName: Schema.String,
  app: Schema.optionalWith(Schema.String, { exact: true }),
});

export const OffersCommandInputSchema = Schema.Union(
  OffersReconcileInputSchema,
  OffersGenerateCodesInputSchema,
  OffersListInputSchema,
  OffersDeactivateInputSchema,
);

export type OffersCommandInput = Schema.Schema.Type<typeof OffersCommandInputSchema>;
export type OffersReconcileInput = Schema.Schema.Type<typeof OffersReconcileInputSchema>;
export type OffersGenerateCodesInput = Schema.Schema.Type<typeof OffersGenerateCodesInputSchema>;
export type OffersListInput = Schema.Schema.Type<typeof OffersListInputSchema>;
export type OffersDeactivateInput = Schema.Schema.Type<typeof OffersDeactivateInputSchema>;

/** An offers command step failed. */
export type OffersCommandFailure = Readonly<{
  readonly _tag: 'OffersCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeOffersCommandFailure = Data.tagged<OffersCommandFailure>('OffersCommandFailure');

type OffersCommandRequirements =
  | ActiveAppleStoreRequirements
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Terminal.Terminal;

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
  readonly appleStore: EffectAppStoreConnectClient;
  readonly appName: string;
  readonly subscriptionId: string;
}>;

/** Convert a dependency failure into the offers command channel. */
const offersFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): OffersCommandFailure => {
  let message = `${operation} failed.`;
  if (explicitMessage !== undefined) message = explicitMessage;
  if (explicitMessage === undefined && typeof cause === 'string' && cause.length > 0)
    message = cause;
  if (explicitMessage === undefined && cause instanceof Error) message = cause.message;
  if (
    explicitMessage === undefined &&
    typeof cause === 'object' &&
    cause !== null &&
    'message' in cause &&
    typeof cause.message === 'string'
  ) {
    message = cause.message;
  }
  return makeOffersCommandFailure({ operation, message, cause });
};

/** Whether one product catalog declares offers or promoted-purchase ordering. */
export const hasOffersWork = (products: AppProducts | undefined): boolean => {
  if (products === undefined) return false;
  if (products.promotedPurchases !== undefined && products.promotedPurchases.length > 0)
    return true;
  if (products.subscriptionGroups === undefined) return false;
  for (const subscriptionGroup of products.subscriptionGroups) {
    for (const subscription of subscriptionGroup.subscriptions) {
      if (subscription.offerCodes !== undefined && subscription.offerCodes.length > 0) return true;
      if (
        subscription.promotionalOffers !== undefined &&
        subscription.promotionalOffers.length > 0
      ) {
        return true;
      }
      if (
        subscription.introductoryOffers !== undefined &&
        subscription.introductoryOffers.length > 0
      ) {
        return true;
      }
      if (subscription.winBackOffers !== undefined && subscription.winBackOffers.length > 0) {
        return true;
      }
    }
  }
  return false;
};

/** Render one offer action with stable ASCII markers. */
export const renderOfferAction = (plannedAction: PlannedAction): string => {
  switch (plannedAction.status) {
    case 'skipped':
      return `- ${plannedAction.description}`;
    case 'failed': {
      let failureText = 'failed';
      if (plannedAction.error !== undefined) failureText = plannedAction.error;
      return `x ${plannedAction.description} - ${failureText}`;
    }
    case 'planned':
    case 'applied':
      return `+ ${plannedAction.description}`;
  }
};

/** Render an offer-code campaign without Unicode status glyphs. */
export const renderOfferCodeState = (
  offerCode: Readonly<{ name: string; active: boolean }>,
): string => {
  if (offerCode.active) return `[active] ${offerCode.name}`;
  return `[inactive] ${offerCode.name}`;
};

/** Select all apps or a comma-separated subset. */
const selectOffersApps = (
  apps: AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<AppDescriptor[], OffersCommandFailure> => {
  if (appSelector === undefined) return Effect.succeed(apps);
  if (appSelector.length === 0) return Effect.succeed(apps);
  const requestedNames = appSelector
    .split(',')
    .map((appName) => appName.trim())
    .filter((appName) => appName.length > 0);
  const appsByName = new Map(apps.map((discoveredApp) => [discoveredApp.name, discoveredApp]));
  const selectedApps: AppDescriptor[] = [];
  for (const requestedName of requestedNames) {
    const selectedApp = appsByName.get(requestedName);
    if (selectedApp === undefined) {
      let discoveredNames = apps.map((discoveredApp) => discoveredApp.name).join(', ');
      if (discoveredNames.length === 0) discoveredNames = 'none';
      return Effect.fail(
        offersFailure(
          'select offers apps',
          requestedName,
          `Unknown app "${requestedName}". Discovered: ${discoveredNames}.`,
        ),
      );
    }
    selectedApps.push(selectedApp);
  }
  return Effect.succeed(selectedApps);
};

/** Build runnable offer jobs from discovered apps and their bundle-keyed catalogs. */
const resolveOffersJobs = (
  appSelector: string | undefined,
): Effect.Effect<
  OffersJob[],
  OffersCommandFailure,
  FileSystem.FileSystem | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory).pipe(
      Effect.mapError((cause) => offersFailure('load offers configuration', cause)),
    );
    const selectedApps = yield* selectOffersApps(loadedConfiguration.apps, appSelector);
    const offersJobs: OffersJob[] = [];
    for (const selectedApp of selectedApps) {
      if (selectedApp.bundleId === undefined) continue;
      const productCatalog = loadedConfiguration.config.products;
      if (productCatalog === undefined) continue;
      const appProducts = productCatalog[selectedApp.bundleId];
      if (appProducts === undefined) continue;
      if (!hasOffersWork(appProducts)) continue;
      offersJobs.push({ app: selectedApp, bundleId: selectedApp.bundleId, products: appProducts });
    }
    return offersJobs;
  });

/** Reconcile one app while keeping its failure isolated from concurrent jobs. */
const reconcileOffersJob = (
  appleStore: EffectAppStoreConnectClient,
  offersJob: OffersJob,
  dryRun: boolean,
): Effect.Effect<OffersJobOutcome> =>
  reconcileOffers(appleStore, {
    bundleId: offersJob.bundleId,
    products: offersJob.products,
    dryRun,
  }).pipe(
    Effect.match({
      onFailure: (cause): OffersJobOutcome => ({
        _tag: 'OffersJobFailed',
        job: offersJob,
        message: offersFailure('reconcile app offers', cause).message,
      }),
      onSuccess: (reconcileReport): OffersJobOutcome => ({
        _tag: 'OffersJobSucceeded',
        job: offersJob,
        report: reconcileReport,
      }),
    }),
  );

/** Count action outcomes for one app receipt. */
const summarizeOfferActions = (
  actions: PlannedAction[],
): Readonly<{ applied: number; failed: number; skipped: number }> => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const plannedAction of actions) {
    if (plannedAction.status === 'applied') applied += 1;
    if (plannedAction.status === 'failed') failed += 1;
    if (plannedAction.status === 'skipped') skipped += 1;
  }
  return { applied, failed, skipped };
};

/** Confirm an App Store Connect write unless --yes was supplied. */
const confirmOffersWrite = (
  mutationCount: number,
  assumeYes: boolean,
): Effect.Effect<boolean, OffersCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        offersFailure(
          'confirm offers write',
          'confirmation-required',
          'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
        ),
      );
    }
    const prompt = yield* LaunchPrompt;
    const confirmed = yield* prompt
      .confirm(`Apply ${mutationCount} offer change(s) to App Store Connect?`)
      .pipe(Effect.mapError((cause) => offersFailure('confirm offers write', cause)));
    if (confirmed) return true;
    yield* prompt.cancel('Aborted - no changes made.');
    return false;
  });

/** Plan, confirm, and apply declared offers across selected apps. */
const executeOffersReconcile = (
  commandInput: OffersReconcileInput,
): Effect.Effect<number, OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const offersJobs = yield* resolveOffersJobs(commandInput.app);
    if (offersJobs.length === 0) {
      yield* logger.note(
        'Nothing to reconcile - no app declares offers or promoted purchases. Add them under `products`.',
      );
      return 0;
    }
    const appleStore = yield* loadActiveAppleStore().pipe(
      Effect.mapError((cause) => offersFailure('load App Store Connect client', cause)),
    );
    const planOutcomes = yield* Effect.forEach(
      offersJobs,
      (offersJob) => reconcileOffersJob(appleStore, offersJob, true),
      { concurrency: 4 },
    );
    let mutationCount = 0;
    let planFailureCount = 0;
    yield* logger.gap();
    for (const planOutcome of planOutcomes) {
      if (planOutcome._tag === 'OffersJobFailed') {
        planFailureCount += 1;
        yield* logger.error(
          `${planOutcome.job.app.name} (${planOutcome.job.bundleId}): ${planOutcome.message}`,
        );
        continue;
      }
      const plannedActions = planOutcome.report.actions;
      mutationCount += plannedActions.filter(
        (plannedAction) => plannedAction.status === 'planned',
      ).length;
      if (plannedActions.length === 0) {
        yield* logger.step(planOutcome.job.app.name, 'offers already in sync');
        continue;
      }
      yield* logger.notice(
        `${planOutcome.job.app.name} (${planOutcome.job.bundleId})`,
        ...plannedActions.map(renderOfferAction),
      );
    }
    if (mutationCount === 0) {
      yield* logger.gap();
      if (planFailureCount > 0) {
        yield* logger.error(`${planFailureCount} app(s) could not be planned (see above).`);
        return planFailureCount;
      }
      yield* logger.step('offers', 'everything is already in sync');
      return 0;
    }
    yield* logger.gap();
    yield* logger.note(`${mutationCount} change(s) across ${offersJobs.length} app(s).`);
    if (commandInput.dryRun) {
      yield* logger.note('Dry run - no changes made. Re-run without --dry-run to apply.');
      return planFailureCount;
    }
    const confirmed = yield* confirmOffersWrite(mutationCount, commandInput.yes);
    if (!confirmed) return planFailureCount;
    const jobsToApply: OffersJob[] = [];
    for (const planOutcome of planOutcomes) {
      if (planOutcome._tag === 'OffersJobFailed') continue;
      if (planOutcome.report.actions.some((plannedAction) => plannedAction.status === 'planned')) {
        jobsToApply.push(planOutcome.job);
      }
    }
    const applyOutcomes = yield* Effect.forEach(
      jobsToApply,
      (offersJob) => reconcileOffersJob(appleStore, offersJob, false),
      { concurrency: 4 },
    );
    let failureCount = planFailureCount;
    const receiptLines: string[] = [];
    for (const applyOutcome of applyOutcomes) {
      if (applyOutcome._tag === 'OffersJobFailed') {
        failureCount += 1;
        receiptLines.push(`x ${applyOutcome.job.app.name}: ${applyOutcome.message}`);
        continue;
      }
      const offersSummary = summarizeOfferActions(applyOutcome.report.actions);
      failureCount += offersSummary.failed;
      let receiptStatus = 'OK';
      if (offersSummary.failed > 0) receiptStatus = 'x';
      receiptLines.push(
        `${receiptStatus} ${applyOutcome.job.app.name}: ${offersSummary.applied} applied, ${offersSummary.failed} failed, ${offersSummary.skipped} skipped`,
      );
      for (const appliedAction of applyOutcome.report.actions) {
        if (appliedAction.status !== 'failed') continue;
        let failureText = 'failed';
        if (appliedAction.error !== undefined) failureText = appliedAction.error;
        receiptLines.push(`    x ${appliedAction.description} - ${failureText}`);
      }
    }
    let receiptTitle = 'Offers synced';
    if (failureCount > 0) receiptTitle = 'Offers synced with errors';
    yield* logger.box(receiptTitle, receiptLines);
    return failureCount;
  }).pipe(Effect.mapError((cause) => offersFailure('reconcile offers', cause)));

/** Pick the explicit app, or the only app with an iOS bundle identifier. */
const pickSubscriptionApp = (
  apps: AppDescriptor[],
  appSelector: string | undefined,
): Effect.Effect<Readonly<{ app: AppDescriptor; bundleId: string }>, OffersCommandFailure> => {
  const appleApps: Array<Readonly<{ app: AppDescriptor; bundleId: string }>> = [];
  for (const discoveredApp of apps) {
    if (discoveredApp.bundleId !== undefined) {
      appleApps.push({ app: discoveredApp, bundleId: discoveredApp.bundleId });
    }
  }
  if (appSelector !== undefined) {
    const selectedApp = appleApps.find((appleApp) => appleApp.app.name === appSelector);
    if (selectedApp !== undefined) return Effect.succeed(selectedApp);
    return Effect.fail(
      offersFailure(
        'select offer-code app',
        appSelector,
        `Unknown app "${appSelector}". Discovered: ${appleApps
          .map((appleApp) => appleApp.app.name)
          .join(', ')}.`,
      ),
    );
  }
  const onlyApp = appleApps[0];
  if (appleApps.length === 1 && onlyApp !== undefined) return Effect.succeed(onlyApp);
  return Effect.fail(
    offersFailure(
      'select offer-code app',
      appleApps,
      `Several apps found - pass --app <name> (one of: ${appleApps
        .map((appleApp) => appleApp.app.name)
        .join(', ')}).`,
    ),
  );
};

/** Resolve an App Store subscription id for an imperative offer-code command. */
const resolveSubscription = (
  appSelector: string | undefined,
  productId: string,
): Effect.Effect<ResolvedSubscription, OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory).pipe(
      Effect.mapError((cause) => offersFailure('load offer-code configuration', cause)),
    );
    const selectedApp = yield* pickSubscriptionApp(loadedConfiguration.apps, appSelector);
    const appleStore = yield* loadActiveAppleStore().pipe(
      Effect.mapError((cause) => offersFailure('load App Store Connect client', cause)),
    );
    const appId = yield* appleStore
      .getAppId(selectedApp.bundleId)
      .pipe(Effect.mapError((cause) => offersFailure('find App Store Connect app', cause)));
    if (appId === null) {
      return yield* Effect.fail(
        offersFailure(
          'find App Store Connect app',
          selectedApp.bundleId,
          `No App Store Connect app record for ${selectedApp.bundleId}.`,
        ),
      );
    }
    const subscriptionGroups = yield* appleStore
      .listSubscriptionGroups(appId)
      .pipe(Effect.mapError((cause) => offersFailure('list subscription groups', cause)));
    for (const subscriptionGroup of subscriptionGroups) {
      const subscriptions = yield* appleStore
        .listSubscriptions(subscriptionGroup.id)
        .pipe(Effect.mapError((cause) => offersFailure('list subscriptions', cause)));
      const matchingSubscription = subscriptions.find(
        (subscription) => subscription.productId === productId,
      );
      if (matchingSubscription !== undefined) {
        return {
          appleStore,
          appName: selectedApp.app.name,
          subscriptionId: matchingSubscription.id,
        };
      }
    }
    return yield* Effect.fail(
      offersFailure(
        'find subscription',
        productId,
        `No subscription ${productId} in App Store Connect for ${selectedApp.app.name}.`,
      ),
    );
  });

/** Find an offer-code campaign by its configured name. */
const findOfferCode = (
  resolvedSubscription: ResolvedSubscription,
  productId: string,
  offerName: string,
) =>
  resolvedSubscription.appleStore
    .listSubscriptionOfferCodes(resolvedSubscription.subscriptionId)
    .pipe(
      Effect.mapError((cause) => offersFailure('list offer-code campaigns', cause)),
      Effect.flatMap((offerCodes) => {
        const matchingOfferCode = offerCodes.find((offerCode) => offerCode.name === offerName);
        if (matchingOfferCode !== undefined) return Effect.succeed(matchingOfferCode);
        return Effect.fail(
          offersFailure(
            'find offer-code campaign',
            offerName,
            `No offer code named "${offerName}" on ${productId} (${resolvedSubscription.appName}).`,
          ),
        );
      }),
    );

/** Generate custom or one-time-use redeemable codes. */
const executeGenerateCodes = (
  commandInput: OffersGenerateCodesInput,
): Effect.Effect<void, OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const codeCount = Number.parseInt(commandInput.count, 10);
    let countIsInvalid = !Number.isInteger(codeCount);
    if (codeCount < 1) countIsInvalid = true;
    if (countIsInvalid) {
      return yield* Effect.fail(
        offersFailure(
          'validate offer code count',
          commandInput.count,
          '--count must be a positive integer.',
        ),
      );
    }
    const resolvedSubscription = yield* resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCode = yield* findOfferCode(
      resolvedSubscription,
      commandInput.productId,
      commandInput.offerName,
    );
    if (commandInput.custom !== undefined) {
      yield* resolvedSubscription.appleStore
        .createOfferCodeCustomCode(
          offerCode.id,
          commandInput.custom,
          codeCount,
          commandInput.expires,
        )
        .pipe(Effect.mapError((cause) => offersFailure('create custom offer code', cause)));
      yield* logger.step(
        'offers',
        `created custom code "${commandInput.custom}" (${codeCount} uses) on "${commandInput.offerName}"`,
      );
      return;
    }
    const missingExpirationFailure = offersFailure(
      'validate one-time offer codes',
      commandInput,
      'One-time-use codes need an expiration date: --expires YYYY-MM-DD.',
    );
    if (commandInput.expires === undefined) {
      return yield* Effect.fail(missingExpirationFailure);
    }
    const expirationDate = commandInput.expires;
    if (expirationDate.length === 0) return yield* Effect.fail(missingExpirationFailure);
    yield* resolvedSubscription.appleStore
      .createOfferCodeOneTimeUseBatch(offerCode.id, codeCount, expirationDate)
      .pipe(Effect.mapError((cause) => offersFailure('create one-time offer codes', cause)));
    yield* logger.step(
      'offers',
      `generated ${codeCount} one-time-use code(s) on "${commandInput.offerName}" (expire ${expirationDate})`,
    );
  }).pipe(Effect.mapError((cause) => offersFailure('generate offer codes', cause)));

/** List a subscription's offer-code campaigns. */
const executeListOfferCodes = (
  commandInput: OffersListInput,
): Effect.Effect<void, OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const resolvedSubscription = yield* resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCodes = yield* resolvedSubscription.appleStore
      .listSubscriptionOfferCodes(resolvedSubscription.subscriptionId)
      .pipe(Effect.mapError((cause) => offersFailure('list offer-code campaigns', cause)));
    if (offerCodes.length === 0) {
      yield* logger.note(
        `No offer codes on ${commandInput.productId} (${resolvedSubscription.appName}).`,
      );
      return;
    }
    yield* logger.notice(
      `Offer codes - ${commandInput.productId} (${resolvedSubscription.appName})`,
      ...offerCodes.map(renderOfferCodeState),
    );
  }).pipe(Effect.mapError((cause) => offersFailure('list offer codes', cause)));

/** Deactivate one offer-code campaign. */
const executeDeactivateOfferCode = (
  commandInput: OffersDeactivateInput,
): Effect.Effect<void, OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const resolvedSubscription = yield* resolveSubscription(
      commandInput.app,
      commandInput.productId,
    );
    const offerCode = yield* findOfferCode(
      resolvedSubscription,
      commandInput.productId,
      commandInput.offerName,
    );
    yield* resolvedSubscription.appleStore
      .deactivateOfferCode(offerCode.id)
      .pipe(Effect.mapError((cause) => offersFailure('deactivate offer-code campaign', cause)));
    yield* logger.step(
      'offers',
      `deactivated offer code "${commandInput.offerName}" on ${commandInput.productId}`,
    );
  }).pipe(Effect.mapError((cause) => offersFailure('deactivate offer code', cause)));

/** Decode and run the selected offers command operation. */
const executeOffersCommand = (
  rawCommandInput: unknown,
): Effect.Effect<number, OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(OffersCommandInputSchema)(
      rawCommandInput,
    ).pipe(Effect.mapError((cause) => offersFailure('decode offers command input', cause)));
    switch (commandInput.operation) {
      case 'reconcile':
        return yield* executeOffersReconcile(commandInput);
      case 'generate-codes':
        yield* executeGenerateCodes(commandInput);
        return 0;
      case 'list':
        yield* executeListOfferCodes(commandInput);
        return 0;
      case 'deactivate':
        yield* executeDeactivateOfferCode(commandInput);
        return 0;
    }
  }).pipe(Effect.mapError((cause) => offersFailure('run offers command', cause)));

/** Run a schema-decoded offers operation. */
export const offersCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CommandExit | OffersCommandFailure, OffersCommandRequirements> =>
  Effect.gen(function* () {
    const failureCount = yield* executeOffersCommand(rawCommandInput);
    if (failureCount > 0) yield* completeCommand(1);
  });
