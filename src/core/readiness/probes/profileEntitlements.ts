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

import type { AppDescriptor } from "../../types.js";
import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from "../types.js";
import { mapEntitlementsToCapabilities } from "../../capabilities.js";

/** An in-scope app: declares a bundle id and at least one entitlement that maps to a portal capability. */
interface EntitledApp {
  /** The app handle. */
  name: string;
  /** The iOS bundle id (App ID identifier). */
  identifier: string;
  /** The capability types its entitlements require enabled on the App ID. */
  required: string[];
}

/** Narrow to apps that declare a bundle id *and* entitlements requiring portal capabilities (the probe's scope). */
function entitledApps(apps: AppDescriptor[]): EntitledApp[] {
  return apps.flatMap((app) => {
    if (!app.bundleId) return [];
    const required = mapEntitlementsToCapabilities(app.iosEntitlements).enable;
    return required.length > 0 ? [{ name: app.name, identifier: app.bundleId, required }] : [];
  });
}

/** The App Store Connect entitlement↔capability readiness probe — a signing-readiness check and submit blocker. */
export const profileEntitlementsProbe: ReadinessProbe = {
  id: "apple-profile-entitlements",
  title: "App ID capabilities match entitlements",
  store: "appstore",
  categories: ["signing", "submit"],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = entitledApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolveAscApi();
    if (!api) return { state: "skipped", reason: "no active Apple account", hint: "run `launch creds set-key`" };

    const results: AppReadiness[] = await Promise.all(
      apps.map(async ({ name, identifier, required }) => {
        const bundle = await api.findBundleId(identifier);
        if (!bundle) {
          return {
            app: name,
            identifier,
            status: "warn" as const,
            detail: "can't verify — App ID not registered",
            hint: "run `launch setup ios --provision` to register the App ID and its capabilities",
          };
        }
        const enabled = new Set((await api.listBundleIdCapabilities(bundle.id)).map((cap) => cap.capabilityType));
        const missing = required.filter((capability) => !enabled.has(capability));
        return missing.length === 0
          ? { app: name, identifier, status: "ok" as const, detail: "App ID capabilities cover all entitlements" }
          : {
              app: name,
              identifier,
              status: "blocker" as const,
              detail: `App ID missing capabilities: ${missing.join(", ")}`,
              hint: "run `launch setup ios --provision` to enable them, then regenerate the profile",
            };
      }),
    );
    return { state: "checked", apps: results };
  },
};
