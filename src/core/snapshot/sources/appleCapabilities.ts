/**
 * Source: capture each iOS app's enabled App ID capabilities from the Developer portal — the entitlement
 * surface (`PUSH_NOTIFICATIONS`, `ICLOUD`, `SIGN_IN_WITH_APPLE`, …) that `launch sync` reconciles from each
 * app's declared entitlements. Recording it lets a pre-sync snapshot show exactly which capabilities a sync
 * would add or (destructively) remove.
 *
 * Read-only: it reads through the same App ID resource + capability listers `launch sync` uses, keyed by the
 * capability type (its natural, stable id) so re-capturing an unchanged App ID yields an identical record.
 * Capabilities live on the bundle-id (App ID) resource, not the app record — so this source resolves the
 * App ID via `findBundleId`, independent of whether an App Store Connect app record exists yet.
 */

import type {
  AppEntities,
  SnapshotContext,
  SnapshotEntity,
  SnapshotSource,
  SourceCapture,
} from '../../types.js';
import { iosApps } from '../../readiness/appScopes.js';

/** One enabled capability → a snapshot entity keyed by its capability type. */
function toEntity(capabilityType: string): SnapshotEntity {
  return { key: capabilityType, summary: `capability ${capabilityType}`, data: { capabilityType } };
}

/** The App ID (bundle id) capabilities snapshot source. */
export const appleCapabilitiesSource: SnapshotSource = {
  id: 'apple-capabilities',
  title: 'App ID capabilities',
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
      apps.map(async ({ name, identifier }): Promise<AppEntities> => {
        const bundle = await api.findBundleId(identifier);
        if (!bundle) return { app: name, identifier, entities: [] }; // App ID not registered yet — nothing enabled
        const entities = (await api.listBundleIdCapabilities(bundle.id))
          .map((capability) => toEntity(capability.capabilityType))
          .sort((a, b) => a.key.localeCompare(b.key));
        return { app: name, identifier, entities };
      }),
    );
    return { state: 'captured', apps: captured };
  },
};
