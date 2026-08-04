import { Data, Effect } from 'effect';
import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  InAppPurchaseResource,
  ListingLocalization,
  LocalizationResource,
  PricePointResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '../types/appleCatalog.js';
import type { CapabilityType } from '../credentials/capabilities.js';
import { errorMessage } from '../services/errorMessage.js';
import type { AppleLocaleInfo, AppleStoreConfig } from './storeConfig.js';
import type { AppProducts, InAppPurchaseConfig, SubscriptionConfig } from '../types/catalog.js';
import type { ActionStatus, PlannedAction, ReconcileReport } from '../types/reconcile.js';
/**
 * The exact slice of {@link AppStoreConnectClient} the reconciler depends on. Declaring it here (rather
 * than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake and
 * documents the client's reconcile surface in one place. `AppStoreConnectClient` satisfies it structurally.
 */
export type AscCatalogApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  findBundleId(identifier: string): Effect.Effect<BundleIdResource | null, unknown>;
  listBundleIdCapabilities(
    bundleIdResourceId: string,
  ): Effect.Effect<BundleIdCapabilityResource[], unknown>;
  enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Effect.Effect<BundleIdCapabilityResource, unknown>;
  disableCapability(capabilityId: string): Effect.Effect<void, unknown>;
  listInAppPurchases(appId: string): Effect.Effect<InAppPurchaseResource[], unknown>;
  createInAppPurchase(
    appId: string,
    input: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ): Effect.Effect<InAppPurchaseResource, unknown>;
  listInAppPurchaseLocalizations(iapId: string): Effect.Effect<LocalizationResource[], unknown>;
  createInAppPurchaseLocalization(
    iapId: string,
    input: {
      locale: string;
      name: string;
      description?: string | undefined;
    },
  ): Effect.Effect<LocalizationResource, unknown>;
  inAppPurchaseHasPrice(iapId: string): Effect.Effect<boolean, unknown>;
  findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Effect.Effect<PricePointResource | null, unknown>;
  createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Effect.Effect<void, unknown>;
  listSubscriptionGroups(appId: string): Effect.Effect<SubscriptionGroupResource[], unknown>;
  createSubscriptionGroup(
    appId: string,
    referenceName: string,
  ): Effect.Effect<SubscriptionGroupResource, unknown>;
  listSubscriptionGroupLocalizations(
    groupId: string,
  ): Effect.Effect<LocalizationResource[], unknown>;
  createSubscriptionGroupLocalization(
    groupId: string,
    input: {
      locale: string;
      name: string;
    },
  ): Effect.Effect<LocalizationResource, unknown>;
  listSubscriptions(groupId: string): Effect.Effect<SubscriptionResource[], unknown>;
  createSubscription(
    groupId: string,
    input: {
      productId: string;
      name: string;
      subscriptionPeriod: string;
      groupLevel: number;
    },
  ): Effect.Effect<SubscriptionResource, unknown>;
  listSubscriptionLocalizations(
    subscriptionId: string,
  ): Effect.Effect<LocalizationResource[], unknown>;
  createSubscriptionLocalization(
    subscriptionId: string,
    input: {
      locale: string;
      name: string;
      description?: string | undefined;
    },
  ): Effect.Effect<LocalizationResource, unknown>;
  subscriptionHasPrice(subscriptionId: string): Effect.Effect<boolean, unknown>;
  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Effect.Effect<PricePointResource | null, unknown>;
  createSubscriptionPrice(
    subscriptionId: string,
    pricePointId: string,
  ): Effect.Effect<void, unknown>;
  getEditableAppInfoId(appId: string): Effect.Effect<string | null, unknown>;
  listAppInfoLocalizations(appInfoId: string): Effect.Effect<ListingLocalization[], unknown>;
  createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Effect.Effect<void, unknown>;
  updateAppInfoLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Effect.Effect<void, unknown>;
  getEditableVersionId(appId: string): Effect.Effect<string | null, unknown>;
  listVersionLocalizations(versionId: string): Effect.Effect<ListingLocalization[], unknown>;
  createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Effect.Effect<void, unknown>;
  updateVersionLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Effect.Effect<void, unknown>;
};
/** Inputs to reconcile one app. */
export type ReconcileInput = {
  bundleId: string;
  capabilities: CapabilityType[];
  products: AppProducts;
  listing?: AppleStoreConfig;
  dryRun: boolean;
  allowDestructive: boolean;
};
/** Default base territory for price-point resolution when a {@link ProductPrice} doesn't name one. */
const DEFAULT_TERRITORY = 'USA';
export type CatalogPricePointFailure = Readonly<{
  readonly _tag: 'CatalogPricePointFailure';
  readonly message: string;
}>;
const makeCatalogPricePointFailure = Data.tagged<CatalogPricePointFailure>(
  'CatalogPricePointFailure',
);
/** Placeholder id for a resource that doesn't exist yet during a dry-run (its create closures never run). */
export const DRY_RUN_ID = '(dry-run)';
/**
 * Capabilities Apple enables on every App ID and won't let you remove. We must never propose disabling
 * them just because they aren't declared, or every sync would surface a no-op destructive action.
 */
