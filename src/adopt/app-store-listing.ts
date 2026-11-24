// Plans the listing pull that prints one App Store Connect listing for launch.config.ts.

import { join } from 'node:path';
import type { Adopter } from '../types/adopt.ts';

/** Plan the listing pull for one adopted app. */
export const listingAdopter: Adopter = {
  domain: 'listing',
  fidelity: 'importable',
  async read(_appleCatalog, target) {
    const configPath = join(target.app.dir, 'launch.config.ts');

    return [
      {
        description: `listing: print the App Store copy for ${target.app.name} so it can be added under listing in launch.config.ts`,
        fidelity: 'importable' as const,
        change: {
          home: 'listing' as const,
          bundleId: target.bundleId,
          configPath,
          appName: target.app.name,
        },
      },
    ];
  },
};
