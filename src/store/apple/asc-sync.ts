import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  InAppPurchaseResource,
  ListingLocalization,
  LocalizationResource,
  PricePointResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from '../../types/apple-catalog.ts';
import type { CapabilityType } from '../../credentials/capabilities.ts';
import { errorMessage } from '../../services/platform/error-message.ts';
import type { AppleLocaleInfo, AppleStoreConfig } from '../shared/store-config.ts';
import type {
  AppProducts,
  InAppPurchaseConfig,
  ProductPrice,
  SubscriptionConfig,
} from '../../types/catalog.ts';
import type { ActionStatus, PlannedAction, ReconcileReport } from '../../types/reconcile.ts';
import { appRecordMissing } from '../shared/reconcile.ts';

/**
 * ASC catalog surface the reconciler depends on. Structural subset of
 * `AppStoreConnectClient` so unit tests supply a hand fake without the live client.
 */
export type AscCatalogApi = {
  getAppId(bundleId: string): Promise<string | null>;
  findBundleId(identifier: string): Promise<BundleIdResource | null>;
  listBundleIdCapabilities(bundleIdResourceId: string): Promise<BundleIdCapabilityResource[]>;
  enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource>;
  disableCapability(capabilityId: string): Promise<void>;
  listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]>;
  createInAppPurchase(
    appId: string,
    purchase: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ): Promise<InAppPurchaseResource>;
  listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]>;
  createInAppPurchaseLocalization(
    iapId: string,
    localization: {
      locale: string;
      name: string;
      description?: string | undefined;
    },
  ): Promise<LocalizationResource>;
  inAppPurchaseHasPrice(iapId: string): Promise<boolean>;
  findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null>;
  createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void>;
  listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]>;
  createSubscriptionGroup(appId: string, referenceName: string): Promise<SubscriptionGroupResource>;
  listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]>;
  createSubscriptionGroupLocalization(
    groupId: string,
    localization: {
      locale: string;
      name: string;
    },
  ): Promise<LocalizationResource>;
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]>;
  createSubscription(
    groupId: string,
    subscription: {
      productId: string;
      name: string;
      subscriptionPeriod: string;
      groupLevel: number;
    },
  ): Promise<SubscriptionResource>;
  listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]>;
  createSubscriptionLocalization(
    subscriptionId: string,
    localization: {
      locale: string;
      name: string;
      description?: string | undefined;
    },
  ): Promise<LocalizationResource>;
  subscriptionHasPrice(subscriptionId: string): Promise<boolean>;
  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null>;
  createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void>;
  getEditableAppInfoId(appId: string): Promise<string | null>;
  listAppInfoLocalizations(appInfoId: string): Promise<ListingLocalization[]>;
  createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void>;
  updateAppInfoLocalization(localizationId: string, fields: Record<string, string>): Promise<void>;
  getEditableVersionId(appId: string): Promise<string | null>;
  listVersionLocalizations(versionId: string): Promise<ListingLocalization[]>;
  createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void>;
  updateVersionLocalization(localizationId: string, fields: Record<string, string>): Promise<void>;
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

function makeCatalogPricePointFailure(message: string): CatalogPricePointFailure {
  return { _tag: 'CatalogPricePointFailure', message };
}

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
export function succeededOrPlanned(status: ActionStatus): boolean {
  if (status == 'applied') {
    return true;
  }

  return status == 'planned';
}

/**
 * Plan an action, then apply it unless dry-run. Destructive writes stay skipped without
 * `allowDestructive`. Write failures mark the action `failed` and do not abort the walk.
 */
export async function act<CreatedResource>(
  actionLog: ActionLog,
  description: string,
  destructive: boolean,
  performWrite: () => Promise<CreatedResource>,
): Promise<{
  status: ActionStatus;
  actionValue?: CreatedResource;
}> {
  const plannedAction: PlannedAction = { description, destructive, status: 'planned' };
  actionLog.actions.push(plannedAction);

  const isDryRun = actionLog.dryRun == true;

  if (isDryRun) {
    return { status: plannedAction.status };
  }

  const isDestructive = destructive == true;

  if (isDestructive) {
    const allowsDestructive = actionLog.allowDestructive == true;

    if (allowsDestructive == false) {
      plannedAction.status = 'skipped';
      return { status: 'skipped' };
    }
  }

  try {
    const createdResource = await performWrite();
    plannedAction.status = 'applied';
    return { status: 'applied', actionValue: createdResource };
  } catch (writeFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(writeFailure);
    return { status: 'failed' };
  }
}

