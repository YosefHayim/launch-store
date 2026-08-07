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
import type {
  AppProducts,
  InAppPurchaseConfig,
  ProductPrice,
  SubscriptionConfig,
} from '../types/catalog.js';
import type { ActionStatus, PlannedAction, ReconcileReport } from '../types/reconcile.js';
import { appRecordMissing } from './reconcile.js';

/**
 * ASC catalog surface the reconciler depends on. Structural subset of
 * `AppStoreConnectClient` so unit tests supply a hand fake without the live client.
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

/** Full catalog reconcile inputs (capabilities + products + optional listing). */
export type ReconcileInput = {
  bundleId: string;
  capabilities: CapabilityType[];
  products: AppProducts;
  listing?: AppleStoreConfig;
  dryRun: boolean;
  allowDestructive: boolean;
};

/** Listing-only reconcile inputs (`launch plan listing` / snapshot listing source). */
export type ListingReconcileInput = {
  bundleId: string;
  listing: AppleStoreConfig;
  dryRun: boolean;
};

/** Default base territory when a product price omits one. */
const DEFAULT_TERRITORY = 'USA';

type CatalogPricePointFailure = Readonly<{
  readonly _tag: 'CatalogPricePointFailure';
  readonly message: string;
}>;

const makeCatalogPricePointFailure = Data.tagged<CatalogPricePointFailure>(
  'CatalogPricePointFailure',
);

/** Stand-in parent id when a create was planned only (dry-run) so dependent plan lines still chain. */
export const DRY_RUN_ID = '(dry-run)';

/**
 * Capabilities Apple enables on every App ID and will not remove. Never plan a disable for these
 * merely because config omits them.
 */
const ALWAYS_ENABLED_CAPABILITIES = new Set<string>(['IN_APP_PURCHASE', 'GAME_CENTER']);

/**
 * Shared plan/apply log. `dryRun: true` is plan-only (record, no write); `dryRun: false` applies
 * non-destructive writes and destructive ones only when `allowDestructive`. Exported so
 * `ascScreenshots` reuses the same plan/apply vocabulary without taking the catalog API.
 */
export type ActionLog = {
  actions: PlannedAction[];
  dryRun: boolean;
  allowDestructive: boolean;
};

type CatalogReconcileContext = ActionLog & {
  api: AscCatalogApi;
};

/** True when an action completed or was intentionally planned (safe parent for dependent work). */
export const succeededOrPlanned = (status: ActionStatus): boolean => {
  if (status === 'applied') return true;
  return status === 'planned';
};

/**
 * Plan an action, then apply it unless dry-run. Destructive writes stay skipped without
 * `allowDestructive`. Write failures mark the action `failed` and do not abort the walk.
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

const skipAction = (actionLog: ActionLog, description: string): void => {
  actionLog.actions.push({ description, destructive: false, status: 'skipped' });
};

/** Parent id after a create act: live id, dry-run placeholder, or undefined when create failed. */
const parentIdAfterCreate = <CreatedResource extends { readonly id: string }>(createAction: {
  readonly status: ActionStatus;
  readonly actionValue?: CreatedResource;
}): string | undefined => {
  if (!succeededOrPlanned(createAction.status)) return undefined;
  if (createAction.actionValue !== undefined) return createAction.actionValue.id;
  return DRY_RUN_ID;
};

const territoryForPrice = (productPrice: ProductPrice): string => {
  if (productPrice.baseTerritory !== undefined) return productPrice.baseTerritory;
  return DEFAULT_TERRITORY;
};

/** Plan/apply the first price for a product that still lacks one. */
const assignInitialPrice = (
  catalogContext: CatalogReconcileContext,
  description: string,
  missingPriceMessage: string,
  findPricePoint: () => Effect.Effect<PricePointResource | null, unknown>,
  writePrice: (pricePointId: string) => Effect.Effect<void, unknown>,
) =>
  act(catalogContext, description, false, () =>
    Effect.gen(function* () {
      const pricePoint = yield* findPricePoint();
      if (!pricePoint) {
        return yield* Effect.fail(makeCatalogPricePointFailure({ message: missingPriceMessage }));
      }
      yield* writePrice(pricePoint.id);
    }),
  );

