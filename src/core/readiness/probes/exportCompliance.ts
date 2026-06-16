/**
 * Probe: has each iOS app **declared its export-compliance answer** (`ios.config.usesNonExemptEncryption`
 * in `app.json`)? When it's absent, App Store Connect holds every build at "Missing Compliance" and asks the
 * encryption question by hand before the build can be submitted — a silent per-upload stall. Declaring it
 * once lets uploads flow straight through. This is a pure config read (no network, no credentials, so it
 * never skips); an undeclared answer is advisory (`warn`), not a hard rejection.
 */

import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from "../types.js";

/** The iOS export-compliance declaration readiness probe (config-only). */
export const exportComplianceProbe: ReadinessProbe = {
  id: "apple-export-compliance",
  title: "iOS export-compliance declared",
  store: "appstore",
  categories: ["submit"],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = ctx.apps.flatMap((app) =>
      app.bundleId ? [{ name: app.name, identifier: app.bundleId, declared: app.usesNonExemptEncryption }] : [],
    );
    if (apps.length === 0) return { state: "omitted" };

    const results: AppReadiness[] = apps.map(({ name, identifier, declared }) =>
      declared === undefined
        ? {
            app: name,
            identifier,
            status: "warn",
            detail: "export compliance not declared",
            hint: "set `ios.config.usesNonExemptEncryption` in app.json so uploads skip the Missing-Compliance hold",
          }
        : {
            app: name,
            identifier,
            status: "ok",
            detail: `export compliance declared (usesNonExemptEncryption: ${declared})`,
          },
    );
    return { state: "checked", apps: results };
  },
};
