import { Effect } from 'effect';
import type { SnapshotContext, SnapshotEntity, SnapshotSource } from '@core/types/snapshot.js';
import { iosApps } from '@core/readiness/appScopes.js';
/** One enabled capability -> a snapshot entity keyed by its capability type. */
const toEntity = (capabilityType: string): SnapshotEntity => {
  return { key: capabilityType, summary: `capability ${capabilityType}`, data: { capabilityType } };
};
/** The App ID (bundle id) capabilities snapshot source. */
export const appleCapabilitiesSource: SnapshotSource = {
  id: 'apple-capabilities',
  title: 'App ID capabilities',
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
            const bundle = yield* api.findBundleId(identifier);
            if (!bundle) return { app: name, identifier, entities: [] }; // App ID not registered yet - nothing enabled
            const capabilities = yield* api.listBundleIdCapabilities(bundle.id);
            const entities = capabilities
              .map((capability) => toEntity(capability.capabilityType))
              .sort((a, b) => a.key.localeCompare(b.key));
            return { app: name, identifier, entities };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'captured', apps: captured };
    });
  },
};