const ALWAYS_ENABLED_CAPABILITIES = new Set<string>(['IN_APP_PURCHASE', 'GAME_CENTER']);
/**
 * The mutable action log a reconcile pass appends to: the actions collected so far plus the two run
 * flags {@link act} consults. Declared apart from {@link ReconcileContext} (which adds the catalog API
 * client) so a sibling reconciler that does NOT use {@link AscCatalogApi} - e.g. the screenshot/asset
 * pass in `ascScreenshots.ts` - can reuse {@link act} and {@link succeededOrPlanned} without depending
 * on the catalog surface. This is the one shared seam between the two reconcilers.
 */
export type ActionLog = {
  actions: PlannedAction[];
  dryRun: boolean;
  allowDestructive: boolean;
};
/** Mutable per-run context threaded through the catalog reconcile walk: the {@link ActionLog} plus the client. */
type ReconcileContext = ActionLog & {
  api: AscCatalogApi;
};
/** True once an action reached a terminal "this work happened (or was meant to)" state we can build on. */
export const succeededOrPlanned = (status: ActionStatus): boolean => {
  if (status === 'applied') return true;
  return status === 'planned';
};
/**
 * Record an action and, unless this is a dry-run, perform it. Destructive actions are recorded but not
 * run without `allowDestructive`. A thrown error is captured on the action (status `failed`) rather than
 * propagated, so the surrounding walk keeps going. Returns the terminal status plus the created resource,
 * which is absent on a dry-run or failure - callers fall back to
 * {@link DRY_RUN_ID} for the id of a not-yet-created parent.
 */
export const act = <CreatedResource>(
  actionLog: ActionLog,
  description: string,
  destructive: boolean,
  performWrite: () => Effect.Effect<CreatedResource, unknown>,
): Effect.Effect<{
  status: ActionStatus;
  actionValue?: CreatedResource;
}> => {
  const plannedAction: PlannedAction = { description, destructive, status: 'planned' };
  actionLog.actions.push(plannedAction);
  if (actionLog.dryRun) return Effect.succeed({ status: plannedAction.status });
  if (destructive && !actionLog.allowDestructive) {
    plannedAction.status = 'skipped';
    return Effect.succeed({ status: 'skipped' });
  }
  return performWrite().pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        plannedAction.status = 'failed';
        plannedAction.error = errorMessage(writeFailure);
        return { status: 'failed' as const };
      },
      onSuccess: (createdResource) => {
        plannedAction.status = 'applied';
        return { status: 'applied' as const, actionValue: createdResource };
      },
    }),
  );
};
/**
 * Resolve the App Store Connect app-record id for a bundle id, throwing the one precondition the user
 * must fix by hand: Apple exposes no API to create the app record, so it has to exist already. Shared by
 * the full {@link reconcileApp} pass and the listing-only {@link reconcileAppListing} so both surface the
 * identical, actionable message.
 */
