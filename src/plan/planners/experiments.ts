import {
  discoverTreatmentScreenshots,
  parseVersionExperimentsConfig,
  reconcileVersionExperiments,
} from '@/release/versionExperiments.js';
import { resolveStoreSurfaceSection } from '@/store/apple/appStoreSurfaceCommand.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@/types/plan.js';

const SURFACE = 'experiments';

export const experimentsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  async plan(planContext) {
    async function readExperimentsConfig() {
      let configPath = 'experiments.config.json';
      const configuredPath = planContext.config.configFiles?.experiments;

      if (configuredPath != null) {
        configPath = configuredPath;
      }

      const experimentsConfig = await resolveStoreSurfaceSection(
        undefined,
        configPath,
        false,
        parseVersionExperimentsConfig,
      );
      const isUndeclared = experimentsConfig == null;

      if (isUndeclared) {
        return undefined;
      }

      const treatmentScreenshots = await discoverTreatmentScreenshots(
        configPath,
        experimentsConfig,
      );

      return { experimentsConfig, treatmentScreenshots };
    }

    function reconcileExperiments(
      api: Parameters<typeof reconcileVersionExperiments>[0],
      bundleId: string,
      experimentsTarget: {
        experimentsConfig: Parameters<typeof reconcileVersionExperiments>[1]['config'];
        treatmentScreenshots: Parameters<
          typeof reconcileVersionExperiments
        >[1]['treatmentScreenshots'];
      },
    ) {
      return reconcileVersionExperiments(api, {
        bundleId,
        config: experimentsTarget.experimentsConfig,
        treatmentScreenshots: experimentsTarget.treatmentScreenshots,
        submit: false,
        start: false,
        dryRun: true,
      });
    }

    return planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'additive',
      configFor: readExperimentsConfig,
      reconcile: reconcileExperiments,
    });
  },
};
