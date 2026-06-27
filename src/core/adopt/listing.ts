/**
 * The **listing** adopter (importable tier): import an app's App Store listing copy (name, subtitle,
 * description, keywords, what's-new, URLs) into `store.config.json`.
 *
 * Pure delegation — Launch already pulls this exact data with `launch metadata pull` (fastlane
 * `deliver download_metadata`), so this adopter adds no new download logic. It plans one write per app;
 * the orchestrator applies it by invoking the injected metadata-pull delegate (the CLI command supplies
 * the real one, keeping `core` free of the fastlane/cli wiring). The target `store.config.json` is the
 * same file `launch metadata` and `launch sync`'s listing reconciler read, so the loop closes cleanly.
 */

import { join } from 'node:path';
import type { Adopter, AdoptCatalogApi, AdoptTarget, PlannedWrite } from './types.js';

/** Plan the single `store.config.json` listing-pull write for an app (applied via the metadata-pull delegate). */
export const listingAdopter: Adopter = {
  domain: 'listing',
  fidelity: 'importable',
  read(_asc: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]> {
    const configPath = join(target.app.dir, 'store.config.json');
    return Promise.resolve([
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
    ]);
  },
};