function skipAction(actionLog: ActionLog, description: string): void {
  actionLog.actions.push({ description, destructive: false, status: 'skipped' });
}

/** Parent id after a create act: live id, dry-run placeholder, or undefined when create failed. */
function parentIdAfterCreate<CreatedResource extends { readonly id: string }>(createAction: {
  readonly status: ActionStatus;
  readonly actionValue?: CreatedResource;
}): string | undefined {
  const canChain = succeededOrPlanned(createAction.status);

  if (canChain == false) {
    return undefined;
  }

  const createdResource = createAction.actionValue;
  const hasCreatedResource = createdResource != null;

  if (hasCreatedResource) {
    return createdResource.id;
  }

  return DRY_RUN_ID;
}

function territoryForPrice(productPrice: ProductPrice): string {
  const baseTerritory = productPrice.baseTerritory;
  const hasBaseTerritory = baseTerritory != null;

  if (hasBaseTerritory) {
    return baseTerritory;
  }

  return DEFAULT_TERRITORY;
}

function readUnpricedProduct(
  productPrice: ProductPrice | undefined,
  alreadyPriced: boolean,
): ProductPrice | null {
  if (productPrice == null) {
    return null;
  }

  if (alreadyPriced) {
    return null;
  }

  return productPrice;
}

/** Plan/apply the first price for a product that still lacks one. */
async function assignInitialPrice(
  catalogContext: CatalogReconcileContext,
  description: string,
  missingPriceMessage: string,
  findPricePoint: () => Promise<PricePointResource | null>,
  writePrice: (pricePointId: string) => Promise<void>,
): Promise<{ status: ActionStatus }> {
  async function writeInitialPrice(): Promise<void> {
    const pricePoint = await findPricePoint();
    const isPricePointMissing = pricePoint == null;

    if (isPricePointMissing) {
      throw makeCatalogPricePointFailure(missingPriceMessage);
    }

    await writePrice(pricePoint.id);
  }

  return act(catalogContext, description, false, writeInitialPrice);
}

function readAppStoreRecordId(appId: string | null): string | null {
  if (appId == null) {
    return null;
  }

  if (appId == '') {
    return null;
  }

  return appId;
}

async function requireAppStoreRecordId(api: AscCatalogApi, bundleId: string): Promise<string> {
  const appId = await api.getAppId(bundleId);
  const recordId = readAppStoreRecordId(appId);

  if (recordId == null) {
    throw appRecordMissing(bundleId, 'sync');
  }

  return recordId;
}

function emptyCatalogContext(
  api: AscCatalogApi,
  dryRun: boolean,
  allowDestructive: boolean,
): CatalogReconcileContext {
  return {
    api,
    actions: [],
    dryRun,
    allowDestructive,
  };
}

/**
 * Full catalog reconcile in dependency order: capabilities, IAPs, subscription groups, then listing.
 * Plan: `dryRun: true`. Apply: `dryRun: false` (destructive gated by `allowDestructive`).
 * Fails only when the ASC app record is missing; every other miss is a per-action status.
 */
