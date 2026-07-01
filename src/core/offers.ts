/**
 * The `launch offers` reconciler: bring a subscription's offers and an app's promoted-purchase ordering
 * in line with the declared config, using the App Store Connect API key alone.
 *
 * Design — deliberately the same shape as {@link reconcileApp} in `core/ascSync.ts`:
 * - **Declarative & additive.** Offers are matched to config on Apple's natural keys (offer-code `name`,
 *   promotional `offerCode`, introductory `territory`, win-back `offerId`) and only *created* when
 *   missing. Apple makes offer terms immutable once created, so there is no "update" — changing terms
 *   means a new offer. Nothing is ever deleted here (deactivating an offer code is the separate, explicit
 *   `launch offers deactivate`), so the reconcile is safe to re-run.
 * - **Plan, then apply.** The command runs this once with `dryRun` to print the plan and once for real.
 *   Each write is isolated via {@link act}: a failure is captured on its action and the walk continues.
 *   For a billing-sensitive surface with no live API in CI, the dry-run plan is the safety net — every
 *   offer/price/reorder write is shown and confirmed before anything mutates.
 * - **Prices validated before any write.** A declared {@link OfferPrice} is resolved to an Apple
 *   subscription price point ({@link AscOffersApi.findSubscriptionPricePoint}); a non-matching amount
 *   fails that one offer's action with the reason, never sends a guessed price.
 *
 * Promoted purchases are reconciled additively too: missing ones are created, then the live order is
 * rewritten to put the declared products first (in declared order) while preserving any undeclared
 * promotions after them — so reordering never silently drops a promotion you set up elsewhere.
 */

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
} from '../apple/ascClient.js';
import type { ActionStatus, PlannedAction, ReconcileReport } from './ascSync.js';
import type {
  AppProducts,
  IntroductoryOfferConfig,
  OfferCodeConfig,
  OfferPrice,
  PromotionalOfferConfig,
  SubscriptionConfig,
  WinBackOfferConfig,
} from './types.js';

/**
 * The exact slice of {@link AppStoreConnectClient} the offers reconciler depends on. Declared here (not
 * the concrete client) so the diff logic is unit-testable with a hand-rolled fake, mirroring
 * {@link AscCatalogApi} in `core/ascSync.ts`. `AppStoreConnectClient` satisfies it structurally.
 */
export interface AscOffersApi {
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
  createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource>;
  listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferResource[]>;
  createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource>;
  listIntroductoryOffers(subscriptionId: string): Promise<IntroductoryOfferResource[]>;
  createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void>;
  listWinBackOffers(subscriptionId: string): Promise<WinBackOfferResource[]>;
  createWinBackOffer(input: WinBackOfferCreate): Promise<void>;
  listPromotedPurchases(appId: string): Promise<PromotedPurchaseResource[]>;
  createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource>;
  reorderPromotedPurchases(appId: string, orderedIds: string[]): Promise<void>;
}

/** Default territory for an {@link OfferPrice} that doesn't name one — matches the rest of the catalog. */
const DEFAULT_TERRITORY = 'USA';

/** Inputs to reconcile one app's offers. */
export interface ReconcileOffersInput {
  /** The app's iOS bundle id — resolves the ASC app record and its subscriptions. */
  bundleId: string;
  /** The declared product catalog (subscriptions carry the offers; the app carries promoted purchases). */
  products: AppProducts;
  /** Rehearse only: read state and build the plan, perform no writes. */
  dryRun: boolean;
}

/** Mutable per-run context threaded through the reconcile walk (mirrors `core/ascSync.ts`). */
interface OffersContext {
  api: AscOffersApi;
  actions: PlannedAction[];
  dryRun: boolean;
}

/**
 * Record an action and, unless this is a dry-run, perform it. A thrown error is captured on the action
 * (status `failed`) rather than propagated, so one bad offer never aborts the rest of the walk. Mirrors
 * the `act` helper in `core/ascSync.ts` (kept local — that one is private to its reconciler).
 */
async function act(
  ctx: OffersContext,
  description: string,
  run: () => Promise<void>,
): Promise<ActionStatus> {
  const action: PlannedAction = { description, destructive: false, status: 'planned' };
  ctx.actions.push(action);
  if (ctx.dryRun) return action.status;
  try {
    await run();
    action.status = 'applied';
  } catch (error) {
    action.status = 'failed';
    action.error = error instanceof Error ? error.message : String(error);
  }
  return action.status;
}

/** Record an already-decided non-write outcome (skipped, with a reason) on the plan. */
function note(ctx: OffersContext, description: string): void {
  ctx.actions.push({ description, destructive: false, status: 'skipped' });
}

