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
} from '@/types/apple-catalog.js';
import type { PlannedAction, ReconcileReport } from '@/types/reconcile.js';
import type {
  AppProducts,
  IntroductoryOfferConfig,
  OfferCodeConfig,
  OfferPrice,
  PromotionalOfferConfig,
  SubscriptionConfig,
  WinBackOfferConfig,
} from '@/types/catalog.js';
import type { MutableDeep } from '@/types/mutable.js';
import { errorMessage } from '@/services/platform/error-message.js';
import {
  act,
  makeAppRecordFailure,
  plan,
  skip,
  type ReconcileContext,
} from '../shared/reconcile.ts';

/** The exact slice of {@link AppStoreConnectClient} the offers reconciler depends on. */
export type AscOffersApi = {
  getAppId(bundleId: string): Promise<string | null>;
  listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]>;
  listSubscriptions(groupId: string): Promise<SubscriptionResource[]>;
  listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]>;
  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null>;
  listSubscriptionOfferCodes(subscriptionId: string): Promise<OfferCodeResource[]>;
  createSubscriptionOfferCode(offerCode: OfferCodeCreate): Promise<OfferCodeResource>;
  listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferResource[]>;
  createPromotionalOffer(offer: PromotionalOfferCreate): Promise<PromotionalOfferResource>;
  listIntroductoryOffers(subscriptionId: string): Promise<IntroductoryOfferResource[]>;
  createIntroductoryOffer(offer: IntroductoryOfferCreate): Promise<void>;
  listWinBackOffers(subscriptionId: string): Promise<WinBackOfferResource[]>;
  createWinBackOffer(offer: WinBackOfferCreate): Promise<void>;
  listPromotedPurchases(appId: string): Promise<PromotedPurchaseResource[]>;
  createPromotedPurchase(
    promotedPurchase: PromotedPurchaseCreate,
  ): Promise<PromotedPurchaseResource>;
  reorderPromotedPurchases(appId: string, orderedIds: string[]): Promise<void>;
};

/** Inputs to reconcile one app's offers. */
type ReconcileOffersInput = {
  bundleId: string;
  products: AppProducts;
  dryRun: boolean;
};

/** Per-run context: shared reconcile bookkeeping plus the ASC offers surface. */
type OffersContext = ReconcileContext & {
  api: AscOffersApi;
};

/** Resolve declared per-territory prices to Apple price-point ids; fails on the first non-matching amount. */
type OfferPricePointFailure = Readonly<{
  readonly _tag: 'OfferPricePointFailure';
  readonly message: string;
}>;

function makeOfferPricePointFailure(message: string): OfferPricePointFailure {
  return { _tag: 'OfferPricePointFailure', message };
}

async function resolvePrices(
  api: AscOffersApi,
  subscriptionId: string,
  prices: readonly OfferPrice[],
): Promise<ResolvedOfferPrice[]> {
  const resolved: ResolvedOfferPrice[] = [];

  for (const price of prices) {
    let territory = 'USA';
    const declaredTerritory = price.territory;

    const hasTerritory = declaredTerritory != null;

    if (hasTerritory) {
      territory = declaredTerritory;
    }

    const point = await api.findSubscriptionPricePoint(
      subscriptionId,
      territory,
      price.customerPrice,
    );

    const isPointMissing = point == null;

    if (isPointMissing) {
      throw makeOfferPricePointFailure(
        `no ${territory} price point matches ${price.customerPrice}`,
      );
    }

    resolved.push({ territory, pricePointId: point.id });
  }

  return resolved;
}

function freeTrialPriceError(priceCount: number): string | null {
  const hasPrices = priceCount > 0;

  if (hasPrices) {
    return 'FREE_TRIAL offers take no price';
  }

  return null;
}

/** Validate a price-bearing offer (offer code, promotional, win-back) at the boundary */
function priceModeError(
  offerMode: string,
  prices: readonly OfferPrice[] | undefined,
): string | null {
  let priceCount = 0;

  if (prices != null) {
    priceCount = prices.length;
  }

  const isFreeTrial = offerMode == 'FREE_TRIAL';

  if (isFreeTrial) {
    return freeTrialPriceError(priceCount);
  }

  const isMissingPrice = priceCount == 0;

  if (isMissingPrice) {
    return `${offerMode} offers need at least one price`;
  }

  return null;
}