export async function reconcileApp(
  api: AscCatalogApi,
  reconcileInput: ReconcileInput,
): Promise<ReconcileReport> {
  const catalogContext = emptyCatalogContext(
    api,
    reconcileInput.dryRun,
    reconcileInput.allowDestructive,
  );
  const appId = await requireAppStoreRecordId(api, reconcileInput.bundleId);
  await reconcileCapabilities(catalogContext, reconcileInput.bundleId, reconcileInput.capabilities);

  let desiredInAppPurchases: readonly InAppPurchaseConfig[] = [];
  const declaredPurchases = reconcileInput.products.inAppPurchases;
  const hasDeclaredPurchases = declaredPurchases != null;

  if (hasDeclaredPurchases) {
    desiredInAppPurchases = declaredPurchases;
  }

  await reconcileInAppPurchases(catalogContext, appId, desiredInAppPurchases);

  let desiredSubscriptionGroups: NonNullable<AppProducts['subscriptionGroups']> = [];
  const declaredGroups = reconcileInput.products.subscriptionGroups;
  const hasDeclaredGroups = declaredGroups != null;

  if (hasDeclaredGroups) {
    desiredSubscriptionGroups = declaredGroups;
  }

  await reconcileSubscriptionGroups(catalogContext, appId, desiredSubscriptionGroups);

  const listing = reconcileInput.listing;
  const hasListing = listing != null;

  if (hasListing) {
    await reconcileListing(catalogContext, appId, listing);
  }

  return { bundleId: reconcileInput.bundleId, actions: catalogContext.actions };
}

/**
 * Listing-only reconcile for `launch plan listing` / snapshot - never double-counts catalog
 * surfaces. Listing is create/patch only, so `allowDestructive` is always false.
 */
export async function reconcileAppListing(
  api: AscCatalogApi,
  listingInput: ListingReconcileInput,
): Promise<ReconcileReport> {
  const catalogContext = emptyCatalogContext(api, listingInput.dryRun, false);
  const appId = await requireAppStoreRecordId(api, listingInput.bundleId);
  await reconcileListing(catalogContext, appId, listingInput.listing);
  return { bundleId: listingInput.bundleId, actions: catalogContext.actions };
}

function capabilityNoun(desiredCount: number): string {
  const isSingleCapability = desiredCount == 1;

  if (isSingleCapability) {
    return 'capability';
  }

  return 'capabilities';
}

function noteUnregisteredBundle(
  catalogContext: CatalogReconcileContext,
  bundleId: string,
  desiredCapabilities: CapabilityType[],
): void {
  const hasDesiredCapabilities = desiredCapabilities.length > 0;

  if (hasDesiredCapabilities == false) {
    return;
  }

  skipAction(
    catalogContext,
    `bundle id ${bundleId} is not registered yet - run a build (or \`launch creds\`) to register it before syncing ${desiredCapabilities.length} ${capabilityNoun(desiredCapabilities.length)}`,
  );
}

function readCapabilityType(capability: BundleIdCapabilityResource): string {
  return capability.capabilityType;
}

async function reconcileCapabilities(
  catalogContext: CatalogReconcileContext,
  bundleId: string,
  desiredCapabilities: CapabilityType[],
): Promise<void> {
  const bundleIdResource = await catalogContext.api.findBundleId(bundleId);
  const isBundleMissing = bundleIdResource == null;

  if (isBundleMissing) {
    noteUnregisteredBundle(catalogContext, bundleId, desiredCapabilities);
    return;
  }

  const liveCapabilities = await catalogContext.api.listBundleIdCapabilities(bundleIdResource.id);
  const liveCapabilityTypes = new Set(liveCapabilities.map(readCapabilityType));

  for (const capability of desiredCapabilities) {
    const isAlreadyEnabled = liveCapabilityTypes.has(capability);

    if (isAlreadyEnabled) {
      continue;
    }

    await act(
      catalogContext,
      `enable capability ${capability}`,
      false,
      function enableCapability() {
        return catalogContext.api.enableCapability(bundleIdResource.id, capability);
      },
    );
  }

  const desiredCapabilityTypes = new Set<string>(desiredCapabilities);

  for (const liveCapability of liveCapabilities) {
    const isDesired = desiredCapabilityTypes.has(liveCapability.capabilityType);

    if (isDesired) {
      continue;
    }

    const isAlwaysEnabled = ALWAYS_ENABLED_CAPABILITIES.has(liveCapability.capabilityType);

    if (isAlwaysEnabled) {
      continue;
    }

    await act(
      catalogContext,
      `disable capability ${liveCapability.capabilityType}`,
      true,
      function disableCapability() {
        return catalogContext.api.disableCapability(liveCapability.id);
      },
    );
  }
}

function readLocale(localization: { readonly locale: string }): string {
  return localization.locale;
}

