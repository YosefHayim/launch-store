import { resolveSidecarConfig } from '@core/config/config.js';
import { loadAppClipsConfig, reconcileAppClips } from '@core/store/appClips.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan app-clips`. */
const SURFACE = 'app-clips';
export const appClipsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: (bundleId) =>
        resolveSidecarConfig({
          typed: planContext.config.appClips?.[bundleId],
          configPath: 'appclips.config.json',
          explicitPath: false,
          load: loadAppClipsConfig,
        }),
      reconcile: (api, bundleId, config) =>
        reconcileAppClips(api, { bundleId, config, dryRun: true }),
    }),
};
