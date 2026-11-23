// Compares App Store Connect accessibility declarations with the local config.

import { resolveSidecarConfig } from '@/config/config.js';
import { loadAccessibilityConfig, reconcileAccessibility } from '@/store/apple/accessibility.js';
import { planAppStoreSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '@/types/plan.js';
/** Surface id - also the value users pass as `launch-store plan accessibility`. */
const SURFACE = 'accessibility';
export const accessibilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor() {
        let configPath = planContext.config.configFiles?.accessibility;

        if (configPath == null) configPath = 'accessibility.config.json';

        return resolveSidecarConfig({
          typed: undefined,
          configPath,
          explicitPath: false,
          load: loadAccessibilityConfig,
        });
      },
      reconcile(api, bundleId, config) {
        return reconcileAccessibility(api, { bundleId, config, dryRun: true });
      },
    });
  },
};