const requireAppStoreRecordId = (
  api: AscCatalogApi,
  bundleId: string,
): Effect.Effect<string, unknown> =>
  Effect.gen(function* () {
    const appId = yield* api.getAppId(bundleId);
    if (!appId) return yield* Effect.fail(appRecordMissing(bundleId, 'sync'));
    return appId;
  });

const emptyCatalogContext = (
  api: AscCatalogApi,
  dryRun: boolean,
  allowDestructive: boolean,
): CatalogReconcileContext => ({
  api,
  actions: [],
  dryRun,
  allowDestructive,
});

/**
 * Full catalog reconcile in dependency order: capabilities, IAPs, subscription groups, then listing.
 * Plan: `dryRun: true`. Apply: `dryRun: false` (destructive gated by `allowDestructive`).
 * Fails only when the ASC app record is missing; every other miss is a per-action status.
 */
export const reconcileApp = (
  api: AscCatalogApi,
  input: ReconcileInput,
): Effect.Effect<ReconcileReport, unknown> =>
  Effect.gen(function* () {
    const catalogContext = emptyCatalogContext(api, input.dryRun, input.allowDestructive);
    const appId = yield* requireAppStoreRecordId(api, input.bundleId);
    yield* reconcileCapabilities(catalogContext, input.bundleId, input.capabilities);
    let desiredInAppPurchases: readonly InAppPurchaseConfig[] = [];
    if (input.products.inAppPurchases !== undefined) {
      desiredInAppPurchases = input.products.inAppPurchases;
    }
    yield* reconcileInAppPurchases(catalogContext, appId, desiredInAppPurchases);
    let desiredSubscriptionGroups: NonNullable<AppProducts['subscriptionGroups']> = [];
    if (input.products.subscriptionGroups !== undefined) {
      desiredSubscriptionGroups = input.products.subscriptionGroups;
    }
    yield* reconcileSubscriptionGroups(catalogContext, appId, desiredSubscriptionGroups);
    if (input.listing) yield* reconcileListing(catalogContext, appId, input.listing);
    return { bundleId: input.bundleId, actions: catalogContext.actions };
  });

/**
 * Listing-only reconcile for `launch plan listing` / snapshot - never double-counts catalog
 * surfaces. Listing is create/patch only, so `allowDestructive` is always false.
 */
export const reconcileAppListing = (
  api: AscCatalogApi,
  input: ListingReconcileInput,
): Effect.Effect<ReconcileReport, unknown> =>
  Effect.gen(function* () {
    const catalogContext = emptyCatalogContext(api, input.dryRun, false);
    const appId = yield* requireAppStoreRecordId(api, input.bundleId);
    yield* reconcileListing(catalogContext, appId, input.listing);
    return { bundleId: input.bundleId, actions: catalogContext.actions };
  });

const reconcileCapabilities = (
  catalogContext: CatalogReconcileContext,
  bundleId: string,
  desiredCapabilities: CapabilityType[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const bundleIdResource = yield* catalogContext.api.findBundleId(bundleId);
    if (!bundleIdResource) {
      if (desiredCapabilities.length > 0) {
        let capabilityNoun = 'capabilities';
        if (desiredCapabilities.length === 1) capabilityNoun = 'capability';
        skipAction(
          catalogContext,
          `bundle id ${bundleId} is not registered yet - run a build (or \`launch creds\`) to register it before syncing ${desiredCapabilities.length} ${capabilityNoun}`,
        );
      }
      return;
    }
    const liveCapabilities = yield* catalogContext.api.listBundleIdCapabilities(
      bundleIdResource.id,
    );
    const liveCapabilityTypes = new Set(
      liveCapabilities.map((capability) => capability.capabilityType),
    );
    for (const capability of desiredCapabilities) {
      if (liveCapabilityTypes.has(capability)) continue;
      yield* act(catalogContext, `enable capability ${capability}`, false, () =>
        catalogContext.api.enableCapability(bundleIdResource.id, capability),
      );
    }
    const desiredCapabilityTypes = new Set<string>(desiredCapabilities);
    for (const liveCapability of liveCapabilities) {
      if (desiredCapabilityTypes.has(liveCapability.capabilityType)) continue;
      if (ALWAYS_ENABLED_CAPABILITIES.has(liveCapability.capabilityType)) continue;
      yield* act(catalogContext, `disable capability ${liveCapability.capabilityType}`, true, () =>
        catalogContext.api.disableCapability(liveCapability.id),
      );
    }
  });

