/**
 * Source: capture each iOS app's auto-renewable subscriptions from App Store Connect — listing every
 * subscription across the app's groups and recording one entity per subscription, keyed by Apple product
 * id. Read-only, using the same readers as `launch sync`; the group's reference name rides along in the
 * entity so a diff reads naturally, but the natural key stays the product id.
 */

import type { AppEntities, SnapshotContext, SnapshotEntity, SnapshotSource, SourceCapture } from "../types.js";
import { iosApps } from "../../readiness/appScopes.js";

/** One captured subscription → a snapshot entity keyed by its product id. */
function toEntity(
  group: string,
  sub: { productId: string; subscriptionPeriod?: string | undefined; state?: string | undefined },
): SnapshotEntity {
  const periodSuffix = sub.subscriptionPeriod ? ` ${sub.subscriptionPeriod}` : "";
  const stateSuffix = sub.state ? ` (${sub.state})` : "";
  return {
    key: sub.productId,
    summary: `subscription${periodSuffix} in ${group}${stateSuffix}`,
    data: {
      productId: sub.productId,
      group,
      ...(sub.subscriptionPeriod ? { period: sub.subscriptionPeriod } : {}),
      ...(sub.state ? { state: sub.state } : {}),
    },
  };
}

/** The App Store Connect subscription snapshot source. */
export const appleSubscriptionsSource: SnapshotSource = {
  id: "apple-subscriptions",
  title: "App Store subscriptions",
  store: "appstore",
  async capture(ctx: SnapshotContext): Promise<SourceCapture> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolveAscApi();
    if (!api) return { state: "skipped", reason: "no active Apple account", hint: "run `launch creds set-key`" };

    const captured = await Promise.all(
      apps.map(async ({ name, identifier }): Promise<AppEntities | null> => {
        const appId = await api.getAppId(identifier);
        if (!appId) return null; // no App Store Connect record yet — nothing to capture for this app
        const groups = await api.listSubscriptionGroups(appId);
        const nested = await Promise.all(
          groups.map(async (group): Promise<SnapshotEntity[]> => {
            const subs = await api.listSubscriptions(group.id);
            return subs.map((sub) => toEntity(group.referenceName, sub));
          }),
        );
        return { app: name, identifier, entities: nested.flat() };
      }),
    );
    return { state: "captured", apps: captured.filter((app): app is AppEntities => app !== null) };
  },
};
