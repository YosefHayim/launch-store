/**
 * The App Store **availability** plan surface: which territories an app is sold in. Wraps
 * `launch availability`'s reconciler ({@link reconcileAvailability}) in dry-run, reading desired state
 * from the `availability.config.json` sidecar (its path overridable via `configFiles.availability`).
 * Two-way: the reconciler reads the live territory set and reports both additions and removals, so a
 * `= in sync` result means live matches config.
 *
 * Sidecar-only — there is no typed `LaunchConfig` field — so the same single file applies to every
 * in-scope app; absent file ⇒ the surface is omitted.
 */

import { resolveSidecarConfig } from '../../config.js';
import { loadAvailabilityConfig, reconcileAvailability } from '../../availability.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '../../types.js';

/** Surface id — also the value users pass as `launch plan availability`. */
const SURFACE = 'availability';

export const availabilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: () =>
        resolveSidecarConfig({
          typed: undefined,
          configPath: ctx.config.configFiles?.availability ?? 'availability.config.json',
          explicitPath: false,
          load: loadAvailabilityConfig,
        }),
      reconcile: (api, bundleId, config) =>
        reconcileAvailability(api, { bundleId, config, dryRun: true }),
    }),
};
