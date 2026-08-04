import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import { readAvailabilityConfig, reconcileAvailability } from '@core/store/availability.js';
import { planAppStoreSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '@core/types/plan.js';
/** Surface id - also the value users pass as `launch plan availability`. */
const SURFACE = 'availability';
export const availabilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (planContext) =>
    planAppStoreSurface(planContext, {
      surface: SURFACE,
      direction: 'two-way',
      configFor: () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          let configPath = planContext.config.configFiles?.availability;
          if (configPath === undefined) configPath = 'availability.config.json';
          if (!(yield* fileSystem.exists(configPath))) return undefined;
          return yield* readAvailabilityConfig(configPath);
        }),
      reconcile: (api, bundleId, config) =>
        reconcileAvailability(api, { bundleId, config, dryRun: true }),
    }),
};
