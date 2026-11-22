import type {
  SnapshotAscApi,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../../types/snapshot.ts';
import { iosApps } from '../../readiness/app-scopes.ts';

function toEntity(
  group: string,
  sub: {
    productId: string;
    subscriptionPeriod?: string | undefined;
    state?: string | undefined;
  },
): SnapshotEntity {
  let periodSuffix = '';

  if (sub.subscriptionPeriod) {
    periodSuffix = ` ${sub.subscriptionPeriod}`;
  }

  let stateSuffix = '';

  if (sub.state) {
    stateSuffix = ` (${sub.state})`;
  }

  const subscriptionFields: Record<string, string> = { productId: sub.productId, group };

  if (sub.subscriptionPeriod) {
    subscriptionFields['period'] = sub.subscriptionPeriod;
  }

  if (sub.state) {
    subscriptionFields['state'] = sub.state;
  }

  return {
    key: sub.productId,
    summary: `subscription${periodSuffix} in ${group}${stateSuffix}`,
    data: subscriptionFields,
  };
}

async function captureGroup(
  api: SnapshotAscApi,
  group: { id: string; referenceName: string },
): Promise<SnapshotEntity[]> {
  const subs = await api.listSubscriptions(group.id);

  return subs.map(function subscriptionEntity(sub) {
    return toEntity(group.referenceName, sub);
  });
}

async function captureApp(api: SnapshotAscApi, app: { name: string; identifier: string }) {
  const appId = await api.getAppId(app.identifier);

  if (appId == null) {
    return null;
  }

  const groups = await api.listSubscriptionGroups(appId);
  const nested = await Promise.all(
    groups.map(function captureNamedGroup(group) {
      return captureGroup(api, group);
    }),
  );

  return { app: app.name, identifier: app.identifier, entities: nested.flat() };
}

function keepApp<AppRecord>(app: AppRecord | null): AppRecord[] {
  if (app == null) {
    return [];
  }

  return [app];
}

async function captureAppleSubscriptions(snapshotContext: SnapshotContext): Promise<SourceCapture> {
  const apps = iosApps(snapshotContext.apps);

  if (apps.length == 0) {
    return { state: 'omitted' };
  }

  const api = await snapshotContext.resolveAscApi();

  if (api == null) {
    return {
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch creds set-key`',
    };
  }

  const captured = await Promise.all(
    apps.map(function captureNamedApp(app) {
      return captureApp(api, app);
    }),
  );

  return { state: 'captured', apps: captured.flatMap(keepApp) };
}

export const appleSubscriptionsSource: SnapshotSource = {
  id: 'apple-subscriptions',
  title: 'App Store subscriptions',
  store: 'appstore',
  capture: captureAppleSubscriptions,
};
