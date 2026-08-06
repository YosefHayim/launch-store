import { Data, Effect } from 'effect';
import type {
  InAppPurchaseResource,
  IntroductoryOfferCreate,
  IntroductoryOfferResource,
  OfferCodeCreate,
  OfferCodeResource,
  PricePointResource,
  PromotedPurchaseCreate,
  PromotedPurchaseResource,
  PromotionalOfferCreate,
  PromotionalOfferResource,
  ResolvedOfferPrice,
  SubscriptionGroupResource,
  SubscriptionResource,
  WinBackOfferCreate,
  WinBackOfferResource,
} from '../types/appleCatalog.js';
import type { PlannedAction, ReconcileReport } from '../types/reconcile.js';
import type {
  AppProducts,
  IntroductoryOfferConfig,
  OfferCodeConfig,
  OfferPrice,
  PromotionalOfferConfig,
  SubscriptionConfig,
  WinBackOfferConfig,
} from '../types/catalog.js';
import { errorMessage } from '../services/errorMessage.js';
import { act, makeAppRecordFailure, plan, skip, type ReconcileContext } from './reconcile.js';

/**
 * The exact slice of {@link AppStoreConnectClient} the offers reconciler depends on. Declared here (not
 * the concrete client) so the diff logic is unit-testable with a hand-rolled fake, mirroring
 * {@link AscCatalogApi} in `core/store/ascSync.ts`. `AppStoreConnectClient` satisfies it structurally.
 */
export type AscOffersApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  listSubscriptionGroups(appId: string): Effect.Effect<SubscriptionGroupResource[], unknown>;
  listSubscriptions(groupId: string): Effect.Effect<SubscriptionResource[], unknown>;
  listInAppPurchases(appId: string): Effect.Effect<InAppPurchaseResource[], unknown>;
  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Effect.Effect<PricePointResource | null, unknown>;
  listSubscriptionOfferCodes(subscriptionId: string): Effect.Effect<OfferCodeResource[], unknown>;
  createSubscriptionOfferCode(input: OfferCodeCreate): Effect.Effect<OfferCodeResource, unknown>;
  listPromotionalOffers(subscriptionId: string): Effect.Effect<PromotionalOfferResource[], unknown>;
  createPromotionalOffer(
    input: PromotionalOfferCreate,
  ): Effect.Effect<PromotionalOfferResource, unknown>;
  listIntroductoryOffers(
    subscriptionId: string,
  ): Effect.Effect<IntroductoryOfferResource[], unknown>;
  createIntroductoryOffer(input: IntroductoryOfferCreate): Effect.Effect<void, unknown>;
  listWinBackOffers(subscriptionId: string): Effect.Effect<WinBackOfferResource[], unknown>;
  createWinBackOffer(input: WinBackOfferCreate): Effect.Effect<void, unknown>;
  listPromotedPurchases(appId: string): Effect.Effect<PromotedPurchaseResource[], unknown>;
  createPromotedPurchase(
    input: PromotedPurchaseCreate,
  ): Effect.Effect<PromotedPurchaseResource, unknown>;
  reorderPromotedPurchases(appId: string, orderedIds: string[]): Effect.Effect<void, unknown>;
};

/** Default territory for an {@link OfferPrice} that doesn't name one - matches the rest of the catalog. */
const DEFAULT_TERRITORY = 'USA';

/** Inputs to reconcile one app's offers. */
export type ReconcileOffersInput = {
  bundleId: string;
  products: AppProducts;
  dryRun: boolean;
};

/** Per-run context: shared reconcile bookkeeping plus the ASC offers surface. */
type OffersContext = ReconcileContext & {
  api: AscOffersApi;
};

/** Resolve declared per-territory prices to Apple price-point ids; fails on the first non-matching amount. */
export type OfferPricePointFailure = Readonly<{
  readonly _tag: 'OfferPricePointFailure';
  readonly message: string;
}>;
const makeOfferPricePointFailure = Data.tagged<OfferPricePointFailure>('OfferPricePointFailure');

const resolvePrices = (
  api: AscOffersApi,
  subscriptionId: string,
  prices: OfferPrice[],
): Effect.Effect<ResolvedOfferPrice[], OfferPricePointFailure | unknown> =>
  Effect.gen(function* () {
    const resolved: ResolvedOfferPrice[] = [];
    for (const price of prices) {
      let territory = DEFAULT_TERRITORY;
      if (price.territory !== undefined) territory = price.territory;
      const point = yield* api.findSubscriptionPricePoint(
        subscriptionId,
        territory,
        price.customerPrice,
      );
      if (point === null) {
        return yield* Effect.fail(
          makeOfferPricePointFailure({
            message: `no ${territory} price point matches ${price.customerPrice}`,
          }),
        );
      }
      resolved.push({ territory, pricePointId: point.id });
    }
    return resolved;
  });