export type AppStoreRecordFailure = Readonly<{
  readonly _tag: 'AppStoreRecordFailure';
  readonly message: string;
}>;
const makeAppStoreRecordFailure = Data.tagged<AppStoreRecordFailure>('AppStoreRecordFailure');
const resolveAppId = (
  api: AscCatalogApi,
  bundleId: string,
): Effect.Effect<string, AppStoreRecordFailure | unknown> =>
  Effect.gen(function* () {
    const appId = yield* api.getAppId(bundleId);
    if (!appId)
      return yield* Effect.fail(
        makeAppStoreRecordFailure({
          message:
            `No App Store Connect app record for ${bundleId}. Create the app once in App Store Connect ` +
            `(Apple has no API to create the app record), then re-run \`launch sync\`.`,
        }),
      );
    return appId;
  });
/**
 * Reconcile one app end to end, in dependency order: capabilities first (a build prerequisite), then
 * in-app purchases, then subscription groups and their subscriptions, then the textual listing. Throws
 * only for a precondition the user must fix (no ASC app record); everything else is captured per-action.
 */
export const reconcileApp = (
  api: AscCatalogApi,
  input: ReconcileInput,
): Effect.Effect<ReconcileReport, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = {
      api,
      actions: [],
      dryRun: input.dryRun,
      allowDestructive: input.allowDestructive,
    };
    const appId = yield* resolveAppId(api, input.bundleId);
    yield* reconcileCapabilities(reconcileContext, input.bundleId, input.capabilities);
    let desiredInAppPurchases: InAppPurchaseConfig[] = [];
    if (input.products.inAppPurchases !== undefined) {
      desiredInAppPurchases = input.products.inAppPurchases;
    }
    yield* reconcileInAppPurchases(reconcileContext, appId, desiredInAppPurchases);
    let desiredSubscriptionGroups: AppProducts['subscriptionGroups'] = [];
    if (input.products.subscriptionGroups !== undefined) {
      desiredSubscriptionGroups = input.products.subscriptionGroups;
    }
    yield* reconcileSubscriptionGroups(reconcileContext, appId, desiredSubscriptionGroups);
    if (input.listing) yield* reconcileListing(reconcileContext, appId, input.listing);
    return { bundleId: input.bundleId, actions: reconcileContext.actions };
  });
/** Inputs to reconcile only an app's textual store listing - the focused counterpart to {@link ReconcileInput}. */
export type ListingReconcileInput = {
  bundleId: string;
  listing: AppleStoreConfig;
  dryRun: boolean;
};
/**
 * Reconcile **only** an app's textual store listing - the focused leg behind `launch plan`'s `listing`
 * surface, run apart from the capability/IAP/subscription passes so it never double-counts what the
 * catalog surface owns. Listing reconciliation is purely create/patch (Apple keeps no destructive listing
 * action), so it always runs with `allowDestructive: false`. Throws the same missing-app-record
 * precondition as {@link reconcileApp}; every listing change is captured per-action.
 */
export const reconcileAppListing = (
  api: AscCatalogApi,
  input: ListingReconcileInput,
): Effect.Effect<ReconcileReport, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = {
      api,
      actions: [],
      dryRun: input.dryRun,
      allowDestructive: false,
    };
    const appId = yield* resolveAppId(api, input.bundleId);
    yield* reconcileListing(reconcileContext, appId, input.listing);
    return { bundleId: input.bundleId, actions: reconcileContext.actions };
  });
/** Enable declared capabilities that aren't on yet; (destructively) remove undeclared extras. */
const reconcileCapabilities = (
  reconcileContext: ReconcileContext,
  bundleId: string,
  desired: CapabilityType[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const resource = yield* reconcileContext.api.findBundleId(bundleId);
    if (!resource) {
      if (desired.length > 0) {
        let capabilityNoun = 'capabilities';
        if (desired.length === 1) capabilityNoun = 'capability';
        reconcileContext.actions.push({
          description: `bundle id ${bundleId} is not registered yet - run a build (or \`launch creds\`) to register it before syncing ${desired.length} ${capabilityNoun}`,
          destructive: false,
          status: 'skipped',
        });
      }
      return;
    }
    const current = yield* reconcileContext.api.listBundleIdCapabilities(resource.id);
    const currentTypes = new Set(current.map((capability) => capability.capabilityType));
    for (const capability of desired) {
      if (currentTypes.has(capability)) continue;
      yield* act(reconcileContext, `enable capability ${capability}`, false, () =>
        reconcileContext.api.enableCapability(resource.id, capability),
      );
    }
    const desiredTypes = new Set<string>(desired);
    for (const capability of current) {
      if (desiredTypes.has(capability.capabilityType)) {
        continue;
      }
      if (ALWAYS_ENABLED_CAPABILITIES.has(capability.capabilityType)) {
        continue;
      }
      yield* act(reconcileContext, `disable capability ${capability.capabilityType}`, true, () =>
        reconcileContext.api.disableCapability(capability.id),
      );
    }
  });