type PurchaseBinding = {
  purchaseId: string;
  existingLocales: Set<string>;
  alreadyPriced: boolean;
};

async function bindInAppPurchase(
  catalogContext: CatalogReconcileContext,
  appId: string,
  desiredPurchase: InAppPurchaseConfig,
  existingPurchase: InAppPurchaseResource | undefined,
): Promise<PurchaseBinding | null> {
  if (existingPurchase != null) {
    const purchaseId = existingPurchase.id;
    const localizations = await catalogContext.api.listInAppPurchaseLocalizations(purchaseId);
    const alreadyPriced = await catalogContext.api.inAppPurchaseHasPrice(purchaseId);

    return {
      purchaseId,
      existingLocales: new Set(localizations.map(readLocale)),
      alreadyPriced,
    };
  }

  const createAction = await act(
    catalogContext,
    `create in-app purchase ${desiredPurchase.productId} (${desiredPurchase.type})`,
    false,
    function createPurchase() {
      return catalogContext.api.createInAppPurchase(appId, {
        productId: desiredPurchase.productId,
        name: desiredPurchase.referenceName,
        inAppPurchaseType: desiredPurchase.type,
      });
    },
  );
  const createdId = parentIdAfterCreate(createAction);
  const isCreateMissing = createdId == null;

  if (isCreateMissing) {
    return null;
  }

  return {
    purchaseId: createdId,
    existingLocales: new Set(),
    alreadyPriced: false,
  };
}

async function reconcileInAppPurchases(
  catalogContext: CatalogReconcileContext,
  appId: string,
  desiredPurchases: readonly InAppPurchaseConfig[],
): Promise<void> {
  const hasNoPurchases = desiredPurchases.length == 0;

  if (hasNoPurchases) {
    return;
  }

  const livePurchases = await catalogContext.api.listInAppPurchases(appId);

  for (const desiredPurchase of desiredPurchases) {
    function matchesProduct(livePurchase: InAppPurchaseResource): boolean {
      return livePurchase.productId == desiredPurchase.productId;
    }

    const existingPurchase = livePurchases.find(matchesProduct);
    const purchaseBinding = await bindInAppPurchase(
      catalogContext,
      appId,
      desiredPurchase,
      existingPurchase,
    );
    const isPurchaseMissing = purchaseBinding == null;

    if (isPurchaseMissing) {
      continue;
    }

    const purchaseId = purchaseBinding.purchaseId;

    for (const localization of desiredPurchase.localizations) {
      const hasLocale = purchaseBinding.existingLocales.has(localization.locale);

      if (hasLocale) {
        continue;
      }

      await act(
        catalogContext,
        `add IAP copy ${desiredPurchase.productId} [${localization.locale}]`,
        false,
        function createLocalization() {
          return catalogContext.api.createInAppPurchaseLocalization(purchaseId, localization);
        },
      );
    }

    const priceToAssign = readUnpricedProduct(desiredPurchase.price, purchaseBinding.alreadyPriced);
    const hasPriceToAssign = priceToAssign != null;

    if (hasPriceToAssign) {
      const territory = territoryForPrice(priceToAssign);
      const customerPrice = priceToAssign.customerPrice;
      await assignInitialPrice(
        catalogContext,
        `set IAP price ${desiredPurchase.productId} = ${customerPrice} (${territory})`,
        `No ${territory} price point matches ${customerPrice} for ${desiredPurchase.productId}.`,
        function findPricePoint() {
          return catalogContext.api.findInAppPurchasePricePoint(
            purchaseId,
            territory,
            customerPrice,
          );
        },
        function writePrice(pricePointId: string) {
          return catalogContext.api.createInAppPurchasePriceSchedule(
            purchaseId,
            territory,
            pricePointId,
          );
        },
      );
    }
  }
}

type SubscriptionGroupBinding = {
  groupId: string;
  existingGroupLocales: Set<string>;
  liveSubscriptions: SubscriptionResource[];
};

