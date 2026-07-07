/**
 * Probe: does each iOS app's registered **App ID carry the capabilities its entitlements demand**? An app
 * that declares, say, Push Notifications or App Groups in its `ios.entitlements` needs the matching
 * capability enabled on its bundle id (App ID) on the developer portal — otherwise provisioning-profile
 * generation produces a profile that omits the entitlement, and the signed build is rejected at submission
 * (or fails to install). This catches the mismatch before a build is even cut.
 *
 * Read-only: it maps each app's entitlements to the capabilities Launch would enable (the same pure mapping
 * `launch sync` uses), then compares against the capabilities currently live on the bundle id — it never
 * enables one. Only apps that actually declare capability-bearing entitlements are in scope; an app whose
 * App ID isn't registered yet can't be graded, so it degrades to a `warn` pointing at `launch setup ios`.
 */

import type {
  AppDescriptor,
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { Effect } from 'effect';
import { mapEntitlementsToCapabilities } from '../../credentials/capabilities.js';

/** An in-scope app: declares a bundle id and at least one entitlement that maps to a portal capability. */
interface EntitledApp {
  /** The app handle. */
  name: string;
  /** The iOS bundle id (App ID identifier). */
  identifier: string;
  /** The capability types its entitlements require enabled on the App ID. */
  required: string[];
}

/**
 * Select apps that declare a bundle id and entitlements requiring portal capabilities.
 *
 * @param apps - Discovered app descriptors from the loaded Launch config.
 * @returns Entitled apps that need App ID capability verification.
 */
function entitledApps(apps: AppDescriptor[]): EntitledApp[] {
  return apps.flatMap((app) => {
    if (!app.bundleId) return [];
    const required = mapEntitlementsToCapabilities(app.iosEntitlements).enable;
    return required.length > 0 ? [{ name: app.name, identifier: app.bundleId, required }] : [];
  });
}

/** The App Store Connect entitlement↔capability readiness probe — a signing-readiness check and submit blocker. */
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
      if (apps.length === 0) return { state: 'omitted' };

      const api = yield* Effect.tryPromise({
        try: () => readinessContext.resolveAscApi(),
        catch: (resolverFailure) => resolverFailure,
      });
      if (!api)
        return {
          state: 'skipped',
          reason: 'no active Apple account',
          hint: 'run `launch creds set-key`',
        };

      const results: AppReadiness[] = yield* Effect.forEach(
        apps,
        ({ name, identifier, required }) =>
          Effect.gen(function* () {
            const bundle = yield* Effect.tryPromise({
              try: () => api.findBundleId(identifier),
              catch: (apiFailure) => apiFailure,
            });
            if (!bundle) {
              return {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: "can't verify — App ID not registered",
                hint: 'run `launch setup ios --provision` to register the App ID and its capabilities',
              };
            }
            const capabilities = yield* Effect.tryPromise({
              try: () => api.listBundleIdCapabilities(bundle.id),
              catch: (apiFailure) => apiFailure,
            });
            const enabled = new Set(capabilities.map((capability) => capability.capabilityType));
            const missing = required.filter((capability) => !enabled.has(capability));
            return missing.length === 0
              ? {
                  app: name,
                  identifier,
                  status: 'ok' as const,
                  detail: 'App ID capabilities cover all entitlements',
                }
              : {
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