/** Plan/apply a create that resolves optional declared prices first. */
async function createWithResolvedPrices(
  offersContext: OffersContext,
  subscriptionId: string,
  description: string,
  prices: readonly OfferPrice[] | undefined,
  write: (resolvedPrices: ResolvedOfferPrice[]) => Promise<void>,
): Promise<void> {
  async function writeResolvedPrices(): Promise<void> {
    let offerPrices: readonly OfferPrice[] = [];

    if (prices != null) {
      offerPrices = prices;
    }

    const resolvedPrices = await resolvePrices(offersContext.api, subscriptionId, offerPrices);

    await write(resolvedPrices);
  }

  await act(offersContext, description, writeResolvedPrices);
}

/** Reconcile a subscription's offer-code campaigns - create each declared `name` Apple doesn't have yet. */
async function reconcileOfferCodes(
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: readonly OfferCodeConfig[],
): Promise<void> {
  const codes = await offersContext.api.listSubscriptionOfferCodes(subscriptionId);
  const existing = new Set<string>();

  for (const code of codes) {
    existing.add(code.name);
  }

  for (const offer of desired) {
    const alreadyExists = existing.has(offer.name);

    if (alreadyExists) {
      continue;
    }

    const invalid = priceModeError(offer.offerMode, offer.prices);

    const isInvalid = invalid != null;

    if (isInvalid) {
      skip(offersContext, `offer code "${offer.name}" on ${productId}: ${invalid} - skipped`);
      continue;
    }

    async function writeOfferCode(resolvedPrices: ResolvedOfferPrice[]): Promise<void> {
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

      await offersContext.api.createSubscriptionOfferCode(create);
    }

    await createWithResolvedPrices(
      offersContext,
      subscriptionId,
      `create offer code "${offer.name}" on ${productId} (${offer.offerMode})`,
      offer.prices,
      writeOfferCode,
    );
  }
}

/** Reconcile a subscription's promotional offers - create each declared `offerCode` that's missing. */
async function reconcilePromotionalOffers(
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: readonly PromotionalOfferConfig[],
): Promise<void> {
  const offers = await offersContext.api.listPromotionalOffers(subscriptionId);
  const existing = new Set<string>();

  for (const offer of offers) {
    existing.add(offer.offerCode);
  }

  for (const offer of desired) {
    const alreadyExists = existing.has(offer.offerCode);

    if (alreadyExists) {
      continue;
    }

    const invalid = priceModeError(offer.offerMode, offer.prices);

    const isInvalid = invalid != null;

    if (isInvalid) {
      skip(
        offersContext,
        `promotional offer "${offer.offerCode}" on ${productId}: ${invalid} - skipped`,
      );

      continue;
    }

    async function writePromotionalOffer(resolvedPrices: ResolvedOfferPrice[]): Promise<void> {
      const create: PromotionalOfferCreate = {
        subscriptionId,
        name: offer.name,
        offerCode: offer.offerCode,
        duration: offer.duration,
        offerMode: offer.offerMode,
        numberOfPeriods: offer.numberOfPeriods,
        prices: resolvedPrices,
      };

      await offersContext.api.createPromotionalOffer(create);
    }

    await createWithResolvedPrices(
      offersContext,
      subscriptionId,
      `create promotional offer "${offer.offerCode}" on ${productId} (${offer.offerMode})`,
      offer.prices,
      writePromotionalOffer,
    );
  }
}

function isFreeTrialWithPrice(isFreeTrial: boolean, price: OfferPrice | undefined): boolean {
  if (isFreeTrial == false) {
    return false;
  }

  return price != null;
}

function needsPriceButMissing(isFreeTrial: boolean, price: OfferPrice | undefined): boolean {
  if (isFreeTrial) {
    return false;
  }

  return price == null;
}

