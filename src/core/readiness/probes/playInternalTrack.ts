/**
 * Probe: is a Google Play **internal testing track** available for each Android app? The internal track is
 * the fastest path to get a build onto testers' devices and the usual first rollout target, so its absence
 * is worth flagging — but it's a recommendation, not a hard submission blocker, so a missing track is a
 * `warn`, not a `blocker`. Read-only via the same `listTracks` reader `launch play-tracks status` uses.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../types.js';
import { androidApps } from '../appScopes.js';

/** The track id Google Play always provisions for internal testing. */
const INTERNAL_TRACK = 'internal';

/** The Google Play internal-track readiness probe. */
export const playInternalTrackProbe: ReadinessProbe = {
  id: 'play-internal-track',
  title: 'Internal testing track ready',
  store: 'play',
  categories: ['account'],
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
          const tracks = await api.listTracks(identifier);
          return tracks.some((track) => track.track === INTERNAL_TRACK)
            ? { app: name, identifier, status: 'ok' as const, detail: 'internal track available' }
            : {
                app: name,
                identifier,
                status: 'warn' as const,
                detail: 'no internal testing track',
                hint: 'create an internal testing track in Play Console for the fastest tester rollout',
              };
        } catch (error) {
          return {
            app: name,
            identifier,
            status: 'warn' as const,
            detail: `could not read tracks: ${error instanceof Error ? error.message : String(error)}`,
            hint: 'confirm the app exists and the service account has access (see the app-access check)',
          };
        }
      }),
    );
    return { state: 'checked', apps: results };
  },
};
