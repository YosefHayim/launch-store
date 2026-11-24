// Reconciles subscriptions, base plans, and offers on Google Play.

import type {
  BasePlan,
  SubscriptionListing,
  SubscriptionOfferPhase,
  SubscriptionOfferResource,
  SubscriptionResource,
} from '../types/google-play.ts';
import type { PlayMoneyUnits } from '../types/play-pricing.ts';
import type {
  PlaySubscriptionOfferConfig,
  PlayPriceConfig,
  ProductLocalization,
  SubscriptionConfig,
  SubscriptionPeriod,
} from '../types/catalog.ts';
import type { MutableDeep } from '../types/mutable.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { plan, type ReconcileContext } from '../store/shared/reconcile.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { ConsoleLinks } from '../terminal/console-links.ts';

/** Apple billing period -> ISO-8601 duration, the form Play's base plans and offer phases want. */
const PERIOD_ISO: Record<SubscriptionPeriod, string> = {
  ONE_WEEK: 'P1W',
  ONE_MONTH: 'P1M',
  TWO_MONTHS: 'P2M',
  THREE_MONTHS: 'P3M',
  SIX_MONTHS: 'P6M',
  ONE_YEAR: 'P1Y',
};

/** Map an ISO-8601 billing duration (e.g. `P1M`) back to a config period, or undefined. */
export function periodFromIso(iso: string): SubscriptionPeriod | undefined {
  switch (iso) {
    case 'P1W':
      return 'ONE_WEEK';
    case 'P1M':
      return 'ONE_MONTH';
    case 'P2M':
      return 'TWO_MONTHS';
    case 'P3M':
      return 'THREE_MONTHS';
    case 'P6M':
      return 'SIX_MONTHS';
    case 'P1Y':
      return 'ONE_YEAR';
    default:
      return undefined;
  }
}

