import { resolveSidecarConfig } from '@core/config/config.js';
import {
  loadCustomProductPagesConfig,
  reconcileCustomProductPages,
} from '@core/store/customProductPages.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan custom-pages`. */
const SURFACE = 'custom-pages';
export const customPagesPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: () => {
        let configPath = planContext.config.configFiles?.customPages;
        if (configPath === undefined) configPath = 'custom-pages.config.json';
        return resolveSidecarConfig({
          typed: undefined,
          configPath,
          explicitPath: false,
          load: loadCustomProductPagesConfig,
        });
      },
      reconcile: (api, bundleId, config) =>
        reconcileCustomProductPages(api, { bundleId, config, dryRun: true }),
    }),
};