/**
 * Validate a price-bearing offer (offer code, promotional, win-back) at the boundary: `FREE_TRIAL` must
 * carry no prices; any other mode needs at least one. Returns a human reason when invalid, else null.
 */
const priceModeError = (offerMode: string, prices: OfferPrice[] | undefined): string | null => {
  let priceCount = 0;
  if (prices !== undefined) priceCount = prices.length;
  if (offerMode === 'FREE_TRIAL') {
    if (priceCount > 0) return 'FREE_TRIAL offers take no price';
    return null;
  }
  if (priceCount === 0) return `${offerMode} offers need at least one price`;
  return null;
};

/** Plan/apply a create that resolves optional declared prices first. */
const createWithResolvedPrices = (
  offersContext: OffersContext,
  subscriptionId: string,
  description: string,
  prices: OfferPrice[] | undefined,
  write: (resolvedPrices: ResolvedOfferPrice[]) => Effect.Effect<void, unknown>,
): Effect.Effect<void> =>
  act(offersContext, description, () =>
    Effect.gen(function* () {
      let offerPrices: OfferPrice[] = [];
      if (prices !== undefined) offerPrices = prices;
      const resolvedPrices = yield* resolvePrices(offersContext.api, subscriptionId, offerPrices);
      yield* write(resolvedPrices);
    }),
  );

/** Reconcile a subscription's offer-code campaigns - create each declared `name` Apple doesn't have yet. */
const reconcileOfferCodes = (
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: OfferCodeConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const codes = yield* offersContext.api.listSubscriptionOfferCodes(subscriptionId);
    const existing = new Set(codes.map((code) => code.name));
    for (const offer of desired) {
      if (existing.has(offer.name)) continue;
      const invalid = priceModeError(offer.offerMode, offer.prices);
      if (invalid !== null) {
        skip(offersContext, `offer code "${offer.name}" on ${productId}: ${invalid} - skipped`);
        continue;
      }
      yield* createWithResolvedPrices(
        offersContext,
        subscriptionId,
        `create offer code "${offer.name}" on ${productId} (${offer.offerMode})`,
        offer.prices,
        (resolvedPrices) => {
          const create: OfferCodeCreate = {
            subscriptionId,
            name: offer.name,
            customerEligibilities: offer.customerEligibilities,
            offerEligibility: offer.offerEligibility,
            duration: offer.duration,
            offerMode: offer.offerMode,
            numberOfPeriods: offer.numberOfPeriods,
            prices: resolvedPrices,
          };
          return offersContext.api.createSubscriptionOfferCode(create).pipe(Effect.asVoid);
        },
      );
    }
  });

/** Reconcile a subscription's promotional offers - create each declared `offerCode` that's missing. */
const reconcilePromotionalOffers = (
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: PromotionalOfferConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const offers = yield* offersContext.api.listPromotionalOffers(subscriptionId);
    const existing = new Set(offers.map((offer) => offer.offerCode));
    for (const offer of desired) {
      if (existing.has(offer.offerCode)) continue;
      const invalid = priceModeError(offer.offerMode, offer.prices);
      if (invalid !== null) {
        skip(
          offersContext,
          `promotional offer "${offer.offerCode}" on ${productId}: ${invalid} - skipped`,
        );
        continue;
      }
      yield* createWithResolvedPrices(
        offersContext,
        subscriptionId,
        `create promotional offer "${offer.offerCode}" on ${productId} (${offer.offerMode})`,
        offer.prices,
        (resolvedPrices) => {
          const create: PromotionalOfferCreate = {
            subscriptionId,
            name: offer.name,
            offerCode: offer.offerCode,
            duration: offer.duration,
            offerMode: offer.offerMode,
            numberOfPeriods: offer.numberOfPeriods,
            prices: resolvedPrices,
          };
          return offersContext.api.createPromotionalOffer(create).pipe(Effect.asVoid);
        },
      );
    }
  });

