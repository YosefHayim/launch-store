import { parseReleaseConfig, reconcileReleasePlan } from '@core/release/releaseAttrs.js';
import { resolveStoreSurfaceSection } from '@core/store/appStoreSurfaceCommand.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan release-config`. */
const SURFACE = 'release-config';
export const releaseConfigPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: (bundleId) =>
        resolveStoreSurfaceSection(
          planContext.config.releaseAttributes?.[bundleId],
          'release.config.json',
          false,
          parseReleaseConfig,
        ),
      reconcile: (api, bundleId, config) =>
        reconcileReleasePlan(api, { bundleId, config, dryRun: true }),
    }),
};
