import { resolveSidecarConfig } from '../../config/config.ts';
import {
  loadAccessibilityConfig,
  reconcileAccessibility,
} from '../../store/apple/accessibility.ts';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '../../types/plan.ts';
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
        if (configPath == null) configPath = 'accessibility.config.json';
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
