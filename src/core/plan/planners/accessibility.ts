import { resolveSidecarConfig } from '@core/config/config.js';
import { loadAccessibilityConfig, reconcileAccessibility } from '@core/store/accessibility.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan accessibility`. */
const SURFACE = 'accessibility';
export const accessibilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: () => {
        let configPath = planContext.config.configFiles?.accessibility;
        if (configPath === undefined) configPath = 'accessibility.config.json';
        return resolveSidecarConfig({
          typed: undefined,
          configPath,
          explicitPath: false,
          load: loadAccessibilityConfig,
        });
      },
      reconcile: (api, bundleId, config) =>
        reconcileAccessibility(api, { bundleId, config, dryRun: true }),
    }),
};