/** Resolve declared per-territory prices to Apple price-point ids; throws on the first non-matching amount. */
async function resolvePrices(
  api: AscOffersApi,
  subscriptionId: string,
  prices: OfferPrice[],
): Promise<ResolvedOfferPrice[]> {
  const resolved: ResolvedOfferPrice[] = [];
  for (const price of prices) {
    const territory = price.territory ?? DEFAULT_TERRITORY;
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    const point = await api.findSubscriptionPricePoint(
      subscriptionId,
      territory,
      price.customerPrice,
    );
    if (!point) throw new Error(`no ${territory} price point matches ${price.customerPrice}`);
    resolved.push({ territory, pricePointId: point.id });
  }
  return resolved;
}

/**
 * Validate a price-bearing offer (offer code, promotional, win-back) at the boundary: `FREE_TRIAL` must
 * carry no prices; any other mode needs at least one. Returns a human reason when invalid, else null.
 */
function priceModeError(offerMode: string, prices: OfferPrice[] | undefined): string | null {
  const count = prices?.length ?? 0;
  if (offerMode === 'FREE_TRIAL') return count > 0 ? 'FREE_TRIAL offers take no price' : null;
  return count === 0 ? `${offerMode} offers need at least one price` : null;
}

/** Reconcile a subscription's offer-code campaigns — create each declared `name` Apple doesn't have yet. */
async function reconcileOfferCodes(
  ctx: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: OfferCodeConfig[],
): Promise<void> {
  const existing = new Set(
    (await ctx.api.listSubscriptionOfferCodes(subscriptionId)).map((code) => code.name),
  );
  for (const offer of desired) {
    if (existing.has(offer.name)) continue;
    const invalid = priceModeError(offer.offerMode, offer.prices);
    if (invalid) {
      note(ctx, `offer code "${offer.name}" on ${productId}: ${invalid} — skipped`);
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    await act(
      ctx,
      `create offer code "${offer.name}" on ${productId} (${offer.offerMode})`,
      async () => {
        const prices = await resolvePrices(ctx.api, subscriptionId, offer.prices ?? []);
        const create: OfferCodeCreate = {
          subscriptionId,
          name: offer.name,
          customerEligibilities: offer.customerEligibilities,
          offerEligibility: offer.offerEligibility,
          duration: offer.duration,
          offerMode: offer.offerMode,
          numberOfPeriods: offer.numberOfPeriods,
          prices,
        };
        await ctx.api.createSubscriptionOfferCode(create);
      },
    );
  }
}

/** Reconcile a subscription's promotional offers — create each declared `offerCode` that's missing. */
async function reconcilePromotionalOffers(
  ctx: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: PromotionalOfferConfig[],
): Promise<void> {
  const existing = new Set(
    (await ctx.api.listPromotionalOffers(subscriptionId)).map((offer) => offer.offerCode),
  );
  for (const offer of desired) {
    if (existing.has(offer.offerCode)) continue;
    const invalid = priceModeError(offer.offerMode, offer.prices);
    if (invalid) {
      note(ctx, `promotional offer "${offer.offerCode}" on ${productId}: ${invalid} — skipped`);
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    await act(
      ctx,
      `create promotional offer "${offer.offerCode}" on ${productId} (${offer.offerMode})`,
      async () => {
        const prices = await resolvePrices(ctx.api, subscriptionId, offer.prices ?? []);
        const create: PromotionalOfferCreate = {
          subscriptionId,
          name: offer.name,
          offerCode: offer.offerCode,
          duration: offer.duration,
          offerMode: offer.offerMode,
          numberOfPeriods: offer.numberOfPeriods,
          prices,
        };
        await ctx.api.createPromotionalOffer(create);
      },
    );
  }
}

/** Reconcile a subscription's introductory offers — at most one per territory (null = all territories). */
async function reconcileIntroductoryOffers(
  ctx: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: IntroductoryOfferConfig[],
): Promise<void> {
  const existing = new Set(
    (await ctx.api.listIntroductoryOffers(subscriptionId)).map((offer) => offer.territory),
  );
  for (const offer of desired) {
    const territory = offer.territory ?? null;
    if (existing.has(territory)) continue;
    const isFreeTrial = offer.offerMode === 'FREE_TRIAL';
    if (isFreeTrial && offer.price) {
      note(ctx, `introductory offer on ${productId}: FREE_TRIAL offers take no price — skipped`);
      continue;
    }
    if (!isFreeTrial && !offer.price) {
      note(
        ctx,
        `introductory offer on ${productId}: ${offer.offerMode} offers need a price — skipped`,
      );
      continue;
    }
    const scope = territory ?? 'all territories';
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    await act(
      ctx,
      `create introductory offer on ${productId} (${offer.offerMode}, ${scope})`,
      async () => {
        const [resolved] = offer.price
          ? await resolvePrices(ctx.api, subscriptionId, [offer.price])
          : [null];
        await ctx.api.createIntroductoryOffer({
          subscriptionId,
          duration: offer.duration,
          offerMode: offer.offerMode,
          numberOfPeriods: offer.numberOfPeriods,
          price: resolved ?? null,
          territory,
          ...(offer.startDate ? { startDate: offer.startDate } : {}),
          ...(offer.endDate ? { endDate: offer.endDate } : {}),
        });
      },
    );
  }
}

/** Reconcile a subscription's win-back offers — create each declared `offerId` that's missing. */
async function reconcileWinBackOffers(
  ctx: OffersContext,
  subscriptionId: string,
  productId: string,
  desired: WinBackOfferConfig[],
): Promise<void> {
  const existing = new Set(
    (await ctx.api.listWinBackOffers(subscriptionId)).map((offer) => offer.offerId),
  );
  for (const offer of desired) {
    if (existing.has(offer.offerId)) continue;
    const invalid = priceModeError(offer.offerMode, offer.prices);
    if (invalid) {
      note(ctx, `win-back offer "${offer.offerId}" on ${productId}: ${invalid} — skipped`);
      continue;
    }
    if (offer.monthsSinceLastSubscribed.min > offer.monthsSinceLastSubscribed.max) {
      note(
        ctx,
        `win-back offer "${offer.offerId}" on ${productId}: monthsSinceLastSubscribed min > max — skipped`,
      );
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    await act(
      ctx,
      `create win-back offer "${offer.offerId}" on ${productId} (${offer.offerMode})`,
      async () => {
        const prices = await resolvePrices(ctx.api, subscriptionId, offer.prices ?? []);
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
          priority: offer.priority ?? 'NORMAL',
          prices,
          ...(offer.waitBetweenOffersMonths !== undefined
            ? { waitBetweenOffersMonths: offer.waitBetweenOffersMonths }
            : {}),
          ...(offer.endDate ? { endDate: offer.endDate } : {}),
          ...(offer.promotionIntent ? { promotionIntent: offer.promotionIntent } : {}),
        };
        await ctx.api.createWinBackOffer(create);
      },
    );
  }
}

/** True when a subscription declares no offers at all (so the reconciler skips its network reads). */
function hasNoOffers(sub: SubscriptionConfig): boolean {
  return (
    (sub.offerCodes?.length ?? 0) === 0 &&
    (sub.promotionalOffers?.length ?? 0) === 0 &&
    (sub.introductoryOffers?.length ?? 0) === 0 &&
    (sub.winBackOffers?.length ?? 0) === 0
  );
}

/**
 * Whether an app's declared catalog carries anything this reconciler acts on — at least one subscription
 * offer (of any kind) or a promoted-purchase ordering. Lets `launch plan`'s offers surface omit apps that
 * declare only plain products, reusing {@link hasNoOffers} so "what counts as an offer" has one home.
 */
export function appDeclaresOffers(products: AppProducts): boolean {
  const anySubscriptionOffer = (products.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .some((sub) => !hasNoOffers(sub));
  return anySubscriptionOffer || (products.promotedPurchases?.length ?? 0) > 0;
}

/**
 * Reconcile every promoted purchase declared on the app: create the ones Apple doesn't have yet, then
 * rewrite the order to put the declared products first (in declared order), preserving any undeclared
 * promotions after them. A `productId` that resolves to neither a subscription nor an IAP is recorded as
 * skipped. The reorder is a single action, fired only when the resulting order differs from the live one.
 */
async function reconcilePromotedPurchases(
  ctx: OffersContext,
  appId: string,
  desired: AppProducts['promotedPurchases'] = [],
  subscriptionIdByProduct: Map<string, string>,
  iapIdByProduct: Map<string, string>,
): Promise<void> {
  if (desired.length === 0) return;
  const live = await ctx.api.listPromotedPurchases(appId);
  const promotionIdBySubscription = new Map(
    live.flatMap((p) => (p.subscriptionId ? [[p.subscriptionId, p.id]] : [])),
  );
  const promotionIdByIap = new Map(
    live.flatMap((p) => (p.inAppPurchaseId ? [[p.inAppPurchaseId, p.id]] : [])),
  );

  const declaredOrder: string[] = [];
  for (const promoted of desired) {
    const subscriptionId = subscriptionIdByProduct.get(promoted.productId);
    const iapId = iapIdByProduct.get(promoted.productId);
    if (!subscriptionId && !iapId) {
      note(
        ctx,
        `promoted purchase ${promoted.productId}: no matching subscription or in-app purchase — run \`launch sync\` first`,
      );
      continue;
    }
    const existingId = subscriptionId
      ? promotionIdBySubscription.get(subscriptionId)
      : promotionIdByIap.get(iapId ?? '');
    if (existingId) {
      declaredOrder.push(existingId);
      continue;
    }
    const create: PromotedPurchaseCreate = {
      appId,
      visibleForAllUsers: promoted.visibleForAllUsers ?? true,
      enabled: promoted.enabled ?? true,
      ...(subscriptionId ? { subscriptionId } : { inAppPurchaseId: iapId ?? '' }),
    };
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    const status = await act(ctx, `promote ${promoted.productId}`, async () => {
      await ctx.api.createPromotedPurchase(create);
    });
    // On a dry-run the id doesn't exist yet; the reorder plan below is best-effort and re-runs next pass.
    if (status === 'applied' || status === 'planned') declaredOrder.push(`(${promoted.productId})`);
  }

  const undeclared = live.map((p) => p.id).filter((id) => !declaredOrder.includes(id));
  const targetOrder = [...declaredOrder, ...undeclared];
  const liveOrder = live.map((p) => p.id);
  const orderChanged = targetOrder.some((id, index) => liveOrder[index] !== id);
  if (orderChanged && !ctx.dryRun) {
    // Only reorder with real ids — a plan pass (or one with newly-created placeholders) defers to next run.
    const realIds = targetOrder.filter((id) => !id.startsWith('('));
    await act(ctx, `reorder promoted purchases (${realIds.length})`, () =>
      ctx.api.reorderPromotedPurchases(appId, realIds),
    );
  } else if (orderChanged) {
    note(ctx, `reorder promoted purchases to declared order (${desired.length})`);
  }
}

/**
 * Reconcile one app's offers and promoted-purchase ordering end to end. Throws only for a precondition
 * the user must fix (no ASC app record); every offer write is captured per-action so a single failure
 * never aborts the run. Subscriptions are matched to Apple by `productId`, so a subscription that isn't
 * created yet is reported as skipped with a pointer to `launch sync`.
 */
export async function reconcileOffers(
  api: AscOffersApi,
  input: ReconcileOffersInput,
): Promise<ReconcileReport> {
  const ctx: OffersContext = { api, actions: [], dryRun: input.dryRun };

  const appId = await api.getAppId(input.bundleId);
  if (!appId) {
    throw new Error(
      `No App Store Connect app record for ${input.bundleId}. Create the app in App Store Connect, then re-run.`,
    );
  }

  const subscriptionIdByProduct = new Map<string, string>();
  for (const group of await api.listSubscriptionGroups(appId)) {
    for (const sub of await api.listSubscriptions(group.id)) {
      if (sub.productId) subscriptionIdByProduct.set(sub.productId, sub.id);
    }
  }

  for (const group of input.products.subscriptionGroups ?? []) {
    for (const sub of group.subscriptions) {
      if (hasNoOffers(sub)) continue;
      const subscriptionId = subscriptionIdByProduct.get(sub.productId);
      if (!subscriptionId) {
        note(
          ctx,
          `subscription ${sub.productId}: not in App Store Connect yet — run \`launch sync\` first`,
        );
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
      await reconcileOfferCodes(ctx, subscriptionId, sub.productId, sub.offerCodes ?? []);
      await reconcilePromotionalOffers(
        ctx,
        subscriptionId,
        sub.productId,
        sub.promotionalOffers ?? [],
      );
      await reconcileIntroductoryOffers(
        ctx,
        subscriptionId,
        sub.productId,
        sub.introductoryOffers ?? [],
      );
      await reconcileWinBackOffers(ctx, subscriptionId, sub.productId, sub.winBackOffers ?? []);
    }
  }

  const iapIdByProduct = new Map<string, string>();
  if ((input.products.promotedPurchases?.length ?? 0) > 0) {
    for (const iap of await api.listInAppPurchases(appId)) {
      if (iap.productId) iapIdByProduct.set(iap.productId, iap.id);
    }
  }
  await reconcilePromotedPurchases(
    ctx,
    appId,
    input.products.promotedPurchases,
    subscriptionIdByProduct,
    iapIdByProduct,
  );

  return { bundleId: input.bundleId, actions: ctx.actions };
}