const reconcileInAppPurchases = (
  catalogContext: CatalogReconcileContext,
  appId: string,
  desiredPurchases: readonly InAppPurchaseConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (desiredPurchases.length === 0) return;
    const livePurchases = yield* catalogContext.api.listInAppPurchases(appId);
    for (const desiredPurchase of desiredPurchases) {
      const existingPurchase = livePurchases.find(
        (livePurchase) => livePurchase.productId === desiredPurchase.productId,
      );
      let purchaseId: string;
      let existingLocales: Set<string>;
      let alreadyPriced: boolean;
      if (existingPurchase) {
        purchaseId = existingPurchase.id;
        const localizations = yield* catalogContext.api.listInAppPurchaseLocalizations(purchaseId);
        existingLocales = new Set(localizations.map((localization) => localization.locale));
        alreadyPriced = yield* catalogContext.api.inAppPurchaseHasPrice(purchaseId);
      } else {
        const createAction = yield* act(
          catalogContext,
          `create in-app purchase ${desiredPurchase.productId} (${desiredPurchase.type})`,
          false,
          () =>
            catalogContext.api.createInAppPurchase(appId, {
              productId: desiredPurchase.productId,
              name: desiredPurchase.referenceName,
              inAppPurchaseType: desiredPurchase.type,
            }),
        );
        const createdId = parentIdAfterCreate(createAction);
        if (createdId === undefined) continue;
        purchaseId = createdId;
        existingLocales = new Set();
        alreadyPriced = false;
      }
      for (const localization of desiredPurchase.localizations) {
        if (existingLocales.has(localization.locale)) continue;
        yield* act(
          catalogContext,
          `add IAP copy ${desiredPurchase.productId} [${localization.locale}]`,
          false,
          () => catalogContext.api.createInAppPurchaseLocalization(purchaseId, localization),
        );
      }
      if (desiredPurchase.price && !alreadyPriced) {
        const territory = territoryForPrice(desiredPurchase.price);
        const customerPrice = desiredPurchase.price.customerPrice;
        yield* assignInitialPrice(
          catalogContext,
          `set IAP price ${desiredPurchase.productId} = ${customerPrice} (${territory})`,
          `No ${territory} price point matches ${customerPrice} for ${desiredPurchase.productId}.`,
          () =>
            catalogContext.api.findInAppPurchasePricePoint(purchaseId, territory, customerPrice),
          (pricePointId) =>
            catalogContext.api.createInAppPurchasePriceSchedule(
              purchaseId,
              territory,
              pricePointId,
            ),
        );
      }
    }
  });

const reconcileSubscriptionGroups = (
  catalogContext: CatalogReconcileContext,
  appId: string,
  desiredGroups: NonNullable<AppProducts['subscriptionGroups']>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (desiredGroups.length === 0) return;
    const liveGroups = yield* catalogContext.api.listSubscriptionGroups(appId);
    for (const desiredGroup of desiredGroups) {
      const existingGroup = liveGroups.find(
        (liveGroup) => liveGroup.referenceName === desiredGroup.referenceName,
      );
      let groupId: string;
      let existingGroupLocales: Set<string>;
      let liveSubscriptions: SubscriptionResource[];
      if (existingGroup) {
        groupId = existingGroup.id;
        const groupLocalizations =
          yield* catalogContext.api.listSubscriptionGroupLocalizations(groupId);
        existingGroupLocales = new Set(
          groupLocalizations.map((localization) => localization.locale),
        );
        liveSubscriptions = yield* catalogContext.api.listSubscriptions(groupId);
      } else {
        const createAction = yield* act(
          catalogContext,
          `create subscription group "${desiredGroup.referenceName}"`,
          false,
          () => catalogContext.api.createSubscriptionGroup(appId, desiredGroup.referenceName),
        );
        const createdId = parentIdAfterCreate(createAction);
        if (createdId === undefined) continue;
        groupId = createdId;
        existingGroupLocales = new Set();
        liveSubscriptions = [];
      }
      for (const localization of desiredGroup.localizations) {
        if (existingGroupLocales.has(localization.locale)) continue;
        yield* act(
          catalogContext,
          `add group name "${desiredGroup.referenceName}" [${localization.locale}]`,
          false,
          () => catalogContext.api.createSubscriptionGroupLocalization(groupId, localization),
        );
      }
      // Config order is the level ranking: first subscription is level 1, next is 2, ...
      for (const [index, subscription] of desiredGroup.subscriptions.entries()) {
        yield* reconcileSubscription(
          catalogContext,
          groupId,
          liveSubscriptions,
          subscription,
          index + 1,
        );
      }
    }
  });