/** Reconcile a subscription's introductory offers - at most one per territory (null = all territories). */
const reconcileIntroductoryOffers = (
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: IntroductoryOfferConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const introductoryOffers = yield* offersContext.api.listIntroductoryOffers(subscriptionId);
    const existing = new Set(introductoryOffers.map((offer) => offer.territory));
    for (const offer of desired) {
      let territory: string | null = null;
      if (offer.territory !== undefined) territory = offer.territory;
      if (existing.has(territory)) continue;
      const isFreeTrial = offer.offerMode === 'FREE_TRIAL';
      if (isFreeTrial && offer.price) {
        skip(
          offersContext,
          `introductory offer on ${productId}: FREE_TRIAL offers take no price - skipped`,
        );
        continue;
      }
      if (!isFreeTrial && !offer.price) {
        skip(
          offersContext,
          `introductory offer on ${productId}: ${offer.offerMode} offers need a price - skipped`,
        );
        continue;
      }
      let territoryScope = 'all territories';
      if (territory !== null) territoryScope = territory;
      yield* act(
        offersContext,
        `create introductory offer on ${productId} (${offer.offerMode}, ${territoryScope})`,
        () =>
          Effect.gen(function* () {
            let resolvedPrice: ResolvedOfferPrice | null = null;
            if (offer.price !== undefined) {
              const resolvedPrices = yield* resolvePrices(offersContext.api, subscriptionId, [
                offer.price,
              ]);
              if (resolvedPrices[0] !== undefined) resolvedPrice = resolvedPrices[0];
            }
            const introductoryOffer: IntroductoryOfferCreate = {
              subscriptionId,
              duration: offer.duration,
              offerMode: offer.offerMode,
              numberOfPeriods: offer.numberOfPeriods,
              price: resolvedPrice,
              territory,
            };
            if (offer.startDate !== undefined) introductoryOffer.startDate = offer.startDate;
            if (offer.endDate !== undefined) introductoryOffer.endDate = offer.endDate;
            yield* offersContext.api.createIntroductoryOffer(introductoryOffer);
          }),
      );
    }
  });

/** Reconcile a subscription's win-back offers - create each declared `offerId` that's missing. */
const reconcileWinBackOffers = (
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: WinBackOfferConfig[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const winBackOffers = yield* offersContext.api.listWinBackOffers(subscriptionId);
    const existing = new Set(winBackOffers.map((offer) => offer.offerId));
    for (const offer of desired) {
      if (existing.has(offer.offerId)) continue;
      const invalid = priceModeError(offer.offerMode, offer.prices);
      if (invalid !== null) {
        skip(
          offersContext,
          `win-back offer "${offer.offerId}" on ${productId}: ${invalid} - skipped`,
        );
        continue;
      }
      if (offer.monthsSinceLastSubscribed.min > offer.monthsSinceLastSubscribed.max) {
        skip(
          offersContext,
          `win-back offer "${offer.offerId}" on ${productId}: monthsSinceLastSubscribed min > max - skipped`,
        );
        continue;
      }
      yield* createWithResolvedPrices(
        offersContext,
        subscriptionId,
        `create win-back offer "${offer.offerId}" on ${productId} (${offer.offerMode})`,
        offer.prices,
        (resolvedPrices) => {
          let priority: WinBackOfferCreate['priority'] = 'NORMAL';
          if (offer.priority !== undefined) priority = offer.priority;
          const create: WinBackOfferCreate = {
            subscriptionId,
            offerId: offer.offerId,
            referenceName: offer.referenceName,
            duration: offer.duration,
            offerMode: offer.offerMode,
            numberOfPeriods: offer.numberOfPeriods,
            eligiblePaidMonths: offer.eligiblePaidMonths,
            monthsSinceLastSubscribed: offer.monthsSinceLastSubscribed,
            startDate: offer.startDate,
            priority,
            prices: resolvedPrices,
          };
          if (offer.waitBetweenOffersMonths !== undefined) {
            create.waitBetweenOffersMonths = offer.waitBetweenOffersMonths;
          }
          if (offer.endDate !== undefined) create.endDate = offer.endDate;
          if (offer.promotionIntent !== undefined) {
            create.promotionIntent = offer.promotionIntent;
          }
          return offersContext.api.createWinBackOffer(create);
        },
      );
    }
  });

/** True when a subscription declares at least one offer of any kind. */
const subscriptionDeclaresOffers = (subscription: SubscriptionConfig): boolean => {
  if (subscription.offerCodes !== undefined && subscription.offerCodes.length > 0) return true;
  if (subscription.promotionalOffers !== undefined && subscription.promotionalOffers.length > 0) {
    return true;
  }
  if (subscription.introductoryOffers !== undefined && subscription.introductoryOffers.length > 0) {
    return true;
  }
  if (subscription.winBackOffers !== undefined && subscription.winBackOffers.length > 0) {
    return true;
  }
  return false;
};

