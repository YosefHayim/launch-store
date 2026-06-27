/**
 * Source: capture each iOS app's one-time in-app purchases from App Store Connect — the Apple half of the
 * snapshot's product catalog. Read-only: it lists IAPs via the same reader `launch sync` / `launch iap
 * doctor` use and records each as a normalized entity keyed by Apple product id. The volatile App Store
 * internal id is dropped so re-capturing an unchanged catalog yields an identical record.
 */

import type {
  AppEntities,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../types.js';
import { iosApps } from '../../readiness/appScopes.js';

/** One captured in-app purchase → a snapshot entity keyed by its product id. */
function toEntity(iap: {
  productId: string;
  inAppPurchaseType: string;
  state?: string | undefined;
}): SnapshotEntity {
  const stateSuffix = iap.state ? ` (${iap.state})` : '';
  return {
    key: iap.productId,
    summary: `in-app purchase ${iap.inAppPurchaseType}${stateSuffix}`,
    data: {
      productId: iap.productId,
      type: iap.inAppPurchaseType,
      ...(iap.state ? { state: iap.state } : {}),
    },
  };
}

/** The App Store Connect one-time in-app-purchase snapshot source. */
export const appleProductsSource: SnapshotSource = {
  id: 'apple-products',
  title: 'App Store in-app purchases',
  store: 'appstore',
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities | null> => {
        const appId = await api.getAppId(identifier);
        if (!appId) return null; // no App Store Connect record yet — nothing to capture for this app
        const entities = (await api.listInAppPurchases(appId)).map(toEntity);
        return { app: name, identifier, entities };
      }),
    );
    return { state: 'captured', apps: captured.filter((app): app is AppEntities => app !== null) };
  },
};
