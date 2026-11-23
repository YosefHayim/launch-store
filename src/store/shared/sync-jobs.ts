// Selects apps and gathers the App Store Connect work each one should sync.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@/path-exists.js';
import type { AppDescriptor } from '@/types/app.js';
import type { AppProducts } from '@/types/catalog.js';
import type { LaunchConfig } from '@/types/config.js';
import {
  readCapabilitiesFromEntitlements,
  type CapabilityType,
} from '@/credentials/capabilities.js';
import {
  discoverPreviews,
  discoverScreenshots,
  type LocalPreview,
  type LocalScreenshot,
} from '@/listing/screenshots/assets.js';
import { parseStoreConfig, type AppleStoreConfig, type AppleLocaleInfo } from './store-config.ts';

/** One app's reconcile work: the resolved capabilities + products plus any entitlements we couldn't map. */
export type SyncJob = {
  app: AppDescriptor;
  bundleId: string;
  capabilities: CapabilityType[];
  products: AppProducts;
  listing?: AppleStoreConfig;
  screenshots: LocalScreenshot[];
  previews: LocalPreview[];
  subscriptionReviewScreenshots: {
    productId: string;
    relPath: string;
  }[];
  unmapped: string[];
};

/** Read an app's `store.config.json` `apple` listing, or undefined when absent. */
async function loadListing(appDirectory: string): Promise<AppleStoreConfig | undefined> {
  try {
    const configPath = join(appDirectory, 'store.config.json');
    const configExists = await pathExists(configPath);

    if (configExists == false) {
      return undefined;
    }

    const configText = await readFile(configPath, 'utf8');
    const rawDocument: unknown = JSON.parse(configText);
    const storeConfig = parseStoreConfig(rawDocument);

    return storeConfig.apple;
  } catch {
    return undefined;
  }
}

function localeHasFields(localeListing: AppleLocaleInfo): boolean {
  return Object.keys(localeListing).length > 0;
}

/** Whether a listing carries at least one locale with at least one field worth reconciling. */
export function hasListing(listing: AppleStoreConfig | undefined): listing is AppleStoreConfig {
  if (listing == null) {
    return false;
  }

  return Object.values(listing.info).some(localeHasFields);
}

/** The subscriptions that declare a review screenshot, paired with the relative path to upload. */
function collectSubscriptionReviewScreenshots(products: AppProducts): {
  productId: string;
  relPath: string;
}[] {
  const reviewScreenshots: { productId: string; relPath: string }[] = [];
  const subscriptionGroups = products.subscriptionGroups;

  if (subscriptionGroups == null) {
    return reviewScreenshots;
  }

  for (const subscriptionGroup of subscriptionGroups) {
    for (const subscription of subscriptionGroup.subscriptions) {
      if (subscription.reviewScreenshot == null) {
        continue;
      }

      reviewScreenshots.push({
        productId: subscription.productId,
        relPath: subscription.reviewScreenshot,
      });
    }
  }

  return reviewScreenshots;
}

/** An app selector named a discovered app that does not exist. */
export type AppSelectionFailure = Readonly<{
  readonly _tag: 'AppSelectionFailure';
  readonly appName: string;
  readonly discoveredApps: readonly string[];
  readonly message: string;
}>;

function makeAppSelectionFailure(fields: {
  appName: string;
  discoveredApps: readonly string[];
  message: string;
}): AppSelectionFailure {
  return { _tag: 'AppSelectionFailure', ...fields };
}

function trimName(name: string): string {
  return name.trim();
}

function isNamed(name: string): boolean {
  return name.length > 0;
}

/** Resolve discovered apps from an optional comma-separated selector. */
export async function selectApps(
  apps: readonly AppDescriptor[],
  selector: string | undefined,
): Promise<readonly AppDescriptor[]> {
  if (selector == null) {
    return apps;
  }

  if (selector == '') {
    return apps;
  }

  const selectedNames = selector.split(',').map(trimName).filter(isNamed);
  const discoveredByName = new Map(
    apps.map(function appByName(app: AppDescriptor) {
      return [app.name, app] as const;
    }),
  );
  const discoveredNames = apps.map(function appNameOf(app: AppDescriptor) {
    return app.name;
  });
  const selectedApps: AppDescriptor[] = [];

  for (const selectedName of selectedNames) {
    const selectedApp = discoveredByName.get(selectedName);

    if (selectedApp != null) {
      selectedApps.push(selectedApp);
      continue;
    }

    let discoveredAppList = discoveredNames.join(', ');

    if (discoveredAppList.length == 0) {
      discoveredAppList = 'none';
    }

    throw makeAppSelectionFailure({
      appName: selectedName,
      discoveredApps: discoveredNames,
      message: `Unknown app "${selectedName}". Discovered apps: ${discoveredAppList}.`,
    });
  }

  return selectedApps;
}

function hasSyncWork(
  capabilityCount: number,
  productCount: number,
  listing: AppleStoreConfig | undefined,
  hasAssets: boolean,
): boolean {
  if (capabilityCount > 0) {
    return true;
  }

  if (productCount > 0) {
    return true;
  }

  if (hasListing(listing)) {
    return true;
  }

  return hasAssets;
}

/** Build the job list, dropping apps with no iOS bundle id and nothing to sync. */
export async function buildJobs(
  apps: readonly AppDescriptor[],
  config: LaunchConfig,
): Promise<SyncJob[]> {
  const jobs: SyncJob[] = [];

  for (const app of apps) {
    if (app.bundleId == null) {
      continue;
    }

    const isBlankBundle = app.bundleId == '';

    if (isBlankBundle) {
      continue;
    }

    const { enable, unmapped } = readCapabilitiesFromEntitlements(app.iosEntitlements);
    let products: AppProducts = {};
    const configuredProducts = config.products?.[app.bundleId];

    if (configuredProducts != null) {
      products = configuredProducts;
    }

    let productCount = 0;

    if (products.inAppPurchases != null) {
      productCount += products.inAppPurchases.length;
    }

    if (products.subscriptionGroups != null) {
      productCount += products.subscriptionGroups.length;
    }

    const listing = await loadListing(app.dir);
    const screenshots = [...(await discoverScreenshots(app.dir))];
    const previews = [...(await discoverPreviews(app.dir))];
    const subscriptionReviewScreenshots = collectSubscriptionReviewScreenshots(products);
    let hasAssets = screenshots.length > 0;

    if (hasAssets == false) {
      hasAssets = previews.length > 0;
    }

    if (hasAssets == false) {
      hasAssets = subscriptionReviewScreenshots.length > 0;
    }

    const shouldSync = hasSyncWork(enable.length, productCount, listing, hasAssets);

    if (shouldSync == false) {
      continue;
    }

    const syncJob: SyncJob = {
      app,
      bundleId: app.bundleId,
      capabilities: enable,
      products,
      screenshots,
      previews,
      subscriptionReviewScreenshots,
      unmapped,
    };

    if (listing != null) {
      syncJob.listing = listing;
    }

    jobs.push(syncJob);
  }

  return jobs;
}