const reconcileSubscription = (
  catalogContext: CatalogReconcileContext,
  groupId: string,
  liveSubscriptions: SubscriptionResource[],
  desiredSubscription: SubscriptionConfig,
  groupLevel: number,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const existingSubscription = liveSubscriptions.find(
      (liveSubscription) => liveSubscription.productId === desiredSubscription.productId,
    );
    let subscriptionId: string;
    let existingLocales: Set<string>;
    let alreadyPriced: boolean;
    if (existingSubscription) {
      subscriptionId = existingSubscription.id;
      const localizations = yield* catalogContext.api.listSubscriptionLocalizations(subscriptionId);
      existingLocales = new Set(localizations.map((localization) => localization.locale));
      alreadyPriced = yield* catalogContext.api.subscriptionHasPrice(subscriptionId);
    } else {
      const createAction = yield* act(
        catalogContext,
        `create subscription ${desiredSubscription.productId} (${desiredSubscription.subscriptionPeriod})`,
        false,
        () =>
          catalogContext.api.createSubscription(groupId, {
            productId: desiredSubscription.productId,
            name: desiredSubscription.referenceName,
            subscriptionPeriod: desiredSubscription.subscriptionPeriod,
            groupLevel,
          }),
      );
      const createdId = parentIdAfterCreate(createAction);
      if (createdId === undefined) return;
      subscriptionId = createdId;
      existingLocales = new Set();
      alreadyPriced = false;
    }
    for (const localization of desiredSubscription.localizations) {
      if (existingLocales.has(localization.locale)) continue;
      yield* act(
        catalogContext,
        `add subscription copy ${desiredSubscription.productId} [${localization.locale}]`,
        false,
        () => catalogContext.api.createSubscriptionLocalization(subscriptionId, localization),
      );
    }
    if (desiredSubscription.price && !alreadyPriced) {
      const territory = territoryForPrice(desiredSubscription.price);
      const customerPrice = desiredSubscription.price.customerPrice;
      yield* assignInitialPrice(
        catalogContext,
        `set subscription price ${desiredSubscription.productId} = ${customerPrice} (${territory})`,
        `No ${territory} price point matches ${customerPrice} for ${desiredSubscription.productId}.`,
        () =>
          catalogContext.api.findSubscriptionPricePoint(subscriptionId, territory, customerPrice),
        (pricePointId) => catalogContext.api.createSubscriptionPrice(subscriptionId, pricePointId),
      );
    }
  });

/** Apple field length caps; over-limit fields become skipped plan lines, never sent. */
const LISTING_LIMITS: Record<string, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
  whatsNew: 4000,
};

type ListingLevel = 'appInfo' | 'version';

type RoutedListing = {
  appInfo: Record<string, string>;
  version: Record<string, string>;
};

/** Map one locale's store config into ASC app-info vs version field sets. */
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

