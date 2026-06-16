/**
 * Source: capture each Android app's auto-renewable subscriptions from Google Play. Read-only, via the same
 * `listSubscriptions` reader `launch sync` uses. Records the product id, its base plans (id, state, billing
 * period), and listing titles — but not per-region offer configs, keeping the snapshot lean for the same
 * reason {@link import("./playProducts.js").playProductsSource} drops the fanned-out price map.
 */

import type {
  AppEntities,
  JsonValue,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from "../types.js";
import type { BasePlan, SubscriptionListing, SubscriptionResource } from "../../../google/playClient.js";
import { androidApps } from "../../readiness/appScopes.js";

/** A subscription's base plans, normalized to serializable records (id, state, and billing period only). */
function basePlans(plans: BasePlan[]): JsonValue {
  return plans.map(
    (plan): JsonValue => ({
      basePlanId: plan.basePlanId,
      ...(plan.state ? { state: plan.state } : {}),
      ...(plan.autoRenewingBasePlanType ? { period: plan.autoRenewingBasePlanType.billingPeriodDuration } : {}),
    }),
  );
}

/** A subscription's listings, normalized to language + title pairs. */
function listings(items: SubscriptionListing[]): JsonValue {
  return items.map((listing): JsonValue => ({ languageCode: listing.languageCode, title: listing.title }));
}

/** One captured subscription → a snapshot entity keyed by its product id. */
function toEntity(subscription: SubscriptionResource): SnapshotEntity {
  const data: JsonValue = {
    productId: subscription.productId,
    ...(subscription.basePlans ? { basePlans: basePlans(subscription.basePlans) } : {}),
    ...(subscription.listings ? { listings: listings(subscription.listings) } : {}),
  };
  const planCount = subscription.basePlans?.length ?? 0;
  return { key: subscription.productId, summary: `Play subscription (${planCount} base plan(s))`, data };
}

/** The Google Play subscription snapshot source. */
export const playSubscriptionsSource: SnapshotSource = {
  id: "play-subscriptions",
  title: "Google Play subscriptions",
  store: "play",
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = androidApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return { state: "skipped", reason: "no Play service account", hint: "configure Play credentials" };
    }

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities> => {
        const entities = (await api.listSubscriptions(identifier)).map(toEntity);
        return { app: name, identifier, entities };
      }),
    );
    return { state: "captured", apps: captured };
  },
};