/** Reconcile a subscription's introductory offers - at most one per territory (null = all territories). */
async function reconcileIntroductoryOffers(
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: readonly IntroductoryOfferConfig[],
): Promise<void> {
  const introductoryOffers = await offersContext.api.listIntroductoryOffers(subscriptionId);
  const existing = new Set<string | null>();

  for (const offer of introductoryOffers) {
    existing.add(offer.territory);
  }

  for (const offer of desired) {
    let territory: string | null = null;
    const declaredTerritory = offer.territory;

    const hasTerritory = declaredTerritory != null;

    if (hasTerritory) {
      territory = declaredTerritory;
    }

    const alreadyExists = existing.has(territory);

    if (alreadyExists) {
      continue;
    }

    const isFreeTrial = offer.offerMode == 'FREE_TRIAL';

    const freeTrialHasPrice = isFreeTrialWithPrice(isFreeTrial, offer.price);

    if (freeTrialHasPrice) {
      skip(
        offersContext,
        `introductory offer on ${productId}: FREE_TRIAL offers take no price - skipped`,
      );

      continue;
    }

    const paidOfferNeedsPrice = needsPriceButMissing(isFreeTrial, offer.price);

    if (paidOfferNeedsPrice) {
      skip(
        offersContext,
        `introductory offer on ${productId}: ${offer.offerMode} offers need a price - skipped`,
      );

      continue;
    }

    let territoryScope = 'all territories';

    if (territory != null) {
      territoryScope = territory;
    }

    async function writeIntroductoryOffer(): Promise<void> {
      let resolvedPrice: ResolvedOfferPrice | null = null;
      const declaredPrice = offer.price;

      const hasDeclaredPrice = declaredPrice != null;

      if (hasDeclaredPrice) {
        const resolvedPrices = await resolvePrices(offersContext.api, subscriptionId, [
          declaredPrice,
        ]);
        const firstPrice = resolvedPrices[0];

        const hasFirstPrice = firstPrice != null;

        if (hasFirstPrice) {
          resolvedPrice = firstPrice;
        }
      }

      const introductoryOffer: MutableDeep<IntroductoryOfferCreate> = {
        subscriptionId,
        duration: offer.duration,
        offerMode: offer.offerMode,
        numberOfPeriods: offer.numberOfPeriods,
        price: resolvedPrice,
        territory,
      };
      const startDate = offer.startDate;

      const hasStartDate = startDate != null;

      if (hasStartDate) {
        introductoryOffer.startDate = startDate;
      }

      const endDate = offer.endDate;

      const hasEndDate = endDate != null;

      if (hasEndDate) {
        introductoryOffer.endDate = endDate;
      }

      await offersContext.api.createIntroductoryOffer(introductoryOffer);
    }

    await act(
      offersContext,
      `create introductory offer on ${productId} (${offer.offerMode}, ${territoryScope})`,
      writeIntroductoryOffer,
    );
  }
}

