// Plans the listing pull that prints one App Store Connect listing for launch.config.ts.

import { join } from 'node:path';
import type { AdoptCatalogApi, AdoptTarget, Adopter, PlannedWrite } from '../types/adopt.ts';

export class ListingAdoption implements Adopter {
  readonly domain = 'listing';

  readonly fidelity = 'importable' as const;

  async read(_appleCatalog: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]> {
    const configPath = join(target.app.dir, 'launch.config.ts');

    return [
      {
        description: `listing: print the App Store copy for ${target.app.name} so it can be added under listing in launch.config.ts`,
        fidelity: 'importable',
        change: {
          home: 'listing',
          bundleId: target.bundleId,
          configPath,
          appName: target.app.name,
        },
      },
    ];
  }
}
