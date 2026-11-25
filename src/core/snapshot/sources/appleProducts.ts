import { Effect } from 'effect';
import type { SnapshotContext, SnapshotEntity, SnapshotSource } from '@core/types/snapshot.js';
import { iosApps } from '@core/readiness/appScopes.js';
/** One captured in-app purchase -> a snapshot entity keyed by its product id. */
const toEntity = (iap: {
  productId: string;
  inAppPurchaseType: string;
  state?: string | undefined;
}): SnapshotEntity => {
  let stateSuffix = '';
  if (iap.state) stateSuffix = ` (${iap.state})`;
  const productFields: Record<string, string> = {
    productId: iap.productId,
    type: iap.inAppPurchaseType,
  };
  if (iap.state) productFields['state'] = iap.state;
  return {
    key: iap.productId,
    summary: `in-app purchase ${iap.inAppPurchaseType}${stateSuffix}`,
    data: productFields,
  };
};
/** The App Store Connect one-time in-app-purchase snapshot source. */
export const appleProductsSource: SnapshotSource = {
  id: 'apple-products',
  title: 'App Store in-app purchases',
  store: 'appstore',
  capture(snapshotContext: SnapshotContext) {
    return Effect.gen(function* () {
      const apps = iosApps(snapshotContext.apps);
      if (apps.length === 0) return { state: 'omitted' };
      const api = yield* snapshotContext.resolveAscApi();
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };
      const captured = yield* Effect.forEach(
        apps,
        ({ name, identifier }) =>
          Effect.gen(function* () {
            const appId = yield* api.getAppId(identifier);
            if (!appId) return null; // no App Store Connect record yet - nothing to capture for this app
            const purchases = yield* api.listInAppPurchases(appId);
            const entities = purchases.map(toEntity);
            return { app: name, identifier, entities };
          }),
        { concurrency: 'unbounded' },
      );
      return {
        state: 'captured',
        apps: captured.flatMap((app) => {
          if (app === null) return [];
          return [app];
        }),
      };
    });
  },
};
