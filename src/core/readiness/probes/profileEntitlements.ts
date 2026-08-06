import type { AppDescriptor } from '@core/types/app.js';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { Effect } from 'effect';
import { mapEntitlementsToCapabilities } from '@core/credentials/capabilities.js';
import { OMITTED_PROBE, SKIPPED_NO_APPLE_ACCOUNT } from './credentialsSkip.js';
/** An in-scope app: declares a bundle id and at least one entitlement that maps to a portal capability. */
type EntitledApp = {
  name: string;
  identifier: string;
  required: string[];
};
const entitledApps = (apps: AppDescriptor[]): EntitledApp[] => {
  return apps.flatMap((app) => {
    if (!app.bundleId) return [];
    const required = mapEntitlementsToCapabilities(app.iosEntitlements).enable;
    if (required.length > 0) return [{ name: app.name, identifier: app.bundleId, required }];
    return [];
  });
};
/** The App Store Connect entitlementcapability readiness probe - a signing-readiness check and submit blocker. */
export const profileEntitlementsProbe = {
  id: 'apple-profile-entitlements',
  title: 'App ID capabilities match entitlements',
  store: 'appstore',
  categories: ['signing', 'submit'],
  /**
   * Verify that each entitled iOS app's App ID has all required capabilities enabled.
   *
   * @param readinessContext - Loaded config, selected apps, and App Store Connect resolver.
   * @returns An Effect that succeeds with one entitlement-capability finding per in-scope app.
   */
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult, unknown> {
    return Effect.gen(function* () {
      const apps = entitledApps(readinessContext.apps);
      if (apps.length === 0) return OMITTED_PROBE;
      const api = yield* readinessContext.resolveAscApi();
      if (!api) return SKIPPED_NO_APPLE_ACCOUNT;
      const results: AppReadiness[] = yield* Effect.forEach(
        apps,
        ({ name, identifier, required }) =>
          Effect.gen(function* () {
            const bundle = yield* api.findBundleId(identifier);
            if (!bundle) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify - App ID not registered",
                hint: 'run `launch setup ios --provision` to register the App ID and its capabilities',
              };
            }
            const capabilities = yield* api.listBundleIdCapabilities(bundle.id);
            const enabled = new Set(capabilities.map((capability) => capability.capabilityType));
            const missing = required.filter((capability) => !enabled.has(capability));
            if (missing.length === 0)
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: 'App ID capabilities cover all entitlements',
              };
            return {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: `App ID missing capabilities: ${missing.join(', ')}`,
              hint: 'run `launch setup ios --provision` to enable them, then regenerate the profile',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