async function bindSubscriptionGroup(
  catalogContext: CatalogReconcileContext,
  appId: string,
  referenceName: string,
  existingGroup: SubscriptionGroupResource | undefined,
): Promise<SubscriptionGroupBinding | null> {
  if (existingGroup != null) {
    const groupId = existingGroup.id;
    const groupLocalizations = await catalogContext.api.listSubscriptionGroupLocalizations(groupId);
    const liveSubscriptions = await catalogContext.api.listSubscriptions(groupId);

    return {
      groupId,
      existingGroupLocales: new Set(groupLocalizations.map(readLocale)),
      liveSubscriptions,
    };
  }

  const createAction = await act(
    catalogContext,
    `create subscription group "${referenceName}"`,
    false,
    function createGroup() {
      return catalogContext.api.createSubscriptionGroup(appId, referenceName);
    },
  );
  const createdId = parentIdAfterCreate(createAction);
  const isCreateMissing = createdId == null;

  if (isCreateMissing) {
    return null;
  }

  return {
    groupId: createdId,
    existingGroupLocales: new Set(),
    liveSubscriptions: [],
  };
}

async function reconcileSubscriptionGroups(
  catalogContext: CatalogReconcileContext,
  appId: string,
  desiredGroups: NonNullable<AppProducts['subscriptionGroups']>,
): Promise<void> {
  const hasNoGroups = desiredGroups.length == 0;

  if (hasNoGroups) {
    return;
  }

  const liveGroups = await catalogContext.api.listSubscriptionGroups(appId);

  for (const desiredGroup of desiredGroups) {
    function matchesGroup(liveGroup: SubscriptionGroupResource): boolean {
      return liveGroup.referenceName == desiredGroup.referenceName;
    }

    const existingGroup = liveGroups.find(matchesGroup);
    const groupBinding = await bindSubscriptionGroup(
      catalogContext,
      appId,
      desiredGroup.referenceName,
      existingGroup,
    );
    const isGroupMissing = groupBinding == null;

    if (isGroupMissing) {
      continue;
    }

    const groupId = groupBinding.groupId;

    for (const localization of desiredGroup.localizations) {
      const hasLocale = groupBinding.existingGroupLocales.has(localization.locale);

      if (hasLocale) {
        continue;
      }

      await act(
        catalogContext,
        `add group name "${desiredGroup.referenceName}" [${localization.locale}]`,
        false,
        function createGroupLocalization() {
          return catalogContext.api.createSubscriptionGroupLocalization(groupId, localization);
        },
      );
    }

    // Config order is the level ranking: first subscription is level 1, next is 2, ...
    for (const [index, subscription] of desiredGroup.subscriptions.entries()) {
      await reconcileSubscription(
        catalogContext,
        groupId,
        groupBinding.liveSubscriptions,
        subscription,
        index + 1,
      );
    }
  }
}

type SubscriptionBinding = {
  subscriptionId: string;
  existingLocales: Set<string>;
  alreadyPriced: boolean;
};

async function bindSubscription(
  catalogContext: CatalogReconcileContext,
  groupId: string,
  liveSubscriptions: SubscriptionResource[],
  desiredSubscription: SubscriptionConfig,
  groupLevel: number,
): Promise<SubscriptionBinding | null> {
  function matchesSubscription(liveSubscription: SubscriptionResource): boolean {
    return liveSubscription.productId == desiredSubscription.productId;
  }

  const existingSubscription = liveSubscriptions.find(matchesSubscription);

  if (existingSubscription != null) {
    const subscriptionId = existingSubscription.id;
    const localizations = await catalogContext.api.listSubscriptionLocalizations(subscriptionId);
    const alreadyPriced = await catalogContext.api.subscriptionHasPrice(subscriptionId);

    return {
      subscriptionId,
      existingLocales: new Set(localizations.map(readLocale)),
      alreadyPriced,
    };
  }

  const createAction = await act(
    catalogContext,
    `create subscription ${desiredSubscription.productId} (${desiredSubscription.subscriptionPeriod})`,
    false,
    function createSubscription() {
      return catalogContext.api.createSubscription(groupId, {
        productId: desiredSubscription.productId,
        name: desiredSubscription.referenceName,
        subscriptionPeriod: desiredSubscription.subscriptionPeriod,
        groupLevel,
      });
    },
  );
  const createdId = parentIdAfterCreate(createAction);
  const isCreateMissing = createdId == null;

  if (isCreateMissing) {
    return null;
  }

  return {
    subscriptionId: createdId,
    existingLocales: new Set(),
    alreadyPriced: false,
  };
}

