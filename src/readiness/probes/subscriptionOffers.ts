import type { SubscriptionConfig } from '../../types/catalog.ts';
import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { iosApps } from '../appScopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.ts';

type LiveSubscription = Readonly<{
  id?: string;
  productId: string;
}>;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isSubscriptionAbsent(
  subscription: LiveSubscription | undefined,
): subscription is undefined {
  return subscription == null;
}

function isIdMissing(subscriptionId: string | undefined): subscriptionId is undefined {
  return subscriptionId == null;
}

function readLiveSubscriptionId(subscription: LiveSubscription | undefined): string | null {
  if (isSubscriptionAbsent(subscription)) {
    return null;
  }

  const subscriptionId = subscription.id;

  if (isIdMissing(subscriptionId)) {
    return null;
  }

  const isEmpty = subscriptionId.length == 0;

  if (isEmpty) {
    return null;
  }

  return subscriptionId;
}

function subscriptionsWithOfferCodes(
  readinessContext: ReadinessContext,
  bundleId: string,
): SubscriptionConfig[] {
  const subscriptionGroups = readinessContext.config.products?.[bundleId]?.subscriptionGroups;
  const isUndeclared = subscriptionGroups == null;

  if (isUndeclared) {
    return [];
  }

  const matchingSubscriptions: SubscriptionConfig[] = [];

  for (const subscriptionGroup of subscriptionGroups) {
    for (const subscription of subscriptionGroup.subscriptions) {
      const offerCodes = subscription.offerCodes;
      const isUndeclaredOffers = offerCodes == null;

      if (isUndeclaredOffers) {
        continue;
      }

      const isEmpty = offerCodes.length == 0;

      if (isEmpty) {
        continue;
      }

      matchingSubscriptions.push(subscription);
    }
  }

  return matchingSubscriptions;
}

async function gradeOfferCodes(
  appleStore: AscReadinessApi,
  appName: string,
  subscription: SubscriptionConfig,
  liveSubscription: LiveSubscription | undefined,
): Promise<AppReadiness[]> {
  const liveSubscriptionId = readLiveSubscriptionId(liveSubscription);
  const isNotOnStore = liveSubscriptionId == null;

  if (isNotOnStore) {
    return [
      {
        app: appName,
        identifier: subscription.productId,
        status: 'warn',
        detail: `${subscription.productId}: offers not verified - subscription not on App Store Connect yet`,
        hint: 'create the subscription first (run `launch sync`)',
      },
    ];
  }

  const declaredOffers = subscription.offerCodes;
  const isUndeclared = declaredOffers == null;

  if (isUndeclared) {
    return [];
  }

  const liveOffers = await appleStore.listSubscriptionOfferCodes(liveSubscriptionId);

  function offerName(offer: { name: string }): string {
    return offer.name;
  }

  const liveNames = new Set(liveOffers.map(offerName));

  function gradeOffer(offer: { name: string }): AppReadiness {
    const subject = {
      app: appName,
      identifier: `${subscription.productId}-${offer.name}`,
    };
    const isPresent = liveNames.has(offer.name);

    if (isPresent) {
      return {
        ...subject,
        status: 'ok',
        detail: `${subscription.productId} - ${offer.name}: offer code present`,
      };
    }

    return {
      ...subject,
      status: 'warn',
      detail: `${subscription.productId} - ${offer.name}: declared offer code missing`,
      hint: 'run `launch offers` to create it',
    };
  }

  return declaredOffers.map(gradeOffer);
}

async function readOfferFindings(
  appleStore: AscReadinessApi,
  readinessContext: ReadinessContext,
  app: { name: string; identifier: string },
): Promise<AppReadiness[]> {
  const appId = await appleStore.getAppId(app.identifier);

  if (isAppRecordMissing(appId)) {
    return [
      {
        app: app.name,
        identifier: app.identifier,
        status: 'warn',
        detail: "can't verify - no app record yet",
        hint: 'create the app record first (see the app-record check)',
      },
    ];
  }

  const subscriptionGroups = await appleStore.listSubscriptionGroups(appId);

  function listGroupSubscriptions(subscriptionGroup: { id: string }) {
    return appleStore.listSubscriptions(subscriptionGroup.id);
  }

  const liveSubscriptionsByGroup = await Promise.all(
    subscriptionGroups.map(listGroupSubscriptions),
  );
  const liveSubscriptions = liveSubscriptionsByGroup.flat();

  function rememberSubscription(subscription: LiveSubscription) {
    return [subscription.productId, subscription] as const;
  }

  const liveSubscriptionsByProductId = new Map(liveSubscriptions.map(rememberSubscription));

  function gradeSubscription(subscription: SubscriptionConfig): Promise<AppReadiness[]> {
    return gradeOfferCodes(
      appleStore,
      app.name,
      subscription,
      liveSubscriptionsByProductId.get(subscription.productId),
    );
  }

  const findingsBySubscription = await Promise.all(
    subscriptionsWithOfferCodes(readinessContext, app.identifier).map(gradeSubscription),
  );

  return findingsBySubscription.flat();
}

/** Check declared subscription offer codes against App Store Connect. */
export const subscriptionOffersProbe = {
  id: 'apple-subscription-offers',
  title: 'Declared subscription offer codes exist',
  store: 'appstore',
  categories: ['iap'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    function keepsOfferApp(app: { identifier: string }): boolean {
      return subscriptionsWithOfferCodes(readinessContext, app.identifier).length > 0;
    }

    const apps = iosApps(readinessContext.apps).filter(keepsOfferApp);
    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const appleStore = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(appleStore)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = appleStore;

    function readOffers(app: { name: string; identifier: string }): Promise<AppReadiness[]> {
      return readOfferFindings(appleApi, readinessContext, app);
    }

    const nested = await Promise.all(apps.map(readOffers));

    return { state: 'checked', apps: nested.flat() };
  },
} satisfies ReadinessProbe;
