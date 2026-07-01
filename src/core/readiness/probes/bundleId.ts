/**
 * Probe: is each iOS app's Bundle ID (App ID) **registered in the Developer portal**? Code signing and the
 * App Store Connect app record both hang off a registered Bundle ID, so a missing one stops a distribution
 * build before it can be signed. `launch sync` registers it as a side effect; this probe surfaces the gap
 * up front (read-only, via the same `findBundleId` lookup) so an audit reports it instead of a build dying
 * mid-archive. A `null` lookup is the expected "not ready" signal, mapped to a blocker.
 */

import type { ProbeResult, ReadinessContext, ReadinessProbe } from '../../types.js';
import { iosApps } from '../appScopes.js';

/** The Apple Bundle ID (App ID) registration readiness probe. */
export const bundleIdProbe: ReadinessProbe = {
  id: 'apple-bundle-id',
  title: 'Apple Bundle ID registered',
  store: 'appstore',
  categories: ['signing', 'submit'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = iosApps(ctx.apps);
    if (apps.length === 0) return { state: 'omitted' };

    const api = await ctx.resolveAscApi();
    if (!api)
      return {
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };

    const results = await Promise.all(
      apps.map(async ({ name, identifier }) => {
        const bundleId = await api.findBundleId(identifier);
        return bundleId
          ? {
              app: name,
              identifier,
              status: 'ok' as const,
              detail: 'registered in the Developer portal',
            }
          : {
              app: name,
              identifier,
              status: 'blocker' as const,
              detail: 'Bundle ID not registered in the Developer portal',
              hint: 'run `launch sync` to register the App ID before building for distribution',
            };
      }),
    );
    return { state: 'checked', apps: results };
  },
};