async function reconcileSubscription(
  catalogContext: CatalogReconcileContext,
  groupId: string,
  liveSubscriptions: SubscriptionResource[],
  desiredSubscription: SubscriptionConfig,
  groupLevel: number,
): Promise<void> {
  const subscriptionBinding = await bindSubscription(
    catalogContext,
    groupId,
    liveSubscriptions,
    desiredSubscription,
    groupLevel,
  );
  const isSubscriptionMissing = subscriptionBinding == null;

  if (isSubscriptionMissing) {
    return;
  }

  const subscriptionId = subscriptionBinding.subscriptionId;

  for (const localization of desiredSubscription.localizations) {
    const hasLocale = subscriptionBinding.existingLocales.has(localization.locale);

    if (hasLocale) {
      continue;
    }

    await act(
      catalogContext,
      `add subscription copy ${desiredSubscription.productId} [${localization.locale}]`,
      false,
      function createSubscriptionLocalization() {
        return catalogContext.api.createSubscriptionLocalization(subscriptionId, localization);
      },
    );
  }

  const priceToAssign = readUnpricedProduct(
    desiredSubscription.price,
    subscriptionBinding.alreadyPriced,
  );
  const hasPriceToAssign = priceToAssign != null;

  if (hasPriceToAssign) {
    const territory = territoryForPrice(priceToAssign);
    const customerPrice = priceToAssign.customerPrice;
    await assignInitialPrice(
      catalogContext,
      `set subscription price ${desiredSubscription.productId} = ${customerPrice} (${territory})`,
      `No ${territory} price point matches ${customerPrice} for ${desiredSubscription.productId}.`,
      function findPricePoint() {
        return catalogContext.api.findSubscriptionPricePoint(
          subscriptionId,
          territory,
          customerPrice,
        );
      },
      function writePrice(pricePointId: string) {
        return catalogContext.api.createSubscriptionPrice(subscriptionId, pricePointId);
      },
    );
  }
}

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

function readPresentText(fieldText: string | undefined): string | null {
  if (fieldText == null) {
    return null;
  }

  if (fieldText == '') {
    return null;
  }

  return fieldText;
}

function assignPresentText(
  fields: Record<string, string>,
  fieldName: string,
  fieldText: string | undefined,
): void {
  const presentText = readPresentText(fieldText);
  const hasText = presentText != null;

  if (hasText == false) {
    return;
  }

  fields[fieldName] = presentText;
}

function readKeywordList(keywords: readonly string[] | undefined): string | null {
  if (keywords == null) {
    return null;
  }

  if (keywords.length == 0) {
    return null;
  }

  return keywords.join(',');
}

/** Map one locale's store config into ASC app-info vs version field sets. */
function routeListing(localeListing: AppleLocaleInfo): RoutedListing {
  const appInfo: Record<string, string> = {};
  assignPresentText(appInfo, 'name', localeListing.title);
  assignPresentText(appInfo, 'subtitle', localeListing.subtitle);
  assignPresentText(appInfo, 'privacyPolicyUrl', localeListing.privacyPolicyUrl);

  const version: Record<string, string> = {};
  assignPresentText(version, 'description', localeListing.description);

  const keywordList = readKeywordList(localeListing.keywords);
  const hasKeywords = keywordList != null;

  if (hasKeywords) {
    version['keywords'] = keywordList;
  }

  assignPresentText(version, 'whatsNew', localeListing.releaseNotes);
  assignPresentText(version, 'promotionalText', localeListing.promotionalText);
  assignPresentText(version, 'supportUrl', localeListing.supportUrl);
  assignPresentText(version, 'marketingUrl', localeListing.marketingUrl);
  return { appInfo, version };
}

