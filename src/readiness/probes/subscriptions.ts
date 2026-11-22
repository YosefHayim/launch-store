import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@/types/readiness.js';
import { iosApps } from '../appScopes.js';
import { declaredSubscriptionIds, gradeDeclaredProduct } from './iapReadiness.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

async function readSubscriptionFindings(
  api: AscReadinessApi,
  readinessContext: ReadinessContext,
  app: { name: string; identifier: string },
): Promise<AppReadiness[]> {
  const appId = await api.getAppId(app.identifier);

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

  const groups = await api.listSubscriptionGroups(appId);

  function listGroupSubscriptions(group: { id: string }) {
    return api.listSubscriptions(group.id);
  }

  const liveSubscriptionsByGroup = await Promise.all(groups.map(listGroupSubscriptions));
  const liveSubscriptions = liveSubscriptionsByGroup.flat();

  function rememberSubscription(subscription: (typeof liveSubscriptions)[number]) {
    return [subscription.productId, subscription] as const;
  }

  const liveByProductId = new Map(liveSubscriptions.map(rememberSubscription));

  function gradeSubscription(productId: string): AppReadiness {
    const grade = gradeDeclaredProduct(productId, liveByProductId.get(productId), 'subscription');

    return { app: app.name, identifier: productId, ...grade };
  }

  return declaredSubscriptionIds(readinessContext, app.identifier).map(gradeSubscription);
}

/** The App Store Connect subscription-level readiness probe. */
export const subscriptionsProbe = {
  id: 'apple-subscriptions',
  title: 'Subscriptions shippable',
  store: 'appstore',
  categories: ['iap', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    function keepsSellingApp(app: { identifier: string }): boolean {
      return declaredSubscriptionIds(readinessContext, app.identifier).length > 0;
    }

    const apps = iosApps(readinessContext.apps).filter(keepsSellingApp);
    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const api = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(api)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = api;

    function readSubscriptions(app: { name: string; identifier: string }): Promise<AppReadiness[]> {
      return readSubscriptionFindings(appleApi, readinessContext, app);
    }

    const nested = await Promise.all(apps.map(readSubscriptions));

    return { state: 'checked', apps: nested.flat() };
  },
} satisfies ReadinessProbe;
