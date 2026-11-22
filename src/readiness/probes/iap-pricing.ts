import type { ProductPrice } from '../../types/catalog.ts';
import type {
  AppReadiness,
  AscReadinessApi,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/readiness.ts';
import { iosApps } from '../app-scopes.ts';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentials-skip.ts';

type PricedDeclaration = {
  productId: string;
  price: ProductPrice;
  kind: 'iap' | 'subscription';
};

type PricePoint = Readonly<{ id: string }> | null;

type PricePointResolver = (
  liveProductId: string,
  territory: string,
  customerPrice: number,
) => Promise<PricePoint>;

function isAppleAccountMissing(api: AscReadinessApi | null): api is null {
  return api == null;
}

function isAppRecordMissing(appId: string | null): appId is null {
  return appId == null;
}

function isLiveProductMissing(liveProductId: string | undefined): liveProductId is undefined {
  return liveProductId == null;
}

function isPricePointMissing(pricePoint: PricePoint): pricePoint is null {
  return pricePoint == null;
}

function pricedDeclarations(
  readinessContext: ReadinessContext,
  bundleId: string,
): PricedDeclaration[] {
  const products = readinessContext.config.products?.[bundleId];
  const declarations: PricedDeclaration[] = [];
  const inAppPurchases = products?.inAppPurchases;

  if (inAppPurchases != null) {
    for (const inAppPurchase of inAppPurchases) {
      const isUnpriced = inAppPurchase.price == null;

      if (isUnpriced) {
        continue;
      }

      declarations.push({
        productId: inAppPurchase.productId,
        price: inAppPurchase.price,
        kind: 'iap',
      });
    }
  }

  const subscriptionGroups = products?.subscriptionGroups;

  if (subscriptionGroups != null) {
    for (const subscriptionGroup of subscriptionGroups) {
      for (const subscription of subscriptionGroup.subscriptions) {
        const isUnpriced = subscription.price == null;

        if (isUnpriced) {
          continue;
        }

        declarations.push({
          productId: subscription.productId,
          price: subscription.price,
          kind: 'subscription',
        });
      }
    }
  }

  return declarations;
}

async function gradePrice(
  appName: string,
  declaration: PricedDeclaration,
  liveProductId: string | undefined,
  resolvePricePoint: PricePointResolver,
): Promise<AppReadiness> {
  const price = declaration.price;
  let territory = 'USA';

  if (price.baseTerritory != null) {
    territory = price.baseTerritory;
  }

  if (isLiveProductMissing(liveProductId)) {
    return {
      app: appName,
      identifier: declaration.productId,
      status: 'warn',
      detail: `${declaration.productId}: price not verified - not on App Store Connect yet`,
      hint: 'create the product first (run `launch-store sync`)',
    };
  }

  const matchedPricePoint = await resolvePricePoint(liveProductId, territory, price.customerPrice);

  if (isPricePointMissing(matchedPricePoint)) {
    return {
      app: appName,
      identifier: declaration.productId,
      status: 'blocker',
      detail: `${declaration.productId}: ${price.customerPrice} in ${territory} isn't an Apple price point`,
      hint: 'pick a price that matches an Apple price point (`launch-store sync` lists the nearby points)',
    };
  }

  return {
    app: appName,
    identifier: declaration.productId,
    status: 'ok',
    detail: `${declaration.productId}: price ${price.customerPrice} (${territory}) valid`,
  };
}

async function readPriceFindings(
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

  const liveInAppPurchases = await appleStore.listInAppPurchases(appId);

  function rememberPurchase(inAppPurchase: (typeof liveInAppPurchases)[number]) {
    return [inAppPurchase.productId, inAppPurchase] as const;
  }

  const liveInAppPurchasesByProductId = new Map(liveInAppPurchases.map(rememberPurchase));
  const subscriptionGroups = await appleStore.listSubscriptionGroups(appId);

  function listGroupSubscriptions(subscriptionGroup: { id: string }) {
    return appleStore.listSubscriptions(subscriptionGroup.id);
  }

  const liveSubscriptionsByGroup = await Promise.all(
    subscriptionGroups.map(listGroupSubscriptions),
  );
  const liveSubscriptions = liveSubscriptionsByGroup.flat();

  function rememberSubscription(subscription: (typeof liveSubscriptions)[number]) {
    return [subscription.productId, subscription] as const;
  }

  const liveSubscriptionsByProductId = new Map(liveSubscriptions.map(rememberSubscription));

  function findInAppPurchasePrice(
    productId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePoint> {
    return appleStore.findInAppPurchasePricePoint(productId, territory, customerPrice);
  }

  function findSubscriptionPrice(
    productId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePoint> {
    return appleStore.findSubscriptionPricePoint(productId, territory, customerPrice);
  }

  function gradeDeclaration(declaration: PricedDeclaration): Promise<AppReadiness> {
    const isInAppPurchase = declaration.kind == 'iap';

    if (isInAppPurchase) {
      return gradePrice(
        app.name,
        declaration,
        liveInAppPurchasesByProductId.get(declaration.productId)?.id,
        findInAppPurchasePrice,
      );
    }

    return gradePrice(
      app.name,
      declaration,
      liveSubscriptionsByProductId.get(declaration.productId)?.id,
      findSubscriptionPrice,
    );
  }

  return Promise.all(pricedDeclarations(readinessContext, app.identifier).map(gradeDeclaration));
}

/** Validate declared prices against App Store Connect price points. */
export const iapPricingProbe = {
  id: 'apple-iap-pricing',
  title: 'Declared prices match Apple price points',
  store: 'appstore',
  categories: ['iap', 'submit'],
  async check(readinessContext: ReadinessContext): Promise<ProbeResult> {
    function keepsPricedApp(app: { identifier: string }): boolean {
      return pricedDeclarations(readinessContext, app.identifier).length > 0;
    }

    const apps = iosApps(readinessContext.apps).filter(keepsPricedApp);
    const isNothingSelected = apps.length == 0;

    if (isNothingSelected) {
      return OMITTED_PROBE;
    }

    const appleStore = await readinessContext.resolveAscApi();

    if (isAppleAccountMissing(appleStore)) {
      return SKIPPED_NO_APPLE_ACCOUNT;
    }

    const appleApi = appleStore;

    function readPrices(app: { name: string; identifier: string }): Promise<AppReadiness[]> {
      return readPriceFindings(appleApi, readinessContext, app);
    }

    const nested = await Promise.all(apps.map(readPrices));

    return { state: 'checked', apps: nested.flat() };
  },
} satisfies ReadinessProbe;