function listingLimitError(fieldName: string, fieldText: string): string | null {
  const limit = LISTING_LIMITS[fieldName];

  if (limit == null) {
    return null;
  }

  const isOverLimit = fieldText.length > limit;

  if (isOverLimit == false) {
    return null;
  }

  return `${fieldName} is ${fieldText.length} chars (max ${limit})`;
}

function validateListingFields(fields: Record<string, string>): {
  valid: Record<string, string>;
  fieldErrors: string[];
} {
  const valid: Record<string, string> = {};
  const fieldErrors: string[] = [];

  for (const [fieldName, fieldText] of Object.entries(fields)) {
    const limitError = listingLimitError(fieldName, fieldText);
    const isOverLimit = limitError != null;

    if (isOverLimit) {
      fieldErrors.push(limitError);
    }

    if (isOverLimit == false) {
      valid[fieldName] = fieldText;
    }
  }

  return { valid, fieldErrors };
}

function changedListingFields(
  desiredFields: Record<string, string>,
  liveFields: Record<string, string>,
): Record<string, string> {
  const changed: Record<string, string> = {};

  for (const [fieldName, desiredText] of Object.entries(desiredFields)) {
    const isUnchanged = liveFields[fieldName] == desiredText;

    if (isUnchanged == false) {
      changed[fieldName] = desiredText;
    }
  }

  return changed;
}

function fieldPreview(fieldText: string | undefined): string {
  if (fieldText == null) {
    return '(unset)';
  }

  let previewText = fieldText;
  const isLong = fieldText.length > 24;

  if (isLong) {
    previewText = `${fieldText.slice(0, 24)}...`;
  }

  return `"${previewText}"`;
}

function describeFieldChanges(
  changed: Record<string, string>,
  liveFields: Record<string, string>,
): string {
  const descriptions: string[] = [];

  for (const key of Object.keys(changed)) {
    descriptions.push(`${key} ${fieldPreview(liveFields[key])}->${fieldPreview(changed[key])}`);
  }

  return descriptions.join(', ');
}

function listingLevelLabel(level: ListingLevel): string {
  if (level == 'appInfo') {
    return 'App Info';
  }

  return 'App Store version';
}

type ListingLevelWork = {
  level: ListingLevel;
  locale: string;
  desiredFields: Record<string, string>;
  parentId: string | null;
  liveLocalization: ListingLocalization | undefined;
  requiredKey?: string;
  createLocalization: (parentId: string, fields: Record<string, string>) => Promise<void>;
  updateLocalization: (localizationId: string, fields: Record<string, string>) => Promise<void>;
};

function readParentId(parentId: string | null): string | null {
  if (parentId == null) {
    return null;
  }

  if (parentId == '') {
    return null;
  }

  return parentId;
}

function isRequiredKeyAbsent(
  requiredKey: string | undefined,
  valid: Record<string, string>,
): boolean {
  if (requiredKey == null) {
    return false;
  }

  return Object.hasOwn(valid, requiredKey) == false;
}

async function updateLiveListing(
  catalogContext: CatalogReconcileContext,
  levelWork: ListingLevelWork,
  liveLocalization: ListingLocalization,
  valid: Record<string, string>,
): Promise<void> {
  const changed = changedListingFields(valid, liveLocalization.fields);
  const hasChanges = Object.keys(changed).length > 0;

  if (hasChanges == false) {
    return;
  }

  const localizationId = liveLocalization.id;
  const liveFields = liveLocalization.fields;
  await act(
    catalogContext,
    `update listing [${levelWork.locale}] ${listingLevelLabel(levelWork.level)}: ${describeFieldChanges(changed, liveFields)}`,
    false,
    function updateLocalization() {
      return levelWork.updateLocalization(localizationId, changed);
    },
  );
}

