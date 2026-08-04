import {
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
} from '@core/release/versionExperiments.js';
import { resolveStoreSurfaceSection } from '@core/store/appStoreSurfaceCommand.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan experiments`. */
const SURFACE = 'experiments';
export const experimentsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: () => {
        let configPath = 'experiments.config.json';
        if (planContext.config.configFiles?.experiments !== undefined) {
          configPath = planContext.config.configFiles.experiments;
        }
        return resolveStoreSurfaceSection(
          undefined,
          configPath,
          false,
          parseVersionExperimentsConfig,
        );
      },
      reconcile: (api, bundleId, config) =>
        reconcileVersionExperiments(api, { bundleId, config, dryRun: true }),
    }),
};
