import type {
  PlayPriceConfig,
  PlaySubscriptionOverride,
  ProductLocalization,
  SubscriptionConfig,
} from '../../types/catalog.ts';
import type {
  JsonValue,
  RestoreInput,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
} from '../../types/snapshot.ts';
import type {
  BasePlan,
  RegionalBasePlanConfig,
  SubscriptionListing,
  SubscriptionResource,
} from '../../types/google-play.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import {
  periodFromIso,
  reconcilePlaySubscriptions,
  unitsToMicros,
} from '../../store/google/play-subscriptions.ts';
import { androidApps } from '../../readiness/app-scopes.ts';
import {
  jsonRecord,
  restoreErrorMessage,
  skippedAction,
  stringField,
  readPriceConfig,
} from './play-restore.ts';
import type { PlayMoneyUnits } from '../../types/play-pricing.ts';

/** A base plan's per-region prices -> the snapshot's `{ priceMicros */
function regionalPrices(configs: readonly RegionalBasePlanConfig[]): Record<string, JsonValue> {
  const prices: Record<string, JsonValue> = {};

  function sortA(
    a: {
      readonly regionCode: string;
      readonly newSubscriberAvailability?: boolean;
      readonly price?: PlayMoneyUnits;
    },
    b: {
      readonly regionCode: string;
      readonly newSubscriberAvailability?: boolean;
      readonly price?: PlayMoneyUnits;
    },
  ) {
    return a.regionCode.localeCompare(b.regionCode);
  }

  for (const config of [...configs].sort(sortA)) {
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
const basePlans = (plans: readonly BasePlan[]): JsonValue => {
  return plans.map((plan): JsonValue => {
    let prices: Record<string, JsonValue> = {};

    if (plan.regionalConfigs) prices = regionalPrices(plan.regionalConfigs);

    const planFields: Record<string, JsonValue> = { basePlanId: plan.basePlanId };

    if (plan.state) planFields['state'] = plan.state;

    if (plan.autoRenewingBasePlanType)
      planFields['period'] = plan.autoRenewingBasePlanType.billingPeriodDuration;

    if (Object.keys(prices).length > 0) planFields['prices'] = prices;

    return planFields;
  });
};
/** A subscription's listings, normalized to language + title pairs. */
function listings(items: readonly SubscriptionListing[]): JsonValue {
  function mapListing(listing: {
    readonly languageCode: string;
    readonly title: string;
    readonly description: string;
    readonly benefits?: readonly string[];
  }): JsonValue {
    return { languageCode: listing.languageCode, title: listing.title };
  }

  return items.map(mapListing);
}
/** One captured subscription -> a snapshot entity keyed by its product id. */
function readSnapshotEntity(subscription: SubscriptionResource): SnapshotEntity {
  const subscriptionFields: Record<string, JsonValue> = { productId: subscription.productId };

  if (subscription.basePlans) subscriptionFields['basePlans'] = basePlans(subscription.basePlans);

  if (subscription.listings) subscriptionFields['listings'] = listings(subscription.listings);

  let planCount = subscription.basePlans?.length;

  if (planCount == null) planCount = 0;

  return {
    key: subscription.productId,
    summary: `Play subscription (${planCount} base plan(s))`,
    data: subscriptionFields,
  };
}
/** One captured base plan, parsed back to the fields restore needs (the rest of a base plan isn't restorable). */
type RestorableBasePlan = {
  basePlanId: string;
  period: string | undefined;
  prices: Record<string, PlayPriceConfig>;
};
/** Invert a captured `prices` map (`{ region: { priceMicros, currency } }`) back to per-region price configs. */
function readPriceMap(capturedPrices: JsonValue | undefined): Record<string, PlayPriceConfig> {
  const map = jsonRecord(capturedPrices);

  if (!map) return {};

  const prices: Record<string, PlayPriceConfig> = {};

  for (const [region, raw] of Object.entries(map)) {
    const price = readPriceConfig(raw);

    if (price) prices[region] = price;
  }

  return prices;
}
/** Read the first captured base plan back into a {@link RestorableBasePlan}. */
function firstBasePlan(capturedBasePlans: JsonValue | undefined): RestorableBasePlan | null {
  if (!Array.isArray(capturedBasePlans)) return null;

  const first = jsonRecord(capturedBasePlans[0]);

  if (!first) return null;

  const basePlanId = stringField(first, 'basePlanId');

  if (basePlanId == null) return null;

  return {
    basePlanId,
    period: stringField(first, 'period'),
    prices: readPriceMap(first['prices']),
  };
}
/** Invert a captured `listings` array (`{ languageCode, title }`) back into the shared localization list. */
function readCapturedLocalizations(capturedListings: JsonValue | undefined): ProductLocalization[] {
  if (!Array.isArray(capturedListings)) return [];

  const localizations: ProductLocalization[] = [];

  for (const capturedListing of capturedListings) {
    const record = jsonRecord(capturedListing);

    if (!record) continue;

    const locale = stringField(record, 'languageCode');
    const name = stringField(record, 'title');

    if (locale == null) {
      continue;
    }

    if (name == null) {
      continue;
    }

    localizations.push({ locale, name });
  }

  return localizations;
}
/** Rebuild a {@link SubscriptionConfig} from one captured subscription entity */
function readSubscriptionConfig(entity: SnapshotEntity): SubscriptionConfig | null {
  const subscriptionFields = jsonRecord(entity.data);

  if (!subscriptionFields) return null;

  let productId = stringField(subscriptionFields, 'productId');

  if (productId == null) productId = entity.key;

  const basePlan = firstBasePlan(subscriptionFields['basePlans']);

  if (!basePlan?.period) return null;

  const subscriptionPeriod = periodFromIso(basePlan.period);

  if (!subscriptionPeriod) return null;

  if (Object.keys(basePlan.prices).length == 0) return null;

  const play: PlaySubscriptionOverride = {
    productId,
    basePlanId: basePlan.basePlanId,
    prices: basePlan.prices,
  };

  return {
    productId,
    referenceName: productId,
    subscriptionPeriod,
    localizations: readCapturedLocalizations(subscriptionFields['listings']),
    play,
  };
}
/** The Google Play subscription snapshot source. */
export const playSubscriptionsSource: SnapshotSource = {
  id: 'play-subscriptions',
  title: 'Google Play subscriptions',
  store: 'play',
  capture: capturePlaySubscriptions,
  /** Restore each app's captured subscriptions to Google Play via the same */
  restore: restorePlaySubscriptions,
};

type PlayCaptureEntry =
  | { readonly captured: { app: string; identifier: string; entities: SnapshotEntity[] } }
  | { readonly skipped: { app: string; identifier: string; reason: string } };

async function captureOneSubscriptionApp(
  snapshotContext: SnapshotContext,
  app: { name: string; identifier: string },
): Promise<PlayCaptureEntry> {
  const client = await snapshotContext.resolvePlayApi(app.identifier);

  if (client == null) {
    return {
      skipped: { app: app.name, identifier: app.identifier, reason: 'no Play service account' },
    };
  }

  const records = await client.listSubscriptions(app.identifier);

  return {
    captured: {
      app: app.name,
      identifier: app.identifier,
      entities: records.map(readSnapshotEntity),
    },
  };
}

function capturedApps(entry: PlayCaptureEntry) {
  if ('captured' in entry) {
    return [entry.captured];
  }

  return [];
}

function skippedApps(entry: PlayCaptureEntry) {
  if ('skipped' in entry) {
    return [entry.skipped];
  }

  return [];
}

async function capturePlaySubscriptions(snapshotContext: SnapshotContext) {
  const apps = androidApps(snapshotContext.apps);

  if (apps.length == 0) {
    return { state: 'omitted' as const };
  }

  const results = await Promise.all(
    apps.map(function captureNamedApp(app) {
      return captureOneSubscriptionApp(snapshotContext, app);
    }),
  );
  const captured = results.flatMap(capturedApps);
  const skipped = results.flatMap(skippedApps);

  if (captured.length == 0) {
    return {
      state: 'skipped' as const,
      reason: `no Play service account for ${skipped
        .map(function appName(entry) {
          return entry.app;
        })
        .join(', ')}`,
      hint: 'configure Play credentials',
    };
  }

  if (skipped.length == 0) {
    return { state: 'captured' as const, apps: captured };
  }

  return { state: 'captured' as const, apps: captured, skippedApps: skipped };
}

async function restorePlaySubscriptions({ ctx: restoreContext, saved, dryRun }: RestoreInput) {
  const actions: PlannedAction[] = [];

  for (const app of saved) {
    const client = await restoreContext.resolvePlayWriteClient(app.identifier);

    if (client == null) {
      actions.push(
        skippedAction(`Google Play: skipped - no Play service account for ${app.identifier}`),
      );
      continue;
    }

    const subscriptions: SubscriptionConfig[] = [];

    for (const entity of app.entities) {
      const subscriptionConfig = readSubscriptionConfig(entity);

      if (subscriptionConfig == null) {
        actions.push(
          skippedAction(
            `Play subscription ${entity.key}: skipped - needs a base plan with a known period and prices`,
          ),
        );

        continue;
      }

      subscriptions.push(subscriptionConfig);
    }

    if (subscriptions.length == 0) {
      continue;
    }

    const appActions = await reconcileSubscriptionActions(
      client,
      app.identifier,
      subscriptions,
      dryRun,
    );

    actions.push(...appActions);
  }

  return { actions };
}

async function reconcileSubscriptionActions(
  client: NonNullable<Awaited<ReturnType<RestoreInput['ctx']['resolvePlayWriteClient']>>>,
  packageName: string,
  subscriptions: SubscriptionConfig[],
  dryRun: boolean,
): Promise<PlannedAction[]> {
  try {
    const reconciliation = await reconcilePlaySubscriptions(client, {
      packageName,
      subscriptions,
      dryRun,
    });

    return [...reconciliation.actions];
  } catch (reconciliationFailure) {
    const errorMessage = restoreErrorMessage(reconciliationFailure);
    return [skippedAction(`Google Play subscriptions ${packageName}: ${errorMessage}`)];
  }
}
