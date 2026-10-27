import { Effect } from 'effect';
import {
  discoverTreatmentScreenshots,
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
      configFor: () =>
        Effect.gen(function* () {
          let configPath = 'experiments.config.json';
          if (planContext.config.configFiles?.experiments !== undefined) {
            configPath = planContext.config.configFiles.experiments;
          }
          const experimentsConfig = yield* resolveStoreSurfaceSection(
            undefined,
            configPath,
            false,
            parseVersionExperimentsConfig,
          );
          if (experimentsConfig === undefined) return undefined;
          const treatmentScreenshots = yield* discoverTreatmentScreenshots(
            configPath,
            experimentsConfig,
          );
          return { experimentsConfig, treatmentScreenshots };
        }),
      reconcile: (api, bundleId, experimentsTarget) =>
        reconcileVersionExperiments(api, {
          bundleId,
          config: experimentsTarget.experimentsConfig,
          treatmentScreenshots: experimentsTarget.treatmentScreenshots,
          submit: false,
          start: false,
          dryRun: true,
        }),
    }),
};
