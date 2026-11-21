import { resolveSidecarConfig } from '@/config/config.js';
import {
  loadEuDistributionConfig,
  reconcileEuDistributionDomains,
} from '@/store/apple/euDistribution.js';
import { planTeamSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@/types/plan.js';
import type { EuDistributionConfig } from '@/types/storeSurface.js';
/** Surface id - also the value users pass as `launch plan eu-distribution`. */
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
