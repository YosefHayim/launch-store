/**
 * The App Store **app-clips** plan surface: an app's declared App Clip cards (default experience + card
 * copy). Wraps `launch app-clips`'s reconciler ({@link reconcileAppClips}) in dry-run, reading desired
 * state from the typed `appClips[bundleId]` section or the `appclips.config.json` sidecar (via the shared
 * {@link resolveSidecarConfig}). Additive: the reconciler only creates declared cards it can't find, so a
 * `= in sync` result means "config is fully applied," not that no extra cards exist in the portal.
 */

import { resolveSidecarConfig } from '../../config.js';
import { loadAppClipsConfig, reconcileAppClips } from '../../appClips.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '../../types.js';

/** Surface id — also the value users pass as `launch plan app-clips`. */
const SURFACE = 'app-clips';

export const appClipsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: 'additive',
      configFor: (bundleId) =>
        resolveSidecarConfig({
          typed: ctx.config.appClips?.[bundleId],
          configPath: 'appclips.config.json',
          explicitPath: false,
          load: loadAppClipsConfig,
        }),
      reconcile: (api, bundleId, config) =>
        reconcileAppClips(api, { bundleId, config, dryRun: true }),
    }),
};
