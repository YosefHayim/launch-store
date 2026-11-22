import { parseReleaseConfig, reconcileReleasePlan } from '../../release/releaseAttrs.ts';
import { resolveStoreSurfaceSection } from '../../cli/commands/store/apple/appStoreSurfaceCommand.ts';
import { planAppStoreSurface } from './appStoreSurface.ts';
import type { SurfacePlanner } from '../../types/plan.ts';
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
