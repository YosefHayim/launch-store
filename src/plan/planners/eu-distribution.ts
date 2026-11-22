import { resolveSidecarConfig } from '../../config/config.ts';
import {
  loadEuDistributionConfig,
  reconcileEuDistributionDomains,
} from '../../store/apple/eu-distribution.ts';
import { planTeamSurface } from './app-store-surface.ts';
import type { SurfacePlanner } from '../../types/plan.ts';
import type { EuDistributionConfig } from '../../types/store-surface.ts';
/** Surface id - also the value users pass as `launch-store plan eu-distribution`. */
const SURFACE = 'eu-distribution';
export const euDistributionPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planTeamSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      config: () =>
        resolveSidecarConfig<EuDistributionConfig>({
          typed: planContext.config.euDistribution,
          configPath: 'eu-distribution.config.json',
          explicitPath: false,
          load: loadEuDistributionConfig,
        }),
      reconcile: (api, config) => reconcileEuDistributionDomains(api, config, true),
    }),
};
