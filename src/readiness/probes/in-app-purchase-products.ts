// Checks that declared one-time in-app purchases exist on App Store Connect and can ship.

import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import type { InAppPurchaseConfig } from '../../types/catalog.ts';
import { iosApps } from '../app-scopes.ts';
import { gradeDeclaredProduct } from './in-app-purchase-readiness.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function declaredPurchases(
  readinessContext: ReadinessContext,
  bundleId: string,
): InAppPurchaseConfig[] {
  const declared = readinessContext.config.products?.[bundleId]?.inAppPurchases;

  const isUndeclared = declared == null;

  if (isUndeclared) {
    return [];
  }

  return [...declared];
}

async function readPurchaseFindings(
  api: AscReadinessApi,
  readinessContext: ReadinessContext,
  app: { name: string; identifier: string },
): Promise<AppReadiness[]> {
  const declared = declaredPurchases(readinessContext, app.identifier);
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

  const livePurchases = await api.listInAppPurchases(appId);

  function rememberPurchase(inAppPurchase: (typeof livePurchases)[number]) {
    return [inAppPurchase.productId, inAppPurchase] as const;
  }

  const liveByProductId = new Map(livePurchases.map(rememberPurchase));

  function gradePurchase(product: InAppPurchaseConfig): AppReadiness {
    const grade = gradeDeclaredProduct(
      product.productId,
      liveByProductId.get(product.productId),
      'in-app purchase',
    );

    return { app: app.name, identifier: product.productId, ...grade };
  }

  return declared.map(gradePurchase);
}

/** The App Store Connect one-time in-app-purchase readiness probe. */
export const iapProductsProbe = {
  id: 'apple-iap-products',
  title: 'In-app purchases shippable',
  store: 'appstore',
  categories: ['iap', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    function keepsSellingApp(app: { identifier: string }): boolean {
      return declaredPurchases(readinessContext, app.identifier).length > 0;
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

    function readPurchases(app: { name: string; identifier: string }): Promise<AppReadiness[]> {
      return readPurchaseFindings(appleApi, readinessContext, app);
    }

    const nested = await Promise.all(apps.map(readPurchases));

    return { state: 'checked', apps: nested.flat() };
  },
} satisfies ReadinessProbe;