/**
 * Whether an app's declared catalog carries anything this reconciler acts on - at least one subscription
 * offer (of any kind) or a promoted-purchase ordering. Lets `launch plan`'s offers surface omit apps that
 * declare only plain products, reusing {@link subscriptionDeclaresOffers} so "what counts as an offer"
 * has one home.
 */
export const appDeclaresOffers = (products: AppProducts): boolean => {
  if (products.subscriptionGroups !== undefined) {
    for (const subscriptionGroup of products.subscriptionGroups) {
      if (subscriptionGroup.subscriptions.some(subscriptionDeclaresOffers)) return true;
    }
  }
  if (products.promotedPurchases === undefined) return false;
  return products.promotedPurchases.length > 0;
};

/**
 * Reconcile every promoted purchase declared on the app: create the ones Apple doesn't have yet, then
 * rewrite the order to put the declared products first (in declared order), preserving any undeclared
 * promotions after them. A `productId` that resolves to neither a subscription nor an IAP is recorded as
 * skipped. The reorder is a single action, fired only when the resulting order differs from the live one.
 */
const reconcilePromotedPurchases = (
  offersContext: OffersContext,
  appId: string,
  desired: NonNullable<AppProducts['promotedPurchases']>,
  subscriptionIdByProduct: Map<string, string>,
  inAppPurchaseIdByProduct: Map<string, string>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    if (desired.length === 0) return;
    const livePromotions = yield* offersContext.api.listPromotedPurchases(appId);
    const promotionIdBySubscription = new Map<string, string>();
    const promotionIdByInAppPurchase = new Map<string, string>();
    for (const livePromotion of livePromotions) {
      if (livePromotion.subscriptionId !== null) {
        promotionIdBySubscription.set(livePromotion.subscriptionId, livePromotion.id);
      }
      if (livePromotion.inAppPurchaseId !== null) {
        promotionIdByInAppPurchase.set(livePromotion.inAppPurchaseId, livePromotion.id);
      }
    }
    const declaredOrder: string[] = [];
    for (const promoted of desired) {
      const subscriptionId = subscriptionIdByProduct.get(promoted.productId);
      const inAppPurchaseId = inAppPurchaseIdByProduct.get(promoted.productId);
      if (subscriptionId === undefined && inAppPurchaseId === undefined) {
        skip(
          offersContext,
          `promoted purchase ${promoted.productId}: no matching subscription or in-app purchase - run \`launch sync\` first`,
        );
        continue;
      }
      let existingPromotionId: string | undefined;
      if (subscriptionId !== undefined) {
        existingPromotionId = promotionIdBySubscription.get(subscriptionId);
      } else if (inAppPurchaseId !== undefined) {
        existingPromotionId = promotionIdByInAppPurchase.get(inAppPurchaseId);
      }
      if (existingPromotionId !== undefined) {
        declaredOrder.push(existingPromotionId);
        continue;
      }
      const create: PromotedPurchaseCreate = {
        appId,
        visibleForAllUsers: true,
        enabled: true,
      };
      if (promoted.visibleForAllUsers !== undefined) {
        create.visibleForAllUsers = promoted.visibleForAllUsers;
      }
      if (promoted.enabled !== undefined) create.enabled = promoted.enabled;
      if (subscriptionId !== undefined) create.subscriptionId = subscriptionId;
      else if (inAppPurchaseId !== undefined) create.inAppPurchaseId = inAppPurchaseId;
      const promoteAction: PlannedAction = plan(offersContext, `promote ${promoted.productId}`);
      if (!offersContext.dryRun) {
        yield* offersContext.api.createPromotedPurchase(create).pipe(
          Effect.match({
            onFailure: (writeFailure) => {
              promoteAction.status = 'failed';
              promoteAction.error = errorMessage(writeFailure);
            },
            onSuccess: () => {
              promoteAction.status = 'applied';
            },
          }),
        );
      }
      if (promoteAction.status === 'applied') {
        declaredOrder.push(`(${promoted.productId})`);
      } else if (promoteAction.status === 'planned') {
        declaredOrder.push(`(${promoted.productId})`);
      }
    }
    const undeclaredPromotionIds = livePromotions
      .map((livePromotion) => livePromotion.id)
      .filter((promotionId) => !declaredOrder.includes(promotionId));
    const targetOrder = [...declaredOrder, ...undeclaredPromotionIds];
    const liveOrder = livePromotions.map((livePromotion) => livePromotion.id);
    const orderChanged = targetOrder.some((promotionId, index) => liveOrder[index] !== promotionId);
    if (orderChanged && !offersContext.dryRun) {
      const realIds = targetOrder.filter((promotionId) => !promotionId.startsWith('('));
      yield* act(offersContext, `reorder promoted purchases (${realIds.length})`, () =>
        offersContext.api.reorderPromotedPurchases(appId, realIds),
      );
    } else if (orderChanged) {
      skip(offersContext, `reorder promoted purchases to declared order (${desired.length})`);
    }
  });