/** Create missing in-app purchases, fill in localizations, and set an initial price. */
const reconcileInAppPurchases = (
  reconcileContext: ReconcileContext,
  appId: string,
  desired: InAppPurchaseConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (desired.length === 0) return;
    const current = yield* reconcileContext.api.listInAppPurchases(appId);
    for (const iap of desired) {
      const match = current.find((existing) => existing.productId === iap.productId);
      let iapId: string;
      let existingLocales: Set<string>;
      let priced: boolean;
      if (match) {
        iapId = match.id;
        const locales = yield* reconcileContext.api.listInAppPurchaseLocalizations(iapId);
        existingLocales = new Set(locales.map((localization) => localization.locale));
        priced = yield* reconcileContext.api.inAppPurchaseHasPrice(iapId);
      } else {
        const createAction = yield* act(
          reconcileContext,
          `create in-app purchase ${iap.productId} (${iap.type})`,
          false,
          () =>
            reconcileContext.api.createInAppPurchase(appId, {
              productId: iap.productId,
              name: iap.referenceName,
              inAppPurchaseType: iap.type,
            }),
        );
        if (!succeededOrPlanned(createAction.status)) continue;
        iapId = DRY_RUN_ID;
        if (createAction.actionValue !== undefined) iapId = createAction.actionValue.id;
        existingLocales = new Set();
        priced = false;
      }
      for (const localization of iap.localizations) {
        if (existingLocales.has(localization.locale)) continue;
        yield* act(
          reconcileContext,
          `add IAP copy ${iap.productId} [${localization.locale}]`,
          false,
          () => reconcileContext.api.createInAppPurchaseLocalization(iapId, localization),
        );
      }
      if (iap.price && !priced) {
        let territory = DEFAULT_TERRITORY;
        if (iap.price.baseTerritory !== undefined) territory = iap.price.baseTerritory;
        const customerPrice = iap.price.customerPrice;
        yield* act(
          reconcileContext,
          `set IAP price ${iap.productId} = ${customerPrice} (${territory})`,
          false,
          () =>
            Effect.gen(function* () {
              const point = yield* reconcileContext.api.findInAppPurchasePricePoint(
                iapId,
                territory,
                customerPrice,
              );
              if (!point)
                return yield* Effect.fail(
                  makeCatalogPricePointFailure({
                    message: `No ${territory} price point matches ${customerPrice} for ${iap.productId}.`,
                  }),
                );
              yield* reconcileContext.api.createInAppPurchasePriceSchedule(
                iapId,
                territory,
                point.id,
              );
            }),
        );
      }
    }
  });
