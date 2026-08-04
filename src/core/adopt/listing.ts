import { Path } from '@effect/platform';
import { Effect } from 'effect';
import type { Adopter } from '../types/adopt.js';

/** Plan the store.config listing pull for one adopted app. */
export const listingAdopter: Adopter<Path.Path> = {
  domain: 'listing',
  fidelity: 'importable',
  read: (_appleCatalog, target) =>
    Effect.gen(function* () {
      const pathService = yield* Path.Path;
      const configPath = pathService.join(target.app.dir, 'store.config.json');
      return [
        {
          description: `listing: pull App Store copy into ${target.app.name}/store.config.json (via metadata pull)`,
          fidelity: 'importable',
          change: {
            home: 'store.config',
            bundleId: target.bundleId,
            configPath,
            appName: target.app.name,
          },
        },
      ];
    }),
};