const validateListingFields = (
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

const changedListingFields = (
  desiredFields: Record<string, string>,
  liveFields: Record<string, string>,
): Record<string, string> => {
  const changed: Record<string, string> = {};
  for (const [fieldName, desiredText] of Object.entries(desiredFields)) {
    if (liveFields[fieldName] !== desiredText) changed[fieldName] = desiredText;
  }
  return changed;
};

const fieldPreview = (fieldText: string | undefined): string => {
  if (fieldText === undefined) return '(unset)';
  let previewText = fieldText;
  if (fieldText.length > 24) previewText = `${fieldText.slice(0, 24)}...`;
  return `"${previewText}"`;
};

const describeFieldChanges = (
  changed: Record<string, string>,
  liveFields: Record<string, string>,
): string => {
  return Object.keys(changed)
    .map((key) => `${key} ${fieldPreview(liveFields[key])}->${fieldPreview(changed[key])}`)
    .join(', ');
};

const listingLevelLabel = (level: ListingLevel): string => {
  if (level === 'appInfo') return 'App Info';
  return 'App Store version';
};

type ListingLevelWork = {
  level: ListingLevel;
  locale: string;
  desiredFields: Record<string, string>;
  parentId: string | null;
  liveLocalization: ListingLocalization | undefined;
  requiredKey?: string;
  createLocalization: (
    parentId: string,
    fields: Record<string, string>,
  ) => Effect.Effect<void, unknown>;
  updateLocalization: (
    localizationId: string,
    fields: Record<string, string>,
  ) => Effect.Effect<void, unknown>;
};

const reconcileListingLevel = (
  catalogContext: CatalogReconcileContext,
  levelWork: ListingLevelWork,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { valid, errors } = validateListingFields(levelWork.desiredFields);
    for (const error of errors) {
      skipAction(
        catalogContext,
        `listing [${levelWork.locale}] ${listingLevelLabel(levelWork.level)}: ${error} - skipped`,
      );
    }
    if (Object.keys(valid).length === 0) return;
    const parentId = levelWork.parentId;
    if (!parentId) {
      skipAction(
        catalogContext,
        `listing [${levelWork.locale}] ${listingLevelLabel(levelWork.level)}: no editable ${listingLevelLabel(levelWork.level)} to update - prepare one in App Store Connect`,
      );
      return;
    }
    if (levelWork.liveLocalization) {
      const changed = changedListingFields(valid, levelWork.liveLocalization.fields);
      if (Object.keys(changed).length === 0) return;
      const { id, fields } = levelWork.liveLocalization;
      yield* act(
        catalogContext,
        `update listing [${levelWork.locale}] ${listingLevelLabel(levelWork.level)}: ${describeFieldChanges(changed, fields)}`,
        false,
        () => levelWork.updateLocalization(id, changed),
      );
      return;
    }
    if (levelWork.requiredKey && !(levelWork.requiredKey in valid)) {
      skipAction(
        catalogContext,
        `listing [${levelWork.locale}] ${listingLevelLabel(levelWork.level)}: needs ${levelWork.requiredKey} to create the locale - skipped`,
      );
      return;
    }
    yield* act(
      catalogContext,
      `create listing [${levelWork.locale}] ${listingLevelLabel(levelWork.level)}: ${Object.keys(valid).join(', ')}`,
      false,
      () => levelWork.createLocalization(parentId, valid),
    );
  });

const reconcileListing = (
  catalogContext: CatalogReconcileContext,
  appId: string,
  listing: AppleStoreConfig,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const locales = Object.entries(listing.info);
    if (locales.length === 0) return;
    const appInfoId = yield* catalogContext.api.getEditableAppInfoId(appId);
    const versionId = yield* catalogContext.api.getEditableVersionId(appId);
    let appInfoLocales: ListingLocalization[] = [];
    if (appInfoId !== null) {
      appInfoLocales = yield* catalogContext.api.listAppInfoLocalizations(appInfoId);
    }
    let versionLocales: ListingLocalization[] = [];
    if (versionId !== null) {
      versionLocales = yield* catalogContext.api.listVersionLocalizations(versionId);
    }
    const appInfoByLocale = new Map(
      appInfoLocales.map((localization) => [localization.locale, localization]),
    );
    const versionByLocale = new Map(
      versionLocales.map((localization) => [localization.locale, localization]),
    );
    for (const [locale, localeListing] of locales) {
      const routed = routeListing(localeListing);
      yield* reconcileListingLevel(catalogContext, {
        level: 'appInfo',
        locale,
        desiredFields: routed.appInfo,
        parentId: appInfoId,
        liveLocalization: appInfoByLocale.get(locale),
        requiredKey: 'name',
        createLocalization: (parentId, fields) =>
          catalogContext.api.createAppInfoLocalization(parentId, locale, fields),
        updateLocalization: (localizationId, fields) =>
          catalogContext.api.updateAppInfoLocalization(localizationId, fields),
      });
      yield* reconcileListingLevel(catalogContext, {
        level: 'version',
        locale,
        desiredFields: routed.version,
        parentId: versionId,
        liveLocalization: versionByLocale.get(locale),
        createLocalization: (parentId, fields) =>
          catalogContext.api.createVersionLocalization(parentId, locale, fields),
        updateLocalization: (localizationId, fields) =>
          catalogContext.api.updateVersionLocalization(localizationId, fields),
      });
    }
  });