/** Create missing subscription groups, their display names, and the subscriptions within them. */
const reconcileSubscriptionGroups = (
  reconcileContext: ReconcileContext,
  appId: string,
  desired: AppProducts['subscriptionGroups'] = [],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (desired.length === 0) return;
    const current = yield* reconcileContext.api.listSubscriptionGroups(appId);
    for (const group of desired) {
      const match = current.find((existing) => existing.referenceName === group.referenceName);
      let groupId: string;
      let existingGroupLocales: Set<string>;
      let existingSubs: SubscriptionResource[];
      if (match) {
        groupId = match.id;
        const locales = yield* reconcileContext.api.listSubscriptionGroupLocalizations(groupId);
        existingGroupLocales = new Set(locales.map((localization) => localization.locale));
        existingSubs = yield* reconcileContext.api.listSubscriptions(groupId);
      } else {
        const createAction = yield* act(
          reconcileContext,
          `create subscription group "${group.referenceName}"`,
          false,
          () => reconcileContext.api.createSubscriptionGroup(appId, group.referenceName),
        );
        if (!succeededOrPlanned(createAction.status)) continue;
        groupId = DRY_RUN_ID;
        if (createAction.actionValue !== undefined) groupId = createAction.actionValue.id;
        existingGroupLocales = new Set();
        existingSubs = [];
      }
      for (const localization of group.localizations) {
        if (existingGroupLocales.has(localization.locale)) continue;
        yield* act(
          reconcileContext,
          `add group name "${group.referenceName}" [${localization.locale}]`,
          false,
          () => reconcileContext.api.createSubscriptionGroupLocalization(groupId, localization),
        );
      }
      // Config order is the level ranking: the first subscription is the top level (1), the next is 2...
      for (const [index, subscription] of group.subscriptions.entries()) {
        yield* reconcileSubscription(
          reconcileContext,
          groupId,
          existingSubs,
          subscription,
          index + 1,
        );
      }
    }
  });
/** Create one subscription (if missing), its localizations, and its initial price. */
const reconcileSubscription = (
  reconcileContext: ReconcileContext,
  groupId: string,
  existingSubs: SubscriptionResource[],
  subscription: SubscriptionConfig,
  groupLevel: number,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const match = existingSubs.find((existing) => existing.productId === subscription.productId);
    let subscriptionId: string;
    let existingLocales: Set<string>;
    let priced: boolean;
    if (match) {
      subscriptionId = match.id;
      const locales = yield* reconcileContext.api.listSubscriptionLocalizations(subscriptionId);
      existingLocales = new Set(locales.map((localization) => localization.locale));
      priced = yield* reconcileContext.api.subscriptionHasPrice(subscriptionId);
    } else {
      const createAction = yield* act(
        reconcileContext,
        `create subscription ${subscription.productId} (${subscription.subscriptionPeriod})`,
        false,
        () =>
          reconcileContext.api.createSubscription(groupId, {
            productId: subscription.productId,
            name: subscription.referenceName,
            subscriptionPeriod: subscription.subscriptionPeriod,
            groupLevel,
          }),
      );
      if (!succeededOrPlanned(createAction.status)) return;
      subscriptionId = DRY_RUN_ID;
      if (createAction.actionValue !== undefined) subscriptionId = createAction.actionValue.id;
      existingLocales = new Set();
      priced = false;
    }
    for (const localization of subscription.localizations) {
      if (existingLocales.has(localization.locale)) continue;
      yield* act(
        reconcileContext,
        `add subscription copy ${subscription.productId} [${localization.locale}]`,
        false,
        () => reconcileContext.api.createSubscriptionLocalization(subscriptionId, localization),
      );
    }
    if (subscription.price && !priced) {
      let territory = DEFAULT_TERRITORY;
      if (subscription.price.baseTerritory !== undefined) {
        territory = subscription.price.baseTerritory;
      }
      const customerPrice = subscription.price.customerPrice;
      yield* act(
        reconcileContext,
        `set subscription price ${subscription.productId} = ${customerPrice} (${territory})`,
        false,
        () =>
          Effect.gen(function* () {
            const point = yield* reconcileContext.api.findSubscriptionPricePoint(
              subscriptionId,
              territory,
              customerPrice,
            );
            if (!point)
              return yield* Effect.fail(
                makeCatalogPricePointFailure({
                  message: `No ${territory} price point matches ${customerPrice} for ${subscription.productId}.`,
                }),
              );
            yield* reconcileContext.api.createSubscriptionPrice(subscriptionId, point.id);
          }),
      );
    }
  });
/**
 * Maximum character lengths Apple enforces on the listing fields Launch writes. A value over the limit
 * is rejected at the boundary (recorded as a skipped action) rather than sent for Apple to bounce.
 */