/** Reconcile a subscription's win-back offers - create each declared `offerId` that's missing. */
async function reconcileWinBackOffers(
  offersContext: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: readonly WinBackOfferConfig[],
): Promise<void> {
  const winBackOffers = await offersContext.api.listWinBackOffers(subscriptionId);
  const existing = new Set<string>();

  for (const offer of winBackOffers) {
    existing.add(offer.offerId);
  }

  for (const offer of desired) {
    const alreadyExists = existing.has(offer.offerId);

    if (alreadyExists) {
      continue;
    }

    const invalid = priceModeError(offer.offerMode, offer.prices);

    const isInvalid = invalid != null;

    if (isInvalid) {
      skip(
        offersContext,
        `win-back offer "${offer.offerId}" on ${productId}: ${invalid} - skipped`,
      );

      continue;
    }

    const isRangeInverted =
      offer.monthsSinceLastSubscribed.min > offer.monthsSinceLastSubscribed.max;

    if (isRangeInverted) {
      skip(
        offersContext,
        `win-back offer "${offer.offerId}" on ${productId}: monthsSinceLastSubscribed min > max - skipped`,
      );

      continue;
    }

    async function writeWinBackOffer(resolvedPrices: ResolvedOfferPrice[]): Promise<void> {
      let priority: WinBackOfferCreate['priority'] = 'NORMAL';
      const declaredPriority = offer.priority;

      const hasPriority = declaredPriority != null;

      if (hasPriority) {
        priority = declaredPriority;
      }

      const create: MutableDeep<WinBackOfferCreate> = {
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
      const waitBetweenOffersMonths = offer.waitBetweenOffersMonths;

      const hasWait = waitBetweenOffersMonths != null;

      if (hasWait) {
        create.waitBetweenOffersMonths = waitBetweenOffersMonths;
      }

      const endDate = offer.endDate;

      const hasEndDate = endDate != null;

      if (hasEndDate) {
        create.endDate = endDate;
      }

      const promotionIntent = offer.promotionIntent;

      const hasPromotionIntent = promotionIntent != null;

      if (hasPromotionIntent) {
        create.promotionIntent = promotionIntent;
      }

      await offersContext.api.createWinBackOffer(create);
    }

    await createWithResolvedPrices(
      offersContext,
      subscriptionId,
      `create win-back offer "${offer.offerId}" on ${productId} (${offer.offerMode})`,
      offer.prices,
      writeWinBackOffer,
    );
  }
}

function hasConfigs<Config>(configs: readonly Config[] | undefined): boolean {
  if (configs == null) {
    return false;
  }

  return configs.length > 0;
}

/** True when a subscription declares at least one offer of any kind. */
function subscriptionDeclaresOffers(subscription: SubscriptionConfig): boolean {
  if (hasConfigs(subscription.offerCodes)) {
    return true;
  }

  if (hasConfigs(subscription.promotionalOffers)) {
    return true;
  }

  if (hasConfigs(subscription.introductoryOffers)) {
    return true;
  }

  return hasConfigs(subscription.winBackOffers);
}

/** Whether an app's declared catalog carries anything this reconciler acts on */
export function appDeclaresOffers(products: AppProducts): boolean {
  const subscriptionGroups = products.subscriptionGroups;

  if (subscriptionGroups != null) {
    for (const subscriptionGroup of subscriptionGroups) {
      const declaresOffers = subscriptionGroup.subscriptions.some(subscriptionDeclaresOffers);

      if (declaresOffers) {
        return true;
      }
    }
  }

  if (products.promotedPurchases == null) {
    return false;
  }

  return products.promotedPurchases.length > 0;
}

function readProductId(productId: string | undefined): string | null {
  if (productId == null) {
    return null;
  }

  if (productId == '') {
    return null;
  }

  return productId;
}

function isUnknownPromotedProduct(
  subscriptionId: string | undefined,
  inAppPurchaseId: string | undefined,
): boolean {
  if (subscriptionId != null) {
    return false;
  }

  return inAppPurchaseId == null;
}

function readExistingPromotionId(
  subscriptionId: string | undefined,
  inAppPurchaseId: string | undefined,
  promotionIdBySubscription: ReadonlyMap<string, string>,
  promotionIdByInAppPurchase: ReadonlyMap<string, string>,
): string | undefined {
  if (subscriptionId != null) {
    return promotionIdBySubscription.get(subscriptionId);
  }

  if (inAppPurchaseId != null) {
    return promotionIdByInAppPurchase.get(inAppPurchaseId);
  }

  return undefined;
}

function linkPromotedInAppPurchase(
  create: MutableDeep<PromotedPurchaseCreate>,
  subscriptionId: string | undefined,
  inAppPurchaseId: string | undefined,
): void {
  if (subscriptionId != null) {
    return;
  }

  if (inAppPurchaseId == null) {
    return;
  }

  create.inAppPurchaseId = inAppPurchaseId;
}

function shouldRecordPromotion(status: PlannedAction['status']): boolean {
  if (status == 'applied') {
    return true;
  }

  return status == 'planned';
}

function shouldApplyReorder(orderChanged: boolean, dryRun: boolean): boolean {
  if (orderChanged == false) {
    return false;
  }

  return dryRun == false;
}

function shouldPlanReorder(orderChanged: boolean, dryRun: boolean): boolean {
  if (orderChanged == false) {
    return false;
  }

  return dryRun == true;
}

function hasPromotionOrderChanged(
  targetOrder: readonly string[],
  liveOrder: readonly string[],
): boolean {
  for (let index = 0; index < targetOrder.length; index += 1) {
    const differs = liveOrder[index] != targetOrder[index];

    if (differs) {
      return true;
    }
  }

  return false;
}

/** Reconcile every promoted purchase declared on the app */
async function reconcilePromotedPurchases(
  offersContext: OffersContext,
  appId: string,
  desired: NonNullable<AppProducts['promotedPurchases']>,
  subscriptionIdByProduct: Map<string, string>,
  inAppPurchaseIdByProduct: Map<string, string>,
): Promise<void> {
  const hasNoPromotions = desired.length == 0;

  if (hasNoPromotions) {
    return;
  }

  const livePromotions = await offersContext.api.listPromotedPurchases(appId);
  const promotionIdBySubscription = new Map<string, string>();
  const promotionIdByInAppPurchase = new Map<string, string>();

  for (const livePromotion of livePromotions) {
    const subscriptionId = livePromotion.subscriptionId;

    const hasSubscription = subscriptionId != null;

    if (hasSubscription) {
      promotionIdBySubscription.set(subscriptionId, livePromotion.id);
    }

    const inAppPurchaseId = livePromotion.inAppPurchaseId;

    const hasInAppPurchase = inAppPurchaseId != null;

    if (hasInAppPurchase) {
      promotionIdByInAppPurchase.set(inAppPurchaseId, livePromotion.id);
    }
  }

  const declaredOrder: string[] = [];

  for (const promoted of desired) {
    const subscriptionId = subscriptionIdByProduct.get(promoted.productId);
    const inAppPurchaseId = inAppPurchaseIdByProduct.get(promoted.productId);

    const isUnknownProduct = isUnknownPromotedProduct(subscriptionId, inAppPurchaseId);

    if (isUnknownProduct) {
      skip(
        offersContext,
        `promoted purchase ${promoted.productId}: no matching subscription or in-app purchase - run \`launch-store sync\` first`,
      );

      continue;
    }

    const existingPromotionId = readExistingPromotionId(
      subscriptionId,
      inAppPurchaseId,
      promotionIdBySubscription,
      promotionIdByInAppPurchase,
    );

    const hasExistingPromotion = existingPromotionId != null;

    if (hasExistingPromotion) {
      declaredOrder.push(existingPromotionId);
      continue;
    }

    const create: MutableDeep<PromotedPurchaseCreate> = {
      appId,
      visibleForAllUsers: true,
      enabled: true,
    };
    const visibleForAllUsers = promoted.visibleForAllUsers;

    const hasVisibility = visibleForAllUsers != null;

    if (hasVisibility) {
      create.visibleForAllUsers = visibleForAllUsers;
    }

    const enabled = promoted.enabled;

    const hasEnabled = enabled != null;

    if (hasEnabled) {
      create.enabled = enabled;
    }

    if (subscriptionId != null) {
      create.subscriptionId = subscriptionId;
    }

    linkPromotedInAppPurchase(create, subscriptionId, inAppPurchaseId);

    const promoteAction = plan(offersContext, `promote ${promoted.productId}`);
    const isDryRun = offersContext.dryRun == true;

    if (isDryRun == false) {
      try {
        await offersContext.api.createPromotedPurchase(create);
        promoteAction.status = 'applied';
      } catch (writeFailure) {
        promoteAction.status = 'failed';
        promoteAction.error = errorMessage(writeFailure);
      }
    }

    const recordsPromotion = shouldRecordPromotion(promoteAction.status);

    if (recordsPromotion) {
      declaredOrder.push(`(${promoted.productId})`);
    }
  }

  const undeclaredPromotionIds: string[] = [];

  for (const livePromotion of livePromotions) {
    const isUndeclared = declaredOrder.includes(livePromotion.id) == false;

    if (isUndeclared) {
      undeclaredPromotionIds.push(livePromotion.id);
    }
  }

  const targetOrder = [...declaredOrder, ...undeclaredPromotionIds];
  const liveOrder: string[] = [];

  for (const livePromotion of livePromotions) {
    liveOrder.push(livePromotion.id);
  }

  const orderChanged = hasPromotionOrderChanged(targetOrder, liveOrder);

  const applyReorder = shouldApplyReorder(orderChanged, offersContext.dryRun);

  if (applyReorder) {
    const realIds: string[] = [];

    for (const promotionId of targetOrder) {
      const isLiveId = promotionId.startsWith('(') == false;

      if (isLiveId) {
        realIds.push(promotionId);
      }
    }

    async function reorderPromotions(): Promise<void> {
      await offersContext.api.reorderPromotedPurchases(appId, realIds);
    }

    await act(offersContext, `reorder promoted purchases (${realIds.length})`, reorderPromotions);

    return;
  }

  const planReorder = shouldPlanReorder(orderChanged, offersContext.dryRun);

  if (planReorder) {
    skip(offersContext, `reorder promoted purchases to declared order (${desired.length})`);
  }
}

/** Reconcile one app's offers and promoted-purchase ordering end to end. */
export async function reconcileOffers(
  api: AscOffersApi,
  reconcileInput: ReconcileOffersInput,
): Promise<ReconcileReport> {
  const offersContext: OffersContext = { api, actions: [], dryRun: reconcileInput.dryRun };
  const appId = await api.getAppId(reconcileInput.bundleId);

  const isAppMissing = appId == null;

  if (isAppMissing) {
    throw makeAppRecordFailure({
      bundleId: reconcileInput.bundleId,
      message: `No App Store Connect app record for ${reconcileInput.bundleId}. Create the app in App Store Connect, then re-run.`,
    });
  }

  const subscriptionIdByProduct = new Map<string, string>();
  const subscriptionGroups = await api.listSubscriptionGroups(appId);

  for (const subscriptionGroup of subscriptionGroups) {
    const subscriptions = await api.listSubscriptions(subscriptionGroup.id);

    for (const subscription of subscriptions) {
      const productId = readProductId(subscription.productId);

      const hasProductId = productId != null;

      if (hasProductId) {
        subscriptionIdByProduct.set(productId, subscription.id);
      }
    }
  }

  let declaredSubscriptionGroups = reconcileInput.products.subscriptionGroups;

  if (declaredSubscriptionGroups == null) {
    declaredSubscriptionGroups = [];
  }

  for (const subscriptionGroup of declaredSubscriptionGroups) {
    for (const subscription of subscriptionGroup.subscriptions) {
      const declaresOffers = subscriptionDeclaresOffers(subscription);

      if (declaresOffers == false) {
        continue;
      }

      const subscriptionId = subscriptionIdByProduct.get(subscription.productId);

      const isSubscriptionMissing = subscriptionId == null;

      if (isSubscriptionMissing) {
        skip(
          offersContext,
          `subscription ${subscription.productId}: not in App Store Connect yet - run \`launch-store sync\` first`,
        );

        continue;
      }

      let offerCodes: readonly OfferCodeConfig[] = [];

      if (subscription.offerCodes != null) {
        offerCodes = subscription.offerCodes;
      }

      let promotionalOffers: readonly PromotionalOfferConfig[] = [];

      if (subscription.promotionalOffers != null) {
        promotionalOffers = subscription.promotionalOffers;
      }

      let introductoryOffers: readonly IntroductoryOfferConfig[] = [];

      if (subscription.introductoryOffers != null) {
        introductoryOffers = subscription.introductoryOffers;
      }

      let winBackOffers: readonly WinBackOfferConfig[] = [];

      if (subscription.winBackOffers != null) {
        winBackOffers = subscription.winBackOffers;
      }

      await reconcileOfferCodes(offersContext, subscriptionId, subscription.productId, offerCodes);
      await reconcilePromotionalOffers(
        offersContext,
        subscriptionId,
        subscription.productId,
        promotionalOffers,
      );
      await reconcileIntroductoryOffers(
        offersContext,
        subscriptionId,
        subscription.productId,
        introductoryOffers,
      );
      await reconcileWinBackOffers(
        offersContext,
        subscriptionId,
        subscription.productId,
        winBackOffers,
      );
    }
  }

  const inAppPurchaseIdByProduct = new Map<string, string>();
  let promotedPurchases: NonNullable<AppProducts['promotedPurchases']> = [];
  const declaredPromotions = reconcileInput.products.promotedPurchases;

  const hasDeclaredPromotions = declaredPromotions != null;

  if (hasDeclaredPromotions) {
    promotedPurchases = declaredPromotions;

    const inAppPurchases = await api.listInAppPurchases(appId);

    for (const inAppPurchase of inAppPurchases) {
      const productId = readProductId(inAppPurchase.productId);

      const hasProductId = productId != null;

      if (hasProductId) {
        inAppPurchaseIdByProduct.set(productId, inAppPurchase.id);
      }
    }
  }

  await reconcilePromotedPurchases(
    offersContext,
    appId,
    promotedPurchases,
    subscriptionIdByProduct,
    inAppPurchaseIdByProduct,
  );

  return { bundleId: reconcileInput.bundleId, actions: offersContext.actions };
}