/**
 * Reconcile one app's offers and promoted-purchase ordering end to end. Fails only for a precondition
 * the user must fix (no ASC app record); every offer write is captured per-action so a single failure
 * never aborts the run. Subscriptions are matched to Apple by `productId`, so a subscription that isn't
 * created yet is reported as skipped with a pointer to `launch sync`.
 */
export const reconcileOffers = (
  api: AscOffersApi,
  input: ReconcileOffersInput,
): Effect.Effect<ReconcileReport, unknown> =>
  Effect.gen(function* () {
    const offersContext: OffersContext = { api, actions: [], dryRun: input.dryRun };
    const appId = yield* api.getAppId(input.bundleId);
    if (appId === null) {
      return yield* Effect.fail(
        makeAppRecordFailure({
          bundleId: input.bundleId,
          message: `No App Store Connect app record for ${input.bundleId}. Create the app in App Store Connect, then re-run.`,
        }),
      );
    }
    const subscriptionIdByProduct = new Map<string, string>();
    const subscriptionGroups = yield* api.listSubscriptionGroups(appId);
    for (const subscriptionGroup of subscriptionGroups) {
      const subscriptions = yield* api.listSubscriptions(subscriptionGroup.id);
      for (const subscription of subscriptions) {
        if (subscription.productId) {
          subscriptionIdByProduct.set(subscription.productId, subscription.id);
        }
      }
    }
    let declaredSubscriptionGroups = input.products.subscriptionGroups;
    if (declaredSubscriptionGroups === undefined) declaredSubscriptionGroups = [];
    for (const subscriptionGroup of declaredSubscriptionGroups) {
      for (const subscription of subscriptionGroup.subscriptions) {
        if (!subscriptionDeclaresOffers(subscription)) continue;
        const subscriptionId = subscriptionIdByProduct.get(subscription.productId);
        if (subscriptionId === undefined) {
          skip(
            offersContext,
            `subscription ${subscription.productId}: not in App Store Connect yet - run \`launch sync\` first`,
          );
          continue;
        }
        let offerCodes: OfferCodeConfig[] = [];
        if (subscription.offerCodes !== undefined) offerCodes = subscription.offerCodes;
        let promotionalOffers: PromotionalOfferConfig[] = [];
        if (subscription.promotionalOffers !== undefined) {
          promotionalOffers = subscription.promotionalOffers;
        }
        let introductoryOffers: IntroductoryOfferConfig[] = [];
        if (subscription.introductoryOffers !== undefined) {
          introductoryOffers = subscription.introductoryOffers;
        }
        let winBackOffers: WinBackOfferConfig[] = [];
        if (subscription.winBackOffers !== undefined) {
          winBackOffers = subscription.winBackOffers;
        }
        yield* reconcileOfferCodes(
          offersContext,
          subscriptionId,
          subscription.productId,
          offerCodes,
        );
        yield* reconcilePromotionalOffers(
          offersContext,
          subscriptionId,
          subscription.productId,
          promotionalOffers,
        );
        yield* reconcileIntroductoryOffers(
          offersContext,
          subscriptionId,
          subscription.productId,
          introductoryOffers,
        );
        yield* reconcileWinBackOffers(
          offersContext,
          subscriptionId,
          subscription.productId,
          winBackOffers,
        );
      }
    }
    const inAppPurchaseIdByProduct = new Map<string, string>();
    let promotedPurchases: NonNullable<AppProducts['promotedPurchases']> = [];
    if (input.products.promotedPurchases !== undefined) {
      promotedPurchases = input.products.promotedPurchases;
      const inAppPurchases = yield* api.listInAppPurchases(appId);
      for (const inAppPurchase of inAppPurchases) {
        if (inAppPurchase.productId) {
          inAppPurchaseIdByProduct.set(inAppPurchase.productId, inAppPurchase.id);
        }
      }
    }
    yield* reconcilePromotedPurchases(
      offersContext,
      appId,
      promotedPurchases,
      subscriptionIdByProduct,
      inAppPurchaseIdByProduct,
    );
    return { bundleId: input.bundleId, actions: offersContext.actions };
  });
