// Saves App Store Connect in-app purchases into a copy of the store.

import type {
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../../types/snapshot.ts';
import { iosApps } from '../../readiness/app-scopes.ts';

function readSnapshotEntity(iap: {
  productId: string;
  inAppPurchaseType: string;
  state?: string | undefined;
}): SnapshotEntity {
  let stateSuffix = '';

  if (iap.state) {
    stateSuffix = ` (${iap.state})`;
  }

  const productFields: Record<string, string> = {
    productId: iap.productId,
    type: iap.inAppPurchaseType,
  };

  if (iap.state) {
    productFields['state'] = iap.state;
  }

  return {
    key: iap.productId,
    summary: `in-app purchase ${iap.inAppPurchaseType}${stateSuffix}`,
    data: productFields,
  };
}

async function captureApp(api: SnapshotAscApi, app: { name: string; identifier: string }) {
  const appId = await api.getAppId(app.identifier);

  if (appId == null) {
    return null;
  }

  const purchases = await api.listInAppPurchases(appId);

  return { app: app.name, identifier: app.identifier, entities: purchases.map(readSnapshotEntity) };
}

function keepApp<AppRecord>(app: AppRecord | null): AppRecord[] {
  if (app == null) {
    return [];
  }

  return [app];
}

async function captureAppleProducts(snapshotContext: SnapshotContext): Promise<SourceCapture> {
  const apps = iosApps(snapshotContext.apps);

  if (apps.length == 0) {
    return { state: 'omitted' };
  }

  const api = await snapshotContext.readAscApi();

  if (api == null) {
    return {
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch-store creds set-key`',
    };
  }

  const captured = await Promise.all(
    apps.map(function captureNamedApp(app) {
      return captureApp(api, app);
    }),
  );

  return { state: 'captured', apps: captured.flatMap(keepApp) };
}

export const appleProductsSource: SnapshotSource = {
  id: 'apple-products',
  title: 'App Store in-app purchases',
  store: 'appstore',
  capture: captureAppleProducts,
};
