/**
 * Reconcile an app's **Google Play subscriptions** (`monetization.subscriptions`) from the shared product
 * catalog in `launch.config.ts`. The Play twin of the subscription leg of `launch sync`: every
 * auto-renewable subscription declared under `products[bundleId].subscriptionGroups[].subscriptions[]`
 * that carries a {@link PlaySubscriptionOverride} under `play` is published to Play. Subscriptions without
 * that override stay Apple-only.
 *
 * Apple models each billing period as its own product, so Launch maps one config to one Play subscription
 * with a single auto-renewing **base plan** (period derived from `subscriptionPeriod`, price from the
 * override). Per declared subscription, matched by Play product id:
 * 1. **Create** the subscription + base plan when Play has none, then **activate** the base plan (Play
 *    creates base plans and offers in DRAFT — they must be activated to go live).
 * 2. On an existing subscription: patch listings if they drifted, add+activate the base plan if it's
 *    missing, activate it if it's still DRAFT, and create+activate any declared offer not present yet.
 * 3. Offers (free trials / introductory pricing) are created and activated; an existing offer is left
 *    as-is (Play locks an active offer's phases, so changes are a Console action).
 *
 * Mirrors {@link reconcileAccessibility `core/accessibility.ts`}: a read-only PLAN pass builds idempotent
 * {@link PlannedAction}s, the command prints them, then an APPLY pass performs them with each action
 * isolated so one failure never aborts the rest. **Additive** — never deletes a subscription, base plan,
 * or offer, and never alters an existing base plan's pricing (Play forbids it; you supersede instead).
 *
 * Prices arrive as micro-units (Play's in-app-product convention, {@link PlayPriceConfig}) and are
 * converted to the subscriptions API's `units`+`nanos` {@link PlayMoneyUnits} money shape here.
 */

import type {
  BasePlan,
  PlayMoneyUnits,
  SubscriptionListing,
  SubscriptionOfferPhase,
  SubscriptionOfferResource,
  SubscriptionResource,
} from '../google/playClient.js';
import type {
  PlaySubscriptionOfferConfig,
  PlayPriceConfig,
  ProductLocalization,
  SubscriptionConfig,
  SubscriptionPeriod,
} from './types.js';
import { plan, type PlannedAction, type ReconcileContext } from './asc/storeSync.js';
import { errorMessage } from './errorMessage.js';

/** Apple billing period → ISO-8601 duration, the form Play's base plans and offer phases want. */
const PERIOD_ISO: Record<SubscriptionPeriod, string> = {
  ONE_WEEK: 'P1W',
  ONE_MONTH: 'P1M',
  TWO_MONTHS: 'P2M',
  THREE_MONTHS: 'P3M',
  SIX_MONTHS: 'P6M',
  ONE_YEAR: 'P1Y',
};

/** Inverse of {@link PERIOD_ISO}, derived from it so the two never drift, for reading a captured base plan back. */
const PERIOD_FROM_ISO: Record<string, SubscriptionPeriod> = Object.fromEntries(
  Object.entries(PERIOD_ISO).map(([period, iso]) => [iso, period as SubscriptionPeriod]),
);

/** Map an ISO-8601 billing duration (e.g. `P1M`) back to a config {@link SubscriptionPeriod}, or `undefined`. */
export function periodFromIso(iso: string): SubscriptionPeriod | undefined {
  return PERIOD_FROM_ISO[iso];
}

/**
 * The slice of {@link GooglePlayClient} the subscriptions reconciler depends on. Declared here (not the
 * concrete client) so the logic is unit-testable with a hand-rolled fake; `GooglePlayClient` satisfies it
 * structurally, mirroring {@link PlayProductsApi} in `playProducts.ts`.
 */
export interface PlaySubscriptionsApi {
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
}

