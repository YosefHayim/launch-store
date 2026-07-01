/**
 * Source: capture each Android app's auto-renewable subscriptions from Google Play. Read-only, via the same
 * `listSubscriptions` reader `launch sync` uses. Records the product id, its base plans (id, state, billing
 * period, and per-region prices), and listing titles. The base-plan prices make the capture config-complete
 * so a restore can faithfully rebuild the subscription — unlike a product's auto-fanned price map (which
 * {@link import("./playProducts.js").playProductsSource} drops), a base plan's regional prices are the real
 * declared pricing and have no single default to fan out from. Offers are still dropped: restore is
 * additive and leaves any live offers untouched.
 */

import type {
  AppEntities,
  JsonValue,
  PlayPriceConfig,
  PlaySubscriptionOverride,
  ProductLocalization,
  RestoreInput,
  RestoreReport,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
  SubscriptionConfig,
} from '../../types.js';
import type {
  BasePlan,
  RegionalBasePlanConfig,
  SubscriptionListing,
  SubscriptionResource,
} from '../../../google/playClient.js';
import type { PlannedAction } from '../../ascSync.js';
import {
  periodFromIso,
  reconcilePlaySubscriptions,
  unitsToMicros,
} from '../../playSubscriptions.js';
import { androidApps } from '../../readiness/appScopes.js';
import {
  jsonRecord,
  restoreErrorMessage,
  skippedAction,
  stringField,
  toPriceConfig,
} from './playRestore.js';

/**
 * A base plan's per-region prices → the snapshot's `{ priceMicros, currency }` money shape (the same form
 * the products source records), sorted by region for a deterministic capture. Play expresses subscription
 * money as `units`+`nanos`, converted to micro-units here so a restore reads it straight back as a
 * {@link PlayPriceConfig}. Regions Play left price-less are dropped.
 */
function regionalPrices(configs: RegionalBasePlanConfig[]): Record<string, JsonValue> {
  const prices: Record<string, JsonValue> = {};
  for (const config of [...configs].sort((a, b) => a.regionCode.localeCompare(b.regionCode))) {
    if (config.price) {
      prices[config.regionCode] = {
        priceMicros: unitsToMicros(config.price),
        currency: config.price.currencyCode,
      };
    }
  }
  return prices;
}

/** A subscription's base plans, normalized to serializable records (id, state, billing period, prices). */
function basePlans(plans: BasePlan[]): JsonValue {
  return plans.map((plan): JsonValue => {
    const prices = plan.regionalConfigs ? regionalPrices(plan.regionalConfigs) : {};
    return {
      basePlanId: plan.basePlanId,
      ...(plan.state ? { state: plan.state } : {}),
      ...(plan.autoRenewingBasePlanType
        ? { period: plan.autoRenewingBasePlanType.billingPeriodDuration }
        : {}),
      ...(Object.keys(prices).length > 0 ? { prices } : {}),
    };
  });
}

/** A subscription's listings, normalized to language + title pairs. */
function listings(items: SubscriptionListing[]): JsonValue {
  return items.map(
    (listing): JsonValue => ({ languageCode: listing.languageCode, title: listing.title }),
  );
}

/** One captured subscription → a snapshot entity keyed by its product id. */
function toEntity(subscription: SubscriptionResource): SnapshotEntity {
  const data: JsonValue = {
    productId: subscription.productId,
    ...(subscription.basePlans ? { basePlans: basePlans(subscription.basePlans) } : {}),
    ...(subscription.listings ? { listings: listings(subscription.listings) } : {}),
  };
  const planCount = subscription.basePlans?.length ?? 0;
  return {
    key: subscription.productId,
    summary: `Play subscription (${planCount} base plan(s))`,
    data,
  };
}

/** One captured base plan, parsed back to the fields restore needs (the rest of a base plan isn't restorable). */
interface RestorableBasePlan {
  basePlanId: string;
  period: string | undefined;
  prices: Record<string, PlayPriceConfig>;
}

/** Invert a captured `prices` map (`{ region: { priceMicros, currency } }`) back to per-region price configs. */
function toPriceMap(value: JsonValue | undefined): Record<string, PlayPriceConfig> {
  const map = jsonRecord(value);
  if (!map) return {};
  const prices: Record<string, PlayPriceConfig> = {};
  for (const [region, raw] of Object.entries(map)) {
    const price = toPriceConfig(raw);
    if (price) prices[region] = price;
  }
  return prices;
}