const LISTING_LIMITS: Record<string, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
  whatsNew: 4000,
};
/** Which localization level a set of fields belongs to - used only for readable plan lines. */
type ListingLevel = 'appInfo' | 'version';
/** The result of routing one locale's config into the two App Store Connect localization levels. */
type RoutedListing = {
  appInfo: Record<string, string>;
  version: Record<string, string>;
};
/**
 * Route one locale's `store.config.json` listing into the app-level and version-level field sets,
 * translating field names to Apple's (`title`->`name`, `releaseNotes`->`whatsNew`) and joining keywords
 * into the comma-separated string Apple stores. Only present, non-empty values are carried over.
 */
const routeListing = (localeListing: AppleLocaleInfo): RoutedListing => {
  const appInfo: Record<string, string> = {};
  if (localeListing.title) appInfo['name'] = localeListing.title;
  if (localeListing.subtitle) appInfo['subtitle'] = localeListing.subtitle;
  if (localeListing.privacyPolicyUrl) appInfo['privacyPolicyUrl'] = localeListing.privacyPolicyUrl;
  const version: Record<string, string> = {};
  if (localeListing.description) version['description'] = localeListing.description;
  if (localeListing.keywords !== undefined && localeListing.keywords.length > 0) {
    version['keywords'] = localeListing.keywords.join(',');
  }
  if (localeListing.releaseNotes) version['whatsNew'] = localeListing.releaseNotes;
  if (localeListing.promotionalText) version['promotionalText'] = localeListing.promotionalText;
  if (localeListing.supportUrl) version['supportUrl'] = localeListing.supportUrl;
  if (localeListing.marketingUrl) version['marketingUrl'] = localeListing.marketingUrl;
  return { appInfo, version };
};
/** Split a field set into the ones within Apple's length limits and human errors for the rest. */
const validateListing = (
  fields: Record<string, string>,
): {
  valid: Record<string, string>;
  errors: string[];
} => {
  const valid: Record<string, string> = {};
  const errors: string[] = [];
  for (const [fieldName, fieldText] of Object.entries(fields)) {
    const limit = LISTING_LIMITS[fieldName];
    if (limit !== undefined && fieldText.length > limit) {
      errors.push(`${fieldName} is ${fieldText.length} chars (max ${limit})`);
    } else {
      valid[fieldName] = fieldText;
    }
  }
  return { valid, errors };
};
/** The subset of `desired` whose value differs from what's already stored - i.e. what a PATCH must send. */
const changedFields = (
  desired: Record<string, string>,
  current: Record<string, string>,
): Record<string, string> => {
  const changed: Record<string, string> = {};
  for (const [fieldName, desiredText] of Object.entries(desired)) {
    if (current[fieldName] !== desiredText) changed[fieldName] = desiredText;
  }
  return changed;
};
/** Render a field as a short quoted preview for the plan, or `(unset)` when absent. */
const preview = (fieldText: string | undefined): string => {
  if (fieldText === undefined) return '(unset)';
  let previewText = fieldText;
  if (fieldText.length > 24) previewText = `${fieldText.slice(0, 24)}...`;
  return `"${previewText}"`;
};
/** Describe old-to-new field changes for the dry-run plan. */
const describeChanges = (
  changed: Record<string, string>,
  current: Record<string, string>,
): string => {
  return Object.keys(changed)
    .map((key) => `${key} ${preview(current[key])}->${preview(changed[key])}`)
    .join(', ');
};
/** Human label for a localization level in plan lines. */
const levelLabel = (level: ListingLevel): string => {
  if (level === 'appInfo') return 'App Info';
  return 'App Store version';
};
/** Operations + current state for reconciling one locale at one localization level. */
type LevelReconcile = {
  level: ListingLevel;
  locale: string;
  desired: Record<string, string>;
  parentId: string | null;
  current: ListingLocalization | undefined;
  requiredKey?: string;
  create: (parentId: string, fields: Record<string, string>) => Effect.Effect<void, unknown>;
  update: (localizationId: string, fields: Record<string, string>) => Effect.Effect<void, unknown>;
};
/** Reconcile one locale at one level: validate lengths, then create the locale or patch changed fields. */
const reconcileLevel = (
  reconcileContext: ReconcileContext,
  ops: LevelReconcile,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { valid, errors } = validateListing(ops.desired);
    for (const error of errors) {
      reconcileContext.actions.push({
        description: `listing [${ops.locale}] ${levelLabel(ops.level)}: ${error} - skipped`,
        destructive: false,
        status: 'skipped',
      });
    }
    if (Object.keys(valid).length === 0) return;
    const parentId = ops.parentId;
    if (!parentId) {
      reconcileContext.actions.push({
        description: `listing [${ops.locale}] ${levelLabel(ops.level)}: no editable ${levelLabel(ops.level)} to update - prepare one in App Store Connect`,
        destructive: false,
        status: 'skipped',
      });
      return;
    }
    if (ops.current) {
      const changed = changedFields(valid, ops.current.fields);
      if (Object.keys(changed).length === 0) return;
      const { id, fields } = ops.current;
      yield* act(
        reconcileContext,
        `update listing [${ops.locale}] ${levelLabel(ops.level)}: ${describeChanges(changed, fields)}`,
        false,
        () => ops.update(id, changed),
      );
      return;
    }
    if (ops.requiredKey && !(ops.requiredKey in valid)) {
      reconcileContext.actions.push({
        description: `listing [${ops.locale}] ${levelLabel(ops.level)}: needs ${ops.requiredKey} to create the locale - skipped`,
        destructive: false,
        status: 'skipped',
      });
      return;
    }
    yield* act(
      reconcileContext,
      `create listing [${ops.locale}] ${levelLabel(ops.level)}: ${Object.keys(valid).join(', ')}`,
      false,
      () => ops.create(parentId, valid),
    );
  });
