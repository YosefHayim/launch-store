/**
 * Probe: has each Android app received its **first build upload**? Google Play blocks API-driven
 * submission until at least one build has been uploaded (historically a manual Play Console upload), so a
 * brand-new app with valid credentials still can't be released by `launch` until this is satisfied.
 * `getLatestVersionCode` returns `0` when no bundle has been uploaded — the blocker signal — reusing the
 * same reader `launch status` uses. A read failure here is mapped to a `warn` (the app-access probe owns
 * the "app missing" blocker) so it never double-reports or errors the run.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from "../types.js";
import { androidApps } from "../appScopes.js";

/** The Google Play first-upload readiness probe. */
export const playFirstUploadProbe: ReadinessProbe = {
  id: "play-first-upload",
  title: "First build uploaded to Play",
  store: "play",
  categories: ["account"],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = androidApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return { state: "skipped", reason: "no Play service account", hint: "configure a Play service account" };
    }

    const results = await Promise.all(
      apps.map(async ({ name, identifier }) => {
        try {
          const versionCode = await api.getLatestVersionCode(identifier);
          return versionCode > 0
            ? { app: name, identifier, status: "ok" as const, detail: `latest uploaded versionCode ${versionCode}` }
            : {
                app: name,
                identifier,
                status: "blocker" as const,
                detail: "no uploaded build — Play blocks API submission until the first build is uploaded",
                hint: "upload the first build once in Play Console (a manual AAB upload satisfies this)",
              };
        } catch (error) {
          return {
            app: name,
            identifier,
            status: "warn" as const,
            detail: `could not read uploads: ${error instanceof Error ? error.message : String(error)}`,
            hint: "confirm the app exists and the service account has access (see the app-access check)",
          };
        }
      }),
    );
    return { state: "checked", apps: results };
  },
};
