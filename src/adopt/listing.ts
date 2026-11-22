import { join } from 'node:path';
import type { Adopter } from '../types/adopt.ts';

/** Plan the store.config listing pull for one adopted app. */
export const listingAdopter: Adopter = {
  domain: 'listing',
  fidelity: 'importable',
  async read(_appleCatalog, target) {
    const configPath = join(target.app.dir, 'store.config.json');

    return [
      {
        description: `listing: pull App Store copy into ${target.app.name}/store.config.json (from App Store Connect)`,
        fidelity: 'importable' as const,
        change: {
          home: 'store.config' as const,
          bundleId: target.bundleId,
          configPath,
          appName: target.app.name,
        },
      },
    ];
  },
};