/**
 * Reconcile the app's textual store listing per locale, at both levels: app-level (`appInfoLocalizations`
 * - name/subtitle/privacy URL) and version-level (`appStoreVersionLocalizations` - description, keywords,
 * what's new, promo text, URLs). Resolves the editable appInfo + App Store version once, then for each
 * declared locale patches only the fields that differ (or creates the locale when Apple lacks it). When
 * no editable target exists, the affected fields are recorded as skipped with guidance.
 */
const reconcileListing = (
  reconcileContext: ReconcileContext,
  appId: string,
  listing: AppleStoreConfig,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const locales = Object.entries(listing.info);
    if (locales.length === 0) return;
    const appInfoId = yield* reconcileContext.api.getEditableAppInfoId(appId);
    const versionId = yield* reconcileContext.api.getEditableVersionId(appId);
    let appInfoLocales: ListingLocalization[] = [];
    if (appInfoId !== null) {
      appInfoLocales = yield* reconcileContext.api.listAppInfoLocalizations(appInfoId);
    }
    let versionLocales: ListingLocalization[] = [];
    if (versionId !== null) {
      versionLocales = yield* reconcileContext.api.listVersionLocalizations(versionId);
    }
    const appInfoByLocale = new Map(
      appInfoLocales.map((localization) => [localization.locale, localization]),
    );
    const versionByLocale = new Map(
      versionLocales.map((localization) => [localization.locale, localization]),
    );
    for (const [locale, localeListing] of locales) {
      const routed = routeListing(localeListing);
      yield* reconcileLevel(reconcileContext, {
        level: 'appInfo',
        locale,
        desired: routed.appInfo,
        parentId: appInfoId,
        current: appInfoByLocale.get(locale),
        requiredKey: 'name',
        create: (parentId, fields) =>
          reconcileContext.api.createAppInfoLocalization(parentId, locale, fields),
        update: (id, fields) => reconcileContext.api.updateAppInfoLocalization(id, fields),
      });
      yield* reconcileLevel(reconcileContext, {
        level: 'version',
        locale,
        desired: routed.version,
        parentId: versionId,
        current: versionByLocale.get(locale),
        create: (parentId, fields) =>
          reconcileContext.api.createVersionLocalization(parentId, locale, fields),
        update: (id, fields) => reconcileContext.api.updateVersionLocalization(id, fields),
      });
    }
  });