/** The slice of GooglePlayClient the subscriptions reconciler depends on. */
export type PlaySubscriptionsApi = {
  assertAppExists(packageName: string): Promise<void>;

  listSubscriptions(packageName: string): Promise<SubscriptionResource[]>;

  createSubscription(packageName: string, subscription: SubscriptionResource): Promise<void>;

  patchSubscription(
    packageName: string,
    subscription: SubscriptionResource,
    updateMask: string,
  ): Promise<void>;

  activateBasePlan(packageName: string, productId: string, basePlanId: string): Promise<void>;

  listSubscriptionOffers(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Promise<SubscriptionOfferResource[]>;

  createSubscriptionOffer(packageName: string, offer: SubscriptionOfferResource): Promise<void>;

  activateSubscriptionOffer(
    packageName: string,
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Promise<void>;
};

type PlaySubscriptionsReconcileInput = {
  packageName: string;
  serviceAccountEmail?: string;
  subscriptions: SubscriptionConfig[];
  dryRun: boolean;
};

/** Add setup instructions only to the two Play subscription failures with known operator fixes. */
export function describePlaySubscriptionWriteFailure(
  failureText: string,
  packageName: string,
  serviceAccountEmail: string | undefined,
): string {
  const isPaymentsProfileFailure = /payments? profile/i.test(failureText);

  if (isPaymentsProfileFailure) {
    return `${failureText}\nComplete Play Console Setup > Payments profile, then rerun your original \`launch-store play-subscriptions\` command: ${new ConsoleLinks().playPaymentsProfileUrl()}`;
  }

  const isSensitivePermissionFailure = /sensitive|high.?risk|permissions? declaration/i.test(
    failureText,
  );
  const isCatalogPermissionFailure =
    /caller does not have permission|permission denied|insufficient permissions?/i.test(
      failureText,
    );

  if (isCatalogPermissionFailure == false) {
    return failureText;
  }

  if (isSensitivePermissionFailure) {
    return failureText;
  }

  let serviceAccountIdentity = 'the configured service account';

  if (serviceAccountEmail != null) {
    serviceAccountIdentity = serviceAccountEmail;
  }

  return (
    `${failureText}\nFor ${packageName}, grant ${serviceAccountIdentity} app access and "Manage store presence" in Play Console Users and permissions: ${new ConsoleLinks().playUsersAndPermissionsUrl()}\n` +
    '"Admin (all permissions)" is an alternative, not a requirement. The Google Play Billing API permissions "View financial data" and "Manage orders and subscriptions" cover purchase/order management; they do not replace the catalog-write permission. Then rerun `launch-store play-subscriptions`.'
  );
}

/** Convert a micro-unit price to the subscriptions API's units+nanos money shape (1,990,000 -> 1.99). */
export function microsToMoney(price: PlayPriceConfig): PlayMoneyUnits {
  const micros = BigInt(price.priceMicros);

  return {
    currencyCode: price.currency,
    units: (micros / 1000000n).toString(),
    nanos: Number((micros % 1000000n) * 1000n),
  };
}

/** Inverse of microsToMoney: units+nanos money back to a micro-unit string (1.99 -> 1,990,000). */
export function unitsToMicros(money: PlayMoneyUnits): string {
  return (BigInt(money.units) * 1000000n + BigInt(money.nanos) / 1000n).toString();
}

function listingFromLocalization(localization: ProductLocalization): SubscriptionListing {
  let description = localization.name;

  if (localization.description != null) {
    description = localization.description;
  }

  return {
    languageCode: localization.locale,
    title: localization.name,
    description,
  };
}

function listingsFromLocalizations(
  localizations: readonly ProductLocalization[],
): SubscriptionListing[] {
  return localizations.map(listingFromLocalization);
}

function listingMatches(
  live: SubscriptionListing | undefined,
  listing: SubscriptionListing,
): boolean {
  if (live == null) {
    return false;
  }

  if (live.title != listing.title) {
    return false;
  }

  return live.description == listing.description;
}

function listingsInSync(
  existing: readonly SubscriptionListing[],
  desired: readonly SubscriptionListing[],
): boolean {
  const byLanguage = new Map(
    existing.map(function listingByLanguage(listing: SubscriptionListing) {
      return [listing.languageCode, listing] as const;
    }),
  );

  return desired.every(function desiredListingMatches(listing: SubscriptionListing) {
    return listingMatches(byLanguage.get(listing.languageCode), listing);
  });
}

function mergeListings(
  existing: readonly SubscriptionListing[],
  desired: readonly SubscriptionListing[],
): SubscriptionListing[] {
  const byLanguage = new Map(
    existing.map(function listingByLanguage(listing: SubscriptionListing) {
      return [listing.languageCode, listing] as const;
    }),
  );

  for (const listing of desired) {
    const live = byLanguage.get(listing.languageCode) ?? null;

    if (live == null) {
      byLanguage.set(listing.languageCode, listing);
      continue;
    }

    byLanguage.set(listing.languageCode, { ...live, ...listing });
  }

  return [...byLanguage.values()];
}

function regionalPrice(regionAndPrice: [string, PlayPriceConfig]) {
  const [regionCode, price] = regionAndPrice;

  return {
    regionCode,
    newSubscriberAvailability: true,
    price: microsToMoney(price),
  };
}

function basePlanFromConfig(
  basePlanId: string,
  period: SubscriptionPeriod,
  prices: Record<string, PlayPriceConfig>,
): BasePlan {
  return {
    basePlanId,
    autoRenewingBasePlanType: { billingPeriodDuration: PERIOD_ISO[period] },
    regionalConfigs: Object.entries(prices).map(regionalPrice),
  };
}

/** Re-encode a live base plan for a patch that only appends a new one. Drop output-only state. */
function resendableBasePlan(basePlan: BasePlan): BasePlan {
  const resendablePlan: MutableDeep<BasePlan> = { basePlanId: basePlan.basePlanId };

  if (basePlan.autoRenewingBasePlanType != null) {
    resendablePlan.autoRenewingBasePlanType = basePlan.autoRenewingBasePlanType;
  }

  if (basePlan.regionalConfigs != null) {
    resendablePlan.regionalConfigs = [...basePlan.regionalConfigs];
  }

  if (basePlan.offerTags != null) {
    resendablePlan.offerTags = [...basePlan.offerTags];
  }

  return resendablePlan;
}

type PlayOfferConfigFailure = Readonly<{
  readonly _tag: 'PlayOfferConfigFailure';
  readonly message: string;
}>;

function makePlayOfferConfigFailure(fields: { message: string }): PlayOfferConfigFailure {
  return { _tag: 'PlayOfferConfigFailure', ...fields };
}

function freeTrialPhase(
  basePlanRegions: readonly string[],
  duration: string,
): SubscriptionOfferPhase {
  return {
    recurrenceCount: 1,
    duration,
    regionalConfigs: basePlanRegions.map(function freeRegion(regionCode: string) {
      return { regionCode, free: {} };
    }),
  };
}

function introPhase(
  offer: PlaySubscriptionOfferConfig,
  introPrices: Record<string, PlayPriceConfig>,
): SubscriptionOfferPhase {
  let recurrenceCount = 1;

  if (offer.introRecurrenceCount != null) {
    recurrenceCount = offer.introRecurrenceCount;
  }

  return {
    recurrenceCount,
    regionalConfigs: Object.entries(introPrices).map(function pricedRegion(regionAndPrice) {
      const [regionCode, price] = regionAndPrice;

      return { regionCode, price: microsToMoney(price) };
    }),
  };
}

function phaseRegionCodes(phase: SubscriptionOfferPhase): string[] {
  return phase.regionalConfigs.map(function regionCodeOf(regional) {
    return regional.regionCode;
  });
}

function sharedRegionCodes(shared: string[], regionSet: string[]): string[] {
  return shared.filter(function regionIsShared(region: string) {
    return regionSet.includes(region);
  });
}

function offerRegions(phases: readonly SubscriptionOfferPhase[]): string[] {
  const regionSets = phases.map(phaseRegionCodes);

  return regionSets.reduce(sharedRegionCodes);
}

function phaseKeepsSharedRegions(
  phase: SubscriptionOfferPhase,
  regions: readonly string[],
): SubscriptionOfferPhase {
  return {
    ...phase,
    regionalConfigs: phase.regionalConfigs.filter(function regionIsShared(regional) {
      return regions.includes(regional.regionCode);
    }),
  };
}

/** Build a Play offer from config. */
export function offerFromConfig(
  productId: string,
  basePlanId: string,
  basePlanRegions: readonly string[],
  offer: PlaySubscriptionOfferConfig,
): SubscriptionOfferResource {
  const phases: SubscriptionOfferPhase[] = [];

  if (offer.freeTrialDuration != null) {
    phases.push(freeTrialPhase(basePlanRegions, offer.freeTrialDuration));
  }

  if (offer.introPrices != null) {
    phases.push(introPhase(offer, offer.introPrices));
  }

  const hasNoPhases = phases.length == 0;

  if (hasNoPhases) {
    throw makePlayOfferConfigFailure({
      message: `Play offer ${offer.offerId} has neither a free trial nor intro prices.`,
    });
  }

  const regions = offerRegions(phases);

  const hasNoSharedRegion = regions.length == 0;

  if (hasNoSharedRegion) {
    throw makePlayOfferConfigFailure({
      message: `Play offer ${offer.offerId} has no region common to its trial and intro-price phases.`,
    });
  }

  return {
    productId,
    basePlanId,
    offerId: offer.offerId,
    phases: phases.map(function keepSharedRegions(phase: SubscriptionOfferPhase) {
      return phaseKeepsSharedRegions(phase, regions);
    }),
    regionalConfigs: regions.map(function offerRegion(regionCode: string) {
      return { regionCode, newSubscriberAvailability: true };
    }),
  };
}

type DesiredSubscription = {
  productId: string;
  basePlanId: string;
  listings: readonly SubscriptionListing[];
  basePlan: BasePlan;
  basePlanRegions: readonly string[];
  offerConfigs: readonly PlaySubscriptionOfferConfig[];
};

function desiredSubscriptionFromConfig(
  subscription: SubscriptionConfig,
): DesiredSubscription | null {
  const playOverrides = subscription.play ?? null;

  if (playOverrides == null) {
    return null;
  }

  let productId = subscription.productId;

  if (playOverrides.productId != null) {
    productId = playOverrides.productId;
  }

  let basePlanId = PERIOD_ISO[subscription.subscriptionPeriod].toLowerCase();

  if (playOverrides.basePlanId != null) {
    basePlanId = playOverrides.basePlanId;
  }

  let offerConfigs: readonly PlaySubscriptionOfferConfig[] = [];

  if (playOverrides.offers != null) {
    offerConfigs = playOverrides.offers;
  }

  return {
    productId,
    basePlanId,
    listings: listingsFromLocalizations(subscription.localizations),
    basePlan: basePlanFromConfig(basePlanId, subscription.subscriptionPeriod, playOverrides.prices),
    basePlanRegions: Object.keys(playOverrides.prices),
    offerConfigs,
  };
}

function collectOffers(
  reconcileContext: ReconcileContext,
  productId: string,
  basePlanId: string,
  basePlanRegions: readonly string[],
  offerConfigs: readonly PlaySubscriptionOfferConfig[],
): SubscriptionOfferResource[] {
  const offers: SubscriptionOfferResource[] = [];

  for (const offerConfig of offerConfigs) {
    try {
      const builtOffer = offerFromConfig(productId, basePlanId, basePlanRegions, offerConfig);
      offers.push(builtOffer);
    } catch (configurationFailure) {
      const action = plan(
        reconcileContext,
        `create offer ${offerConfig.offerId} on base plan ${basePlanId}`,
      );

      action.status = 'failed';
      action.error = errorMessage(configurationFailure);
    }
  }

  return offers;
}

async function applyAction(write: Promise<void>, action: PlannedAction): Promise<boolean> {
  try {
    await write;
    action.status = 'applied';

    return true;
  } catch (writeFailure) {
    action.status = 'failed';
    action.error = errorMessage(writeFailure);

    return false;
  }
}

async function ensureOffer(
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  productId: string,
  basePlanId: string,
  offer: SubscriptionOfferResource,
): Promise<void> {
  const createAction = plan(
    reconcileContext,
    `create offer ${offer.offerId} on base plan ${basePlanId}`,
  );
  const activateAction = plan(reconcileContext, `activate offer ${offer.offerId}`);

  if (reconcileContext.dryRun) {
    return;
  }

  const created = await applyAction(api.createSubscriptionOffer(packageName, offer), createAction);

  if (created == false) {
    activateAction.status = 'skipped';
    return;
  }

  await applyAction(
    api.activateSubscriptionOffer(packageName, productId, basePlanId, offer.offerId),
    activateAction,
  );
}

async function createSubscriptionRecord(
  api: PlaySubscriptionsApi,
  packageName: string,
  desired: DesiredSubscription,
  createAction: PlannedAction,
  activateAction: PlannedAction,
): Promise<boolean> {
  const created = await applyAction(
    api.createSubscription(packageName, {
      productId: desired.productId,
      listings: desired.listings,
      basePlans: [desired.basePlan],
    }),
    createAction,
  );

  if (created == false) {
    activateAction.status = 'skipped';
    return false;
  }

  await applyAction(
    api.activateBasePlan(packageName, desired.productId, desired.basePlanId),
    activateAction,
  );

  return true;
}

async function createNewSubscription(
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  desired: DesiredSubscription,
): Promise<void> {
  const offers = collectOffers(
    reconcileContext,
    desired.productId,
    desired.basePlanId,
    desired.basePlanRegions,
    desired.offerConfigs,
  );
  const createAction = plan(reconcileContext, `create Play subscription ${desired.productId}`);
  const activateAction = plan(reconcileContext, `activate base plan ${desired.basePlanId}`);

  if (reconcileContext.dryRun == false) {
    const created = await createSubscriptionRecord(
      api,
      packageName,
      desired,
      createAction,
      activateAction,
    );

    if (created == false) {
      return;
    }
  }

  for (const offer of offers) {
    await ensureOffer(
      reconcileContext,
      api,
      packageName,
      desired.productId,
      desired.basePlanId,
      offer,
    );
  }
}

async function patchListings(
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  existingListings: readonly SubscriptionListing[],
  desired: DesiredSubscription,
): Promise<void> {
  const listingsMatch = listingsInSync(existingListings, desired.listings);

  if (listingsMatch) {
    return;
  }

  const mergedListings = mergeListings(existingListings, desired.listings);
  const action = plan(reconcileContext, `update listings on subscription ${desired.productId}`);

  if (reconcileContext.dryRun) {
    return;
  }

  await applyAction(
    api.patchSubscription(
      packageName,
      { productId: desired.productId, listings: mergedListings },
      'listings',
    ),
    action,
  );
}

async function addMissingBasePlan(
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  existingBasePlans: readonly BasePlan[],
  desired: DesiredSubscription,
): Promise<void> {
  const mergedBasePlans = [...existingBasePlans.map(resendableBasePlan), desired.basePlan];
  const addAction = plan(
    reconcileContext,
    `add base plan ${desired.basePlanId} to subscription ${desired.productId}`,
  );
  const activateAction = plan(reconcileContext, `activate base plan ${desired.basePlanId}`);

  if (reconcileContext.dryRun) {
    return;
  }

  const added = await applyAction(
    api.patchSubscription(
      packageName,
      { productId: desired.productId, basePlans: mergedBasePlans },
      'basePlans',
    ),
    addAction,
  );

  if (added == false) {
    activateAction.status = 'skipped';
    return;
  }

  await applyAction(
    api.activateBasePlan(packageName, desired.productId, desired.basePlanId),
    activateAction,
  );
}

async function activateDraftBasePlan(
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  desired: DesiredSubscription,
): Promise<void> {
  const action = plan(reconcileContext, `activate base plan ${desired.basePlanId}`);

  if (reconcileContext.dryRun) {
    return;
  }

  await applyAction(
    api.activateBasePlan(packageName, desired.productId, desired.basePlanId),
    action,
  );
}

function isDraftBasePlan(liveBasePlan: BasePlan | null): boolean {
  if (liveBasePlan == null) {
    return false;
  }

  return liveBasePlan.state != 'ACTIVE';
}

async function readLiveOfferIds(
  api: PlaySubscriptionsApi,
  packageName: string,
  productId: string,
  basePlanId: string,
): Promise<Set<string>> {
  const liveOfferIds = new Set<string>();
  let liveOffers: SubscriptionOfferResource[] = [];

  try {
    liveOffers = await api.listSubscriptionOffers(packageName, productId, basePlanId);
  } catch {
    liveOffers = [];
  }

  for (const offer of liveOffers) {
    liveOfferIds.add(offer.offerId);
  }

  return liveOfferIds;
}

async function reconcileExistingSubscription(
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  existing: SubscriptionResource,
  desired: DesiredSubscription,
): Promise<void> {
  let existingListings: readonly SubscriptionListing[] = [];

  if (existing.listings != null) {
    existingListings = existing.listings;
  }

  await patchListings(reconcileContext, api, packageName, existingListings, desired);

  let existingBasePlans: readonly BasePlan[] = [];

  if (existing.basePlans != null) {
    existingBasePlans = existing.basePlans;
  }

  const liveBasePlan =
    existingBasePlans.find(function basePlanMatches(basePlan: BasePlan) {
      return basePlan.basePlanId == desired.basePlanId;
    }) ?? null;

  if (liveBasePlan == null) {
    await addMissingBasePlan(reconcileContext, api, packageName, existingBasePlans, desired);
  }

  const basePlanIsDraft = isDraftBasePlan(liveBasePlan);

  if (basePlanIsDraft) {
    await activateDraftBasePlan(reconcileContext, api, packageName, desired);
  }

  const offers = collectOffers(
    reconcileContext,
    desired.productId,
    desired.basePlanId,
    desired.basePlanRegions,
    desired.offerConfigs,
  );
  let liveOfferIds = new Set<string>();

  if (liveBasePlan != null) {
    liveOfferIds = await readLiveOfferIds(api, packageName, desired.productId, desired.basePlanId);
  }

  for (const offer of offers) {
    const offerAlreadyExists = liveOfferIds.has(offer.offerId);

    if (offerAlreadyExists) {
      continue;
    }

    await ensureOffer(
      reconcileContext,
      api,
      packageName,
      desired.productId,
      desired.basePlanId,
      offer,
    );
  }
}

function annotateFailedActions(
  actions: PlannedAction[],
  packageName: string,
  serviceAccountEmail: string | undefined,
): void {
  for (const subscriptionAction of actions) {
    const isFailed = subscriptionAction.status == 'failed';

    if (isFailed == false) {
      continue;
    }

    if (subscriptionAction.error == null) {
      continue;
    }

    subscriptionAction.error = describePlaySubscriptionWriteFailure(
      subscriptionAction.error,
      packageName,
      serviceAccountEmail,
    );
  }
}

/** Reconcile one app's Play subscriptions. */
export async function reconcilePlaySubscriptions(
  api: PlaySubscriptionsApi,
  reconcileInput: PlaySubscriptionsReconcileInput,
): Promise<{ packageName: string; actions: PlannedAction[] }> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun: reconcileInput.dryRun };

  await api.assertAppExists(reconcileInput.packageName);

  const subscriptions = await api.listSubscriptions(reconcileInput.packageName);
  const liveSubscriptionsByProductId = new Map<string, SubscriptionResource>();

  for (const liveSubscription of subscriptions) {
    liveSubscriptionsByProductId.set(liveSubscription.productId, liveSubscription);
  }

  for (const subscription of reconcileInput.subscriptions) {
    const desired = desiredSubscriptionFromConfig(subscription);

    if (desired == null) {
      continue;
    }

    const existing = liveSubscriptionsByProductId.get(desired.productId) ?? null;

    if (existing != null) {
      await reconcileExistingSubscription(
        reconcileContext,
        api,
        reconcileInput.packageName,
        existing,
        desired,
      );

      continue;
    }

    await createNewSubscription(reconcileContext, api, reconcileInput.packageName, desired);
  }

  annotateFailedActions(
    reconcileContext.actions,
    reconcileInput.packageName,
    reconcileInput.serviceAccountEmail,
  );

  return { packageName: reconcileInput.packageName, actions: reconcileContext.actions };
}

/** Tally a report's action statuses for the run summary. */
export function summarizePlaySubscriptions(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of actions) {
    if (action.status == 'applied') {
      applied += 1;
      continue;
    }

    if (action.status == 'failed') {
      failed += 1;
      continue;
    }

    if (action.status == 'skipped') {
      skipped += 1;
    }
  }

  return { applied, failed, skipped };
}
