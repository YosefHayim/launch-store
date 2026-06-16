/**
 * Probe: does each iOS app have an App Store Connect **app record**? It's the one thing Apple's API can't
 * create (there is no `POST /v1/apps`), so a missing record blocks every later upload/submit deep in the
 * pipeline. Catching it up front — read-only, via the same `getAppId` lookup `launch sync` uses — turns a
 * cryptic mid-build failure into one actionable line.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from "../types.js";
import { iosApps } from "../appScopes.js";

/** The App Store Connect app-record readiness probe (account onboarding). */
export const appRecordProbe: ReadinessProbe = {
  id: "apple-app-record",
  title: "App Store Connect app record",
  store: "appstore",
  categories: ["account"],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: "omitted" };

    const api = await ctx.resolveAscApi();
    if (!api) return { state: "skipped", reason: "no active Apple account", hint: "run `launch creds set-key`" };

    const results = await Promise.all(
      apps.map(async ({ name, identifier }) => {
        const appId = await api.getAppId(identifier);
        return appId
          ? { app: name, identifier, status: "ok" as const, detail: "record exists" }
          : {
              app: name,
              identifier,
              status: "blocker" as const,
              detail: "no app record on App Store Connect",
              hint: "create the app once in App Store Connect — Apple's API can't (no POST /v1/apps)",
            };
      }),
    );
    return { state: "checked", apps: results };
  },
};