async function reconcileListingLevel(
  catalogContext: CatalogReconcileContext,
  levelWork: ListingLevelWork,
): Promise<void> {
  const checkedFields = validateListingFields(levelWork.desiredFields);
  const levelLabel = listingLevelLabel(levelWork.level);

  for (const fieldError of checkedFields.fieldErrors) {
    skipAction(
      catalogContext,
      `listing [${levelWork.locale}] ${levelLabel}: ${fieldError} - skipped`,
    );
  }

  const hasValidFields = Object.keys(checkedFields.valid).length > 0;

  if (hasValidFields == false) {
    return;
  }

  const parentId = readParentId(levelWork.parentId);
  const isParentMissing = parentId == null;

  if (isParentMissing) {
    skipAction(
      catalogContext,
      `listing [${levelWork.locale}] ${levelLabel}: no editable ${levelLabel} to update - prepare one in App Store Connect`,
    );
    return;
  }

  const liveLocalization = levelWork.liveLocalization;
  const hasLiveLocalization = liveLocalization != null;

  if (hasLiveLocalization) {
    await updateLiveListing(catalogContext, levelWork, liveLocalization, checkedFields.valid);
    return;
  }

  const requiredKeyIsAbsent = isRequiredKeyAbsent(levelWork.requiredKey, checkedFields.valid);

  if (requiredKeyIsAbsent) {
    skipAction(
      catalogContext,
      `listing [${levelWork.locale}] ${levelLabel}: needs ${levelWork.requiredKey} to create the locale - skipped`,
    );
    return;
  }

  const validFields = checkedFields.valid;
  await act(
    catalogContext,
    `create listing [${levelWork.locale}] ${levelLabel}: ${Object.keys(validFields).join(', ')}`,
    false,
    function createLocalization() {
      return levelWork.createLocalization(parentId, validFields);
    },
  );
}

function readLocalizationByLocale(
  localizations: readonly ListingLocalization[],
): Map<string, ListingLocalization> {
  const localizationByLocale = new Map<string, ListingLocalization>();

  for (const localization of localizations) {
    localizationByLocale.set(localization.locale, localization);
  }

  return localizationByLocale;
}

async function reconcileListing(
  catalogContext: CatalogReconcileContext,
  appId: string,
  listing: AppleStoreConfig,
): Promise<void> {
  const locales = Object.entries(listing.info);
  const hasNoLocales = locales.length == 0;

  if (hasNoLocales) {
    return;
  }

  const appInfoId = await catalogContext.api.getEditableAppInfoId(appId);
  const versionId = await catalogContext.api.getEditableVersionId(appId);
  let appInfoLocales: ListingLocalization[] = [];
  const hasAppInfo = appInfoId != null;

  if (hasAppInfo) {
    appInfoLocales = await catalogContext.api.listAppInfoLocalizations(appInfoId);
  }

  let versionLocales: ListingLocalization[] = [];
  const hasVersion = versionId != null;

  if (hasVersion) {
    versionLocales = await catalogContext.api.listVersionLocalizations(versionId);
  }

  const appInfoByLocale = readLocalizationByLocale(appInfoLocales);
  const versionByLocale = readLocalizationByLocale(versionLocales);

  for (const [locale, localeListing] of locales) {
    const routed = routeListing(localeListing);

    function createAppInfoLocalization(parentId: string, fields: Record<string, string>) {
      return catalogContext.api.createAppInfoLocalization(parentId, locale, fields);
    }

    function updateAppInfoLocalization(localizationId: string, fields: Record<string, string>) {
      return catalogContext.api.updateAppInfoLocalization(localizationId, fields);
    }

    function createVersionLocalization(parentId: string, fields: Record<string, string>) {
      return catalogContext.api.createVersionLocalization(parentId, locale, fields);
    }

    function updateVersionLocalization(localizationId: string, fields: Record<string, string>) {
      return catalogContext.api.updateVersionLocalization(localizationId, fields);
    }

    await reconcileListingLevel(catalogContext, {
      level: 'appInfo',
      locale,
      desiredFields: routed.appInfo,
      parentId: appInfoId,
      liveLocalization: appInfoByLocale.get(locale),
      requiredKey: 'name',
      createLocalization: createAppInfoLocalization,
      updateLocalization: updateAppInfoLocalization,
    });
    await reconcileListingLevel(catalogContext, {
      level: 'version',
      locale,
      desiredFields: routed.version,
      parentId: versionId,
      liveLocalization: versionByLocale.get(locale),
      createLocalization: createVersionLocalization,
      updateLocalization: updateVersionLocalization,
    });
  }
}
