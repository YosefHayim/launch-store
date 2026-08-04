import { Effect } from 'effect';
import type {
  AppEntities,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
} from '@core/types/snapshot.js';
import { iosApps } from '@core/readiness/appScopes.js';
/** One captured subscription -> a snapshot entity keyed by its product id. */
const toEntity = (
  group: string,
  sub: {
    productId: string;
    subscriptionPeriod?: string | undefined;
    state?: string | undefined;
  },
): SnapshotEntity => {
  let periodSuffix = '';
  if (sub.subscriptionPeriod) periodSuffix = ` ${sub.subscriptionPeriod}`;
  let stateSuffix = '';
  if (sub.state) stateSuffix = ` (${sub.state})`;
  const subscriptionFields: Record<string, string> = { productId: sub.productId, group };
  if (sub.subscriptionPeriod) subscriptionFields['period'] = sub.subscriptionPeriod;
  if (sub.state) subscriptionFields['state'] = sub.state;
  return {
    key: sub.productId,
    summary: `subscription${periodSuffix} in ${group}${stateSuffix}`,
    data: subscriptionFields,
  };
};
/** The App Store Connect subscription snapshot source. */
export const appleSubscriptionsSource: SnapshotSource = {
  id: 'apple-subscriptions',
  title: 'App Store subscriptions',
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
            const groups = yield* api.listSubscriptionGroups(appId);
            const nested = yield* Effect.forEach(
              groups,
              (group) =>
                Effect.gen(function* () {
                  const subs = yield* api.listSubscriptions(group.id);
                  return subs.map((sub) => toEntity(group.referenceName, sub));
                }),
              { concurrency: 'unbounded' },
            );
            return { app: name, identifier, entities: nested.flat() };
          }),
        { concurrency: 'unbounded' },
      );
      return {
        state: 'captured',
        apps: captured.filter((app): app is AppEntities => app !== null),
      };
    });
  },
};