/** Inputs to reconcile one app's Play subscriptions. */
export interface PlaySubscriptionsReconcileInput {
  /** The app's Android application id (Play package name). */
  packageName: string;
  /** The app's declared subscriptions; only those carrying a `play` override are reconciled. */
  subscriptions: SubscriptionConfig[];
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** Convert a micro-unit price to the subscriptions API's `units`+`nanos` money shape (1,990,000 → 1.99). */
export function microsToMoney(price: PlayPriceConfig): PlayMoneyUnits {
  const micros = BigInt(price.priceMicros);
  return {
    currencyCode: price.currency,
    units: (micros / 1_000_000n).toString(),
    nanos: Number((micros % 1_000_000n) * 1_000n),
  };
}

/** Inverse of {@link microsToMoney}: a subscriptions `units`+`nanos` money back to a micro-unit string (1.99 → 1,990,000). */
export function unitsToMicros(money: PlayMoneyUnits): string {
  return (BigInt(money.units) * 1_000_000n + BigInt(money.nanos) / 1_000n).toString();
}

/** Map the shared localizations to Play subscription listings (Play requires a description; fall back to the title). */
function buildListings(localizations: ProductLocalization[]): SubscriptionListing[] {
  return localizations.map((localization) => ({
    languageCode: localization.locale,
    title: localization.name,
    description: localization.description ?? localization.name,
  }));
}

/** Whether every desired listing has a title/description-equal counterpart already live. */
function listingsInSync(existing: SubscriptionListing[], desired: SubscriptionListing[]): boolean {
  const byLanguage = new Map(existing.map((listing) => [listing.languageCode, listing]));
  return desired.every((listing) => {
    const live = byLanguage.get(listing.languageCode);
    if (!live) return false;
    return live.title === listing.title && live.description === listing.description;
  });
}

/** Merge desired listings over the live ones (by language) so a patch never drops locales Launch doesn't manage. */
function mergeListings(
  existing: SubscriptionListing[],
  desired: SubscriptionListing[],
): SubscriptionListing[] {
  const byLanguage = new Map(existing.map((listing) => [listing.languageCode, listing]));
  for (const listing of desired) {
    const live = byLanguage.get(listing.languageCode);
    byLanguage.set(listing.languageCode, live ? { ...live, ...listing } : listing);
  }
  return [...byLanguage.values()];
}

/** Build the auto-renewing base plan Launch wants: one billing period, priced per configured region. */
function buildBasePlan(
  basePlanId: string,
  period: SubscriptionPeriod,
  prices: Record<string, PlayPriceConfig>,
): BasePlan {
  return {
    basePlanId,
    autoRenewingBasePlanType: { billingPeriodDuration: PERIOD_ISO[period] },
    regionalConfigs: Object.entries(prices).map(([regionCode, price]) => ({
      regionCode,
      newSubscriberAvailability: true,
      price: microsToMoney(price),
    })),
  };
}

/** Re-encode a live base plan for a patch that only appends a new one — dropping the output-only `state`. */
function resendableBasePlan(basePlan: BasePlan): BasePlan {
  return {
    basePlanId: basePlan.basePlanId,
    ...(basePlan.autoRenewingBasePlanType
      ? { autoRenewingBasePlanType: basePlan.autoRenewingBasePlanType }
      : {}),
    ...(basePlan.regionalConfigs ? { regionalConfigs: basePlan.regionalConfigs } : {}),
    ...(basePlan.offerTags ? { offerTags: basePlan.offerTags } : {}),
  };
}

/**
 * Build a Play offer from config. Supports a free-trial phase (`freeTrialDuration`) and/or an
 * introductory-price phase (`introPrices`). Every region in the offer must appear in every phase, so the
 * offer's region set is the intersection of its phases'. Throws on a config that discounts nothing or
 * whose phases share no region — surfaced as a per-offer failure, never aborting the run.
 */
export function buildOffer(
  productId: string,
  basePlanId: string,
  basePlanRegions: string[],
  config: PlaySubscriptionOfferConfig,
): SubscriptionOfferResource {
  const phases: SubscriptionOfferPhase[] = [];
  if (config.freeTrialDuration) {
    phases.push({
      recurrenceCount: 1,
      duration: config.freeTrialDuration,
      regionalConfigs: basePlanRegions.map((regionCode) => ({ regionCode, free: {} })),
    });
  }
  if (config.introPrices) {
    phases.push({
      recurrenceCount: config.introRecurrenceCount ?? 1,
      regionalConfigs: Object.entries(config.introPrices).map(([regionCode, price]) => ({
        regionCode,
        price: microsToMoney(price),
      })),
    });
  }
  if (phases.length === 0) {
    throw new Error(`Play offer ${config.offerId} has neither a free trial nor intro prices.`);
  }

  // Every region in the offer must appear in every phase, so the offer's regions are the intersection of
  // its phases'. Each phase is then trimmed to that shared set.
  const regions = phases
    .map((phase) => phase.regionalConfigs.map((regional) => regional.regionCode))
    .reduce((shared, set) => shared.filter((region) => set.includes(region)));
  if (regions.length === 0) {
    throw new Error(
      `Play offer ${config.offerId} has no region common to its trial and intro-price phases.`,
    );
  }

  return {
    productId,
    basePlanId,
    offerId: config.offerId,
    phases: phases.map((phase) => ({
      ...phase,
      regionalConfigs: phase.regionalConfigs.filter((regional) =>
        regions.includes(regional.regionCode),
      ),
    })),
    regionalConfigs: regions.map((regionCode) => ({ regionCode, newSubscriberAvailability: true })),
  };
}

/** Build the valid offers from config, recording a failed action for any config that can't be built. */
function resolveOffers(
  ctx: ReconcileContext,
  productId: string,
  basePlanId: string,
  basePlanRegions: string[],
  configs: PlaySubscriptionOfferConfig[],
): SubscriptionOfferResource[] {
  const offers: SubscriptionOfferResource[] = [];
  for (const config of configs) {
    try {
      offers.push(buildOffer(productId, basePlanId, basePlanRegions, config));
    } catch (error) {
      const action = plan(ctx, `create offer ${config.offerId} on base plan ${basePlanId}`);
      action.status = 'failed';
      action.error = errorMessage(error);
    }
  }
  return offers;
}

/** Inputs shared by both reconcile paths, resolved once from a declared subscription. */
interface DesiredSubscription {
  productId: string;
  basePlanId: string;
  listings: SubscriptionListing[];
  basePlan: BasePlan;
  basePlanRegions: string[];
  offerConfigs: PlaySubscriptionOfferConfig[];
}

/** Create+activate a single offer, isolating each call so one failure never blocks the next offer. */
async function ensureOffer(
  ctx: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  productId: string,
  basePlanId: string,
  offer: SubscriptionOfferResource,
): Promise<void> {
  const createAction = plan(ctx, `create offer ${offer.offerId} on base plan ${basePlanId}`);
  const activateAction = plan(ctx, `activate offer ${offer.offerId}`);
  if (ctx.dryRun) return;
  try {
    await api.createSubscriptionOffer(packageName, offer);
    createAction.status = 'applied';
  } catch (error) {
    createAction.status = 'failed';
    createAction.error = errorMessage(error);
    activateAction.status = 'skipped';
    return;
  }
  try {
    await api.activateSubscriptionOffer(packageName, productId, basePlanId, offer.offerId);
    activateAction.status = 'applied';
  } catch (error) {
    activateAction.status = 'failed';
    activateAction.error = errorMessage(error);
  }
}

/** Create a subscription Play doesn't have yet (with its base plan), activate the plan, then add offers. */
async function createNewSubscription(
  ctx: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  desired: DesiredSubscription,
): Promise<void> {
  const offers = resolveOffers(
    ctx,
    desired.productId,
    desired.basePlanId,
    desired.basePlanRegions,
    desired.offerConfigs,
  );
  const createAction = plan(ctx, `create Play subscription ${desired.productId}`);
  const activateAction = plan(ctx, `activate base plan ${desired.basePlanId}`);
  if (ctx.dryRun) {
    for (const offer of offers) {
      plan(ctx, `create offer ${offer.offerId} on base plan ${desired.basePlanId}`);
      plan(ctx, `activate offer ${offer.offerId}`);
    }
    return;
  }

  try {
    await api.createSubscription(packageName, {
      productId: desired.productId,
      listings: desired.listings,
      basePlans: [desired.basePlan],
    });
    createAction.status = 'applied';
  } catch (error) {
    createAction.status = 'failed';
    createAction.error = errorMessage(error);
    activateAction.status = 'skipped';
    return;
  }
  try {
    await api.activateBasePlan(packageName, desired.productId, desired.basePlanId);
    activateAction.status = 'applied';
  } catch (error) {
    activateAction.status = 'failed';
    activateAction.error = errorMessage(error);
  }
  for (const offer of offers) {
    // biome-ignore lint/performance/noAwaitInLoops: serial Google Play writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    await ensureOffer(ctx, api, packageName, desired.productId, desired.basePlanId, offer);
  }
}

/** Reconcile an existing subscription: listings, the base plan's presence/state, then any missing offers. */
async function reconcileExistingSubscription(
  ctx: ReconcileContext,
  api: PlaySubscriptionsApi,
  packageName: string,
  existing: SubscriptionResource,
  desired: DesiredSubscription,
): Promise<void> {
  if (!listingsInSync(existing.listings ?? [], desired.listings)) {
    const merged = mergeListings(existing.listings ?? [], desired.listings);
    const action = plan(ctx, `update listings on subscription ${desired.productId}`);
    if (!ctx.dryRun) {
      try {
        await api.patchSubscription(
          packageName,
          { productId: desired.productId, listings: merged },
          'listings',
        );
        action.status = 'applied';
      } catch (error) {
        action.status = 'failed';
        action.error = errorMessage(error);
      }
    }
  }

  const liveBasePlan = (existing.basePlans ?? []).find(
    (basePlan) => basePlan.basePlanId === desired.basePlanId,
  );
  if (!liveBasePlan) {
    const merged = [...(existing.basePlans ?? []).map(resendableBasePlan), desired.basePlan];
    const addAction = plan(
      ctx,
      `add base plan ${desired.basePlanId} to subscription ${desired.productId}`,
    );
    const activateAction = plan(ctx, `activate base plan ${desired.basePlanId}`);
    if (!ctx.dryRun) {
      try {
        await api.patchSubscription(
          packageName,
          { productId: desired.productId, basePlans: merged },
          'basePlans',
        );
        addAction.status = 'applied';
      } catch (error) {
        addAction.status = 'failed';
        addAction.error = errorMessage(error);
        activateAction.status = 'skipped';
      }
      if (addAction.status === 'applied') {
        try {
          await api.activateBasePlan(packageName, desired.productId, desired.basePlanId);
          activateAction.status = 'applied';
        } catch (error) {
          activateAction.status = 'failed';
          activateAction.error = errorMessage(error);
        }
      }
    }
  } else if (liveBasePlan.state !== 'ACTIVE') {
    const action = plan(ctx, `activate base plan ${desired.basePlanId}`);
    if (!ctx.dryRun) {
      try {
        await api.activateBasePlan(packageName, desired.productId, desired.basePlanId);
        action.status = 'applied';
      } catch (error) {
        action.status = 'failed';
        action.error = errorMessage(error);
      }
    }
  }

  const offers = resolveOffers(
    ctx,
    desired.productId,
    desired.basePlanId,
    desired.basePlanRegions,
    desired.offerConfigs,
  );
  const liveOfferIds = new Set<string>();
  if (liveBasePlan) {
    try {
      const live = await api.listSubscriptionOffers(
        packageName,
        desired.productId,
        desired.basePlanId,
      );
      for (const offer of live) liveOfferIds.add(offer.offerId);
    } catch {
      // A brand-new or unreadable base plan simply has no offers yet — treat the list as empty.
    }
  }
  for (const offer of offers) {
    if (liveOfferIds.has(offer.offerId)) continue;
    // biome-ignore lint/performance/noAwaitInLoops: serial Google Play writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    await ensureOffer(ctx, api, packageName, desired.productId, desired.basePlanId, offer);
  }
}

/**
 * Reconcile one app's Play subscriptions. Throws only for a precondition the user must fix (the Play app
 * record is unreachable); everything else is captured per-action so a single failure never aborts the run.
 */
export async function reconcilePlaySubscriptions(
  api: PlaySubscriptionsApi,
  input: PlaySubscriptionsReconcileInput,
): Promise<{ packageName: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };

  await api.assertAppExists(input.packageName);
  const live = new Map(
    (await api.listSubscriptions(input.packageName)).map(
      (subscription) => [subscription.productId, subscription] as const,
    ),
  );

  for (const subscription of input.subscriptions) {
    const play = subscription.play;
    if (!play) continue;
    const productId = play.productId ?? subscription.productId;
    const basePlanId = play.basePlanId ?? PERIOD_ISO[subscription.subscriptionPeriod].toLowerCase();
    const desired: DesiredSubscription = {
      productId,
      basePlanId,
      listings: buildListings(subscription.localizations),
      basePlan: buildBasePlan(basePlanId, subscription.subscriptionPeriod, play.prices),
      basePlanRegions: Object.keys(play.prices),
      offerConfigs: play.offers ?? [],
    };

    const existing = live.get(productId);
    if (existing)
      // biome-ignore lint/performance/noAwaitInLoops: serial Google Play writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
      await reconcileExistingSubscription(ctx, api, input.packageName, existing, desired);
    else await createNewSubscription(ctx, api, input.packageName, desired);
  }
  return { packageName: input.packageName, actions: ctx.actions };
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizePlaySubscriptions(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
}