/**
 * Read the first captured base plan back into a {@link RestorableBasePlan}. Launch models one config as one
 * Play subscription with a single base plan (see `reconcilePlaySubscriptions`), so restore rebuilds from
 * the first; any extra captured base plans aren't reconstructed. Returns `null` when none is well-formed.
 */
function firstBasePlan(value: JsonValue | undefined): RestorableBasePlan | null {
  if (!Array.isArray(value)) return null;
  const first = jsonRecord(value[0]);
  if (!first) return null;
  const basePlanId = stringField(first, 'basePlanId');
  if (basePlanId === undefined) return null;
  return { basePlanId, period: stringField(first, 'period'), prices: toPriceMap(first['prices']) };
}

/** Invert a captured `listings` array (`{ languageCode, title }`) back into the shared localization list. */
function toLocalizations(value: JsonValue | undefined): ProductLocalization[] {
  if (!Array.isArray(value)) return [];
  const localizations: ProductLocalization[] = [];
  for (const item of value) {
    const record = jsonRecord(item);
    if (!record) continue;
    const locale = stringField(record, 'languageCode');
    const name = stringField(record, 'title');
    if (locale !== undefined && name !== undefined) localizations.push({ locale, name });
  }
  return localizations;
}

/**
 * Rebuild a {@link SubscriptionConfig} from one captured subscription entity, targeting the Play
 * reconciler. The billing period is read back from the first base plan's ISO duration and its per-region
 * prices become the `play` override. Returns `null` when the subscription can't be faithfully restored —
 * no base plan, an unknown billing period, or no captured prices (`PlaySubscriptionOverride` requires at
 * least one region). `referenceName` is an Apple-only field the Play path ignores, so the product id fills it.
 */
function toSubscriptionConfig(entity: SnapshotEntity): SubscriptionConfig | null {
  const data = jsonRecord(entity.data);
  if (!data) return null;
  const productId = stringField(data, 'productId') ?? entity.key;
  const basePlan = firstBasePlan(data['basePlans']);
  if (!basePlan?.period) return null;
  const subscriptionPeriod = periodFromIso(basePlan.period);
  if (!subscriptionPeriod) return null;
  if (Object.keys(basePlan.prices).length === 0) return null;

  const play: PlaySubscriptionOverride = {
    productId,
    basePlanId: basePlan.basePlanId,
    prices: basePlan.prices,
  };
  return {
    productId,
    referenceName: productId,
    subscriptionPeriod,
    localizations: toLocalizations(data['listings']),
    play,
  };
}

/** The Google Play subscription snapshot source. */
export const playSubscriptionsSource: SnapshotSource = {
  id: 'play-subscriptions',
  title: 'Google Play subscriptions',
  store: 'play',
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = androidApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return {
        state: 'skipped',
        reason: 'no Play service account',
        hint: 'configure Play credentials',
      };
    }

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities> => {
        const entities = (await api.listSubscriptions(identifier)).map(toEntity);
        return { app: name, identifier, entities };
      }),
    );
    return { state: 'captured', apps: captured };
  },

  /**
   * Restore each app's captured subscriptions to Google Play via the same `reconcilePlaySubscriptions` the
   * `launch sync` / `launch plan` Play-subscriptions surface uses. Additive: it creates a missing
   * subscription + base plan (and activates it), or patches drifted listings on an existing one, never
   * deleting or repricing a live base plan. Each app is isolated — an unreachable Play app record becomes a
   * skipped action — and a subscription that can't be faithfully rebuilt is skipped with a reason.
   */
  async restore({ ctx, saved, dryRun }: RestoreInput): Promise<RestoreReport> {
    const client = await ctx.resolvePlayWriteClient();
    if (!client) {
      return {
        actions: [skippedAction('Google Play subscriptions: skipped — no Play service account')],
      };
    }

    const actions: PlannedAction[] = [];
    for (const app of saved) {
      const subscriptions: SubscriptionConfig[] = [];
      for (const entity of app.entities) {
        const config = toSubscriptionConfig(entity);
        if (config) subscriptions.push(config);
        else {
          actions.push(
            skippedAction(
              `Play subscription ${entity.key}: skipped — needs a base plan with a known period and prices`,
            ),
          );
        }
      }
      if (subscriptions.length === 0) continue;
      try {
        const report = await reconcilePlaySubscriptions(client, {
          packageName: app.identifier,
          subscriptions,
          dryRun,
        });
        actions.push(...report.actions);
      } catch (error) {
        actions.push(
          skippedAction(
            `Google Play subscriptions ${app.identifier}: ${restoreErrorMessage(error)}`,
          ),
        );
      }
    }
    return { actions };
  },
};
