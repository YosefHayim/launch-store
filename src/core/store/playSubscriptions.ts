import { Data, Effect } from 'effect';
import type {
  BasePlan,
  SubscriptionListing,
  SubscriptionOfferPhase,
  SubscriptionOfferResource,
  SubscriptionResource,
} from '../types/googlePlay.js';
import type { PlayMoneyUnits } from '../types/playPricing.js';
import type {
  PlaySubscriptionOfferConfig,
  PlayPriceConfig,
  ProductLocalization,
  SubscriptionConfig,
  SubscriptionPeriod,
} from '../types/catalog.js';
import type { PlannedAction } from '../types/reconcile.js';
import { plan, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';

/** Apple billing period -> ISO-8601 duration, the form Play's base plans and offer phases want. */
const PERIOD_ISO: Record<SubscriptionPeriod, string> = {
  ONE_WEEK: 'P1W',
  ONE_MONTH: 'P1M',
  TWO_MONTHS: 'P2M',
  THREE_MONTHS: 'P3M',
  SIX_MONTHS: 'P6M',
  ONE_YEAR: 'P1Y',
};

/** Map an ISO-8601 billing duration (e.g. `P1M`) back to a config {@link SubscriptionPeriod}, or `undefined`. */
export const periodFromIso = (iso: string): SubscriptionPeriod | undefined => {
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
};

/**
 * The slice of {@link GooglePlayClient} the subscriptions reconciler depends on. Declared here (not the
 * concrete client) so the logic is unit-testable with a hand-rolled fake; `GooglePlayClient` satisfies it
 * structurally, mirroring {@link PlayProductsApi} in `playProducts.ts`.
 */
export type PlaySubscriptionsApi = {
  assertAppExists(packageName: string): Effect.Effect<void, unknown>;
  listSubscriptions(packageName: string): Effect.Effect<SubscriptionResource[], unknown>;
  createSubscription(
    packageName: string,
    subscription: SubscriptionResource,
  ): Effect.Effect<void, unknown>;
  patchSubscription(
    packageName: string,
    subscription: SubscriptionResource,
    updateMask: string,
  ): Effect.Effect<void, unknown>;
  activateBasePlan(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Effect.Effect<void, unknown>;
  listSubscriptionOffers(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Effect.Effect<SubscriptionOfferResource[], unknown>;
  createSubscriptionOffer(
    packageName: string,
    offer: SubscriptionOfferResource,
  ): Effect.Effect<void, unknown>;
  activateSubscriptionOffer(
    packageName: string,
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Effect.Effect<void, unknown>;
};

/** Inputs to reconcile one app's Play subscriptions. */
export type PlaySubscriptionsReconcileInput = {
  packageName: string;
  subscriptions: SubscriptionConfig[];
  dryRun: boolean;
};

/** Convert a micro-unit price to the subscriptions API's `units`+`nanos` money shape (1,990,000 -> 1.99). */
export const microsToMoney = (price: PlayPriceConfig): PlayMoneyUnits => {
  const micros = BigInt(price.priceMicros);
  return {
    currencyCode: price.currency,
    units: (micros / 1000000n).toString(),
    nanos: Number((micros % 1000000n) * 1000n),
  };
};

/** Inverse of {@link microsToMoney}: a subscriptions `units`+`nanos` money back to a micro-unit string (1.99 -> 1,990,000). */
export const unitsToMicros = (money: PlayMoneyUnits): string => {
  return (BigInt(money.units) * 1000000n + BigInt(money.nanos) / 1000n).toString();
};

/** Map shared localizations to Play subscription listings (Play requires a description; fall back to title). */
const listingsFromLocalizations = (localizations: ProductLocalization[]): SubscriptionListing[] => {
  return localizations.map((localization) => {
    let description = localization.name;
    if (localization.description !== undefined) description = localization.description;
    return {
      languageCode: localization.locale,
      title: localization.name,
      description,
    };
  });
};

/** Whether every desired listing has a title/description-equal counterpart already live. */
const listingsInSync = (
  existing: SubscriptionListing[],
  desired: SubscriptionListing[],
): boolean => {
  const byLanguage = new Map(existing.map((listing) => [listing.languageCode, listing]));
  return desired.every((listing) => {
    const live = byLanguage.get(listing.languageCode);
    if (!live) return false;
    return live.title === listing.title && live.description === listing.description;
  });
};

/** Merge desired listings over live ones by language so a patch never drops locales Launch does not manage. */
const mergeListings = (
  existing: SubscriptionListing[],
  desired: SubscriptionListing[],
): SubscriptionListing[] => {
  const byLanguage = new Map(existing.map((listing) => [listing.languageCode, listing]));
  for (const listing of desired) {
    const live = byLanguage.get(listing.languageCode);
    if (live === undefined) byLanguage.set(listing.languageCode, listing);
    else byLanguage.set(listing.languageCode, { ...live, ...listing });
  }
  return [...byLanguage.values()];
};

/** Auto-renewing base plan: one billing period, priced per configured region. */
const basePlanFromConfig = (
  basePlanId: string,
  period: SubscriptionPeriod,
  prices: Record<string, PlayPriceConfig>,
): BasePlan => {
  return {
    basePlanId,
    autoRenewingBasePlanType: { billingPeriodDuration: PERIOD_ISO[period] },
    regionalConfigs: Object.entries(prices).map(([regionCode, price]) => ({
      regionCode,
      newSubscriberAvailability: true,
      price: microsToMoney(price),
    })),
  };
};

/** Re-encode a live base plan for a patch that only appends a new one - drop output-only `state`. */
const resendableBasePlan = (basePlan: BasePlan): BasePlan => {
  const resendablePlan: BasePlan = { basePlanId: basePlan.basePlanId };
  if (basePlan.autoRenewingBasePlanType !== undefined) {
    resendablePlan.autoRenewingBasePlanType = basePlan.autoRenewingBasePlanType;
  }
  if (basePlan.regionalConfigs !== undefined) {
    resendablePlan.regionalConfigs = basePlan.regionalConfigs;
  }
  if (basePlan.offerTags !== undefined) resendablePlan.offerTags = basePlan.offerTags;
  return resendablePlan;
};

/**
 * Build a Play offer from config. Supports a free-trial phase (`freeTrialDuration`) and/or an
 * introductory-price phase (`introPrices`). Every region in the offer must appear in every phase, so the
 * offer's region set is the intersection of its phases'. Failures are tagged configuration errors -
 * surfaced as a per-offer failure, never aborting the run.
 */
export type PlayOfferConfigFailure = Readonly<{
  readonly _tag: 'PlayOfferConfigFailure';
  readonly message: string;
}>;

const makePlayOfferConfigFailure = Data.tagged<PlayOfferConfigFailure>('PlayOfferConfigFailure');

export const offerFromConfig = (
  productId: string,
  basePlanId: string,
  basePlanRegions: string[],
  config: PlaySubscriptionOfferConfig,
): Effect.Effect<SubscriptionOfferResource, PlayOfferConfigFailure> => {
  const phases: SubscriptionOfferPhase[] = [];
  if (config.freeTrialDuration !== undefined) {
    phases.push({
      recurrenceCount: 1,
      duration: config.freeTrialDuration,
      regionalConfigs: basePlanRegions.map((regionCode) => ({ regionCode, free: {} })),
    });
  }
  if (config.introPrices !== undefined) {
    let recurrenceCount = 1;
    if (config.introRecurrenceCount !== undefined) {
      recurrenceCount = config.introRecurrenceCount;
    }
    phases.push({
      recurrenceCount,
      regionalConfigs: Object.entries(config.introPrices).map(([regionCode, price]) => ({
        regionCode,
        price: microsToMoney(price),
      })),
    });
  }
  if (phases.length === 0) {
    return Effect.fail(
      makePlayOfferConfigFailure({
        message: `Play offer ${config.offerId} has neither a free trial nor intro prices.`,
      }),
    );
  }
  // Every region in the offer must appear in every phase; the offer's regions are that intersection.
  const regions = phases
    .map((phase) => phase.regionalConfigs.map((regional) => regional.regionCode))
    .reduce((shared, set) => shared.filter((region) => set.includes(region)));
  if (regions.length === 0) {
    return Effect.fail(
      makePlayOfferConfigFailure({
        message: `Play offer ${config.offerId} has no region common to its trial and intro-price phases.`,
      }),
    );
  }
  return Effect.succeed({
    productId,
    basePlanId,
    offerId: config.offerId,
    phases: phases.map((phase) => ({
      ...phase,
      regionalConfigs: phase.regionalConfigs.filter((regional) =>
        regions.includes(regional.regionCode),
      ),
    })),
    regionalConfigs: regions.map((regionCode) => ({
      regionCode,
      newSubscriberAvailability: true,
    })),
  });
};

/** Build valid offers from config, recording a failed action for any config that cannot be built. */
const offersFromConfigs = (
  reconcileContext: ReconcileContext,
  productId: string,
  basePlanId: string,
  basePlanRegions: string[],
  configs: PlaySubscriptionOfferConfig[],
): Effect.Effect<SubscriptionOfferResource[]> =>
  Effect.gen(function* () {
    const offers: SubscriptionOfferResource[] = [];
    for (const config of configs) {
      const builtOffer = yield* offerFromConfig(
        productId,
        basePlanId,
        basePlanRegions,
        config,
      ).pipe(
        Effect.match({
          onFailure: (configurationFailure) => {
            const action = plan(
              reconcileContext,
              `create offer ${config.offerId} on base plan ${basePlanId}`,
            );
            action.status = 'failed';
            action.error = configurationFailure.message;
            return undefined;
          },
          onSuccess: (offer) => offer,
        }),
      );
      if (builtOffer === undefined) continue;
      offers.push(builtOffer);
    }
    return offers;
  });

/** Inputs shared by both reconcile paths, resolved once from a declared subscription. */
type DesiredSubscription = {
  productId: string;
  basePlanId: string;
  listings: SubscriptionListing[];
  basePlan: BasePlan;
  basePlanRegions: string[];
  offerConfigs: PlaySubscriptionOfferConfig[];
};

/** Project one catalog subscription into the Play shape Launch will create or patch. */
const desiredSubscriptionFromConfig = (
  subscription: SubscriptionConfig,
): DesiredSubscription | undefined => {
  const playOverrides = subscription.play;
  if (playOverrides === undefined) return undefined;
  let productId = subscription.productId;
  if (playOverrides.productId !== undefined) productId = playOverrides.productId;
  let basePlanId = PERIOD_ISO[subscription.subscriptionPeriod].toLowerCase();
  if (playOverrides.basePlanId !== undefined) basePlanId = playOverrides.basePlanId;
  let offerConfigs: PlaySubscriptionOfferConfig[] = [];
  if (playOverrides.offers !== undefined) offerConfigs = playOverrides.offers;
  return {
    productId,
    basePlanId,
    listings: listingsFromLocalizations(subscription.localizations),
    basePlan: basePlanFromConfig(basePlanId, subscription.subscriptionPeriod, playOverrides.prices),
    basePlanRegions: Object.keys(playOverrides.prices),
    offerConfigs,
  };
};

/** Apply one Play write and record its outcome on the planned action. */
const applyAction = (
  write: Effect.Effect<void, unknown>,
  action: PlannedAction,
): Effect.Effect<boolean> =>
  write.pipe(
    Effect.match({
      onFailure: (writeFailure) => {
        action.status = 'failed';
        action.error = errorMessage(writeFailure);
        return false;
      },
      onSuccess: () => {
        action.status = 'applied';
        return true;
      },
    }),
  );

/** Create+activate a single offer, isolating each call so one failure never blocks the next. */
const ensureOffer = (
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  productId: string,
  basePlanId: string,
  offer: SubscriptionOfferResource,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const createAction = plan(
      reconcileContext,
      `create offer ${offer.offerId} on base plan ${basePlanId}`,
    );
    const activateAction = plan(reconcileContext, `activate offer ${offer.offerId}`);
    if (reconcileContext.dryRun) return;
    const created = yield* applyAction(
      api.createSubscriptionOffer(packageName, offer),
      createAction,
    );
    if (!created) {
      activateAction.status = 'skipped';
      return;
    }
    yield* applyAction(
      api.activateSubscriptionOffer(packageName, productId, basePlanId, offer.offerId),
      activateAction,
    );
  });

/** Create a subscription Play does not have yet (with its base plan), activate the plan, then add offers. */
const createNewSubscription = (
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  desired: DesiredSubscription,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const offers = yield* offersFromConfigs(
      reconcileContext,
      desired.productId,
      desired.basePlanId,
      desired.basePlanRegions,
      desired.offerConfigs,
    );
    const createAction = plan(reconcileContext, `create Play subscription ${desired.productId}`);
    const activateAction = plan(reconcileContext, `activate base plan ${desired.basePlanId}`);
    if (!reconcileContext.dryRun) {
      const created = yield* applyAction(
        api.createSubscription(packageName, {
          productId: desired.productId,
          listings: desired.listings,
          basePlans: [desired.basePlan],
        }),
        createAction,
      );
      if (!created) {
        activateAction.status = 'skipped';
        return;
      }
      yield* applyAction(
        api.activateBasePlan(packageName, desired.productId, desired.basePlanId),
        activateAction,
      );
    }
    for (const offer of offers) {
      yield* ensureOffer(
        reconcileContext,
        api,
        packageName,
        desired.productId,
        desired.basePlanId,
        offer,
      );
    }
  });

/** Reconcile an existing subscription: listings, the base plan's presence/state, then any missing offers. */
const reconcileExistingSubscription = (
  reconcileContext: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  existing: SubscriptionResource,
  desired: DesiredSubscription,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    let existingListings: SubscriptionListing[] = [];
    if (existing.listings !== undefined) existingListings = existing.listings;
    if (!listingsInSync(existingListings, desired.listings)) {
      const mergedListings = mergeListings(existingListings, desired.listings);
      const action = plan(reconcileContext, `update listings on subscription ${desired.productId}`);
      if (!reconcileContext.dryRun) {
        yield* applyAction(
          api.patchSubscription(
            packageName,
            { productId: desired.productId, listings: mergedListings },
            'listings',
          ),
          action,
        );
      }
    }

    let existingBasePlans: BasePlan[] = [];
    if (existing.basePlans !== undefined) existingBasePlans = existing.basePlans;
    const liveBasePlan = existingBasePlans.find(
      (basePlan) => basePlan.basePlanId === desired.basePlanId,
    );
    if (liveBasePlan === undefined) {
      const mergedBasePlans = [...existingBasePlans.map(resendableBasePlan), desired.basePlan];
      const addAction = plan(
        reconcileContext,
        `add base plan ${desired.basePlanId} to subscription ${desired.productId}`,
      );
      const activateAction = plan(reconcileContext, `activate base plan ${desired.basePlanId}`);
      if (!reconcileContext.dryRun) {
        const added = yield* applyAction(
          api.patchSubscription(
            packageName,
            { productId: desired.productId, basePlans: mergedBasePlans },
            'basePlans',
          ),
          addAction,
        );
        if (!added) {
          activateAction.status = 'skipped';
        } else {
          yield* applyAction(
            api.activateBasePlan(packageName, desired.productId, desired.basePlanId),
            activateAction,
          );
        }
      }
    } else if (liveBasePlan.state !== 'ACTIVE') {
      const action = plan(reconcileContext, `activate base plan ${desired.basePlanId}`);
      if (!reconcileContext.dryRun) {
        yield* applyAction(
          api.activateBasePlan(packageName, desired.productId, desired.basePlanId),
          action,
        );
      }
    }

    const offers = yield* offersFromConfigs(
      reconcileContext,
      desired.productId,
      desired.basePlanId,
      desired.basePlanRegions,
      desired.offerConfigs,
    );
    const liveOfferIds = new Set<string>();
    if (liveBasePlan !== undefined) {
      // List failures look like "no live offers" so missing ones are still created; never abort the run.
      const emptyOffers: SubscriptionOfferResource[] = [];
      const liveOffers = yield* api
        .listSubscriptionOffers(packageName, desired.productId, desired.basePlanId)
        .pipe(Effect.catchAll(() => Effect.succeed(emptyOffers)));
      for (const offer of liveOffers) liveOfferIds.add(offer.offerId);
    }
    for (const offer of offers) {
      if (liveOfferIds.has(offer.offerId)) continue;
      yield* ensureOffer(
        reconcileContext,
        api,
        packageName,
        desired.productId,
        desired.basePlanId,
        offer,
      );
    }
  });

/**
 * Reconcile one app's Play subscriptions. Fails only for a precondition the user must fix (the Play app
 * record is unreachable); everything else is captured per-action so a single failure never aborts the run.
 */
export const reconcilePlaySubscriptions = (
  api: PlaySubscriptionsApi,
  input: PlaySubscriptionsReconcileInput,
): Effect.Effect<{ packageName: string; actions: PlannedAction[] }, unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun: input.dryRun };
    yield* api.assertAppExists(input.packageName);
    const subscriptions = yield* api.listSubscriptions(input.packageName);
    const liveSubscriptionsByProductId = new Map<string, SubscriptionResource>();
    for (const liveSubscription of subscriptions) {
      liveSubscriptionsByProductId.set(liveSubscription.productId, liveSubscription);
    }
    for (const subscription of input.subscriptions) {
      const desired = desiredSubscriptionFromConfig(subscription);
      if (desired === undefined) continue;
      const existing = liveSubscriptionsByProductId.get(desired.productId);
      if (existing !== undefined) {
        yield* reconcileExistingSubscription(
          reconcileContext,
          api,
          input.packageName,
          existing,
          desired,
        );
      } else {
        yield* createNewSubscription(reconcileContext, api, input.packageName, desired);
      }
    }
    return { packageName: input.packageName, actions: reconcileContext.actions };
  });

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export const summarizePlaySubscriptions = (
  actions: PlannedAction[],
): {
  applied: number;
  failed: number;
  skipped: number;
} => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
};
