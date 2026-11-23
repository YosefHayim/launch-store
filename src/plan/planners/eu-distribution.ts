// Compares App Store Connect European Union distribution domains with local config.

import { reconcileEuDistributionDomains } from '@/apple/store/eu-distribution.js';
import { planTeamSurface } from './app-store-surface.ts';
import type { EuDistributionConfig } from '@/types/store-surface.js';
import type { AscSurfacesApi, SurfacePlanner } from '@/types/plan.js';

/** Surface id - also the value users pass as `launch-store plan eu-distribution`. */
const SURFACE = 'eu-distribution';

export const euDistributionPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan(planContext) {
    function readEuDistributionSection(): EuDistributionConfig | undefined {
      return planContext.config.euDistribution;
    }

    function reconcileEuDistributionSection(
      api: AscSurfacesApi,
      euDistributionSection: EuDistributionConfig,
    ) {
      return reconcileEuDistributionDomains(api, euDistributionSection, true);
    }

    return planTeamSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      config: readEuDistributionSection,
      reconcile: reconcileEuDistributionSection,
    });
  },
};
