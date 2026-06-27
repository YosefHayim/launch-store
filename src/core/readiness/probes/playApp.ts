/**
 * Probe: does each Android app exist on Google Play **and** can the configured service account reach it?
 * `assertAppExists` opens (and immediately abandons) a read edit, so a success proves both the app is
 * created and the service account has API access — the two account-level prerequisites Play submission
 * needs. A thrown {@link import("../../../google/playClient.js").PlayAppNotFoundError} is the expected
 * "not ready" signal, mapped to a blocker rather than allowed to error the run.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../types.js';
import { androidApps } from '../appScopes.js';

/** The Google Play app-exists / service-account-access readiness probe — an account and a submit blocker. */
export const playAppProbe: ReadinessProbe = {
  id: 'play-app-access',
  title: 'Play app exists & service account authorized',
  store: 'play',
  categories: ['account', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = androidApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolvePlayApi();
    if (!api) {
      return {
        state: 'skipped',
        reason: 'no Play service account',
        hint: 'configure a Play service account',
      };
    }

    const results = await Promise.all(
      apps.map(async ({ name, identifier }) => {
        try {
          await api.assertAppExists(identifier);
          return {
            app: name,
            identifier,
            status: 'ok' as const,
            detail: 'app reachable; service account authorized',
          };
        } catch (error) {
          return {
            app: name,
            identifier,
            status: 'blocker' as const,
            detail: error instanceof Error ? error.message : String(error),
            hint: 'create the app in Play Console and grant the service account access to it',
          };
        }
      }),
    );
    return { state: 'checked', apps: results };
  },
};
