import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import type { AppDescriptor } from '../types/app.js';
import type { AppProducts } from '../types/catalog.js';
import type { LaunchConfig } from '../types/config.js';
import { mapEntitlementsToCapabilities, type CapabilityType } from '../credentials/capabilities.js';
import {
  discoverPreviews,
  discoverScreenshots,
  type LocalPreview,
  type LocalScreenshot,
} from '../listing/screenshots/assets.js';
import { parseStoreConfig, type AppleStoreConfig } from './storeConfig.js';
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
/**
 * Read an app's `store.config.json` `apple` listing, or undefined when absent. A malformed file is
 * swallowed here (returns undefined) so a broken listing never blocks product/capability sync - the
 * dedicated `launch metadata` command is where it's loudly validated.
 */
const loadListing = (appDirectory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const configPath = pathService.join(appDirectory, 'store.config.json');
    const configExists = yield* fileSystem.exists(configPath);
    if (!configExists) return undefined;
    const configText = yield* fileSystem.readFileString(configPath);
    const rawDocument = yield* Schema.decodeUnknown(Schema.parseJson())(configText);
    const storeConfig = yield* parseStoreConfig(rawDocument);
    return storeConfig.apple;
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
/**
 * Whether a listing carries at least one locale with at least one field worth reconciling. A type guard,
 * so callers that filter on it (`launch plan`'s listing surface) narrow `listing` to a present
 * {@link AppleStoreConfig} without an assertion.
 */
export const hasListing = (listing: AppleStoreConfig | undefined): listing is AppleStoreConfig => {
  return (
    listing !== undefined &&
    Object.values(listing.info).some((localeListing) => Object.keys(localeListing).length > 0)
  );
};
/** The subscriptions that declare a review screenshot, paired with the relative path to upload. */
const collectSubscriptionReviewScreenshots = (
  products: AppProducts,
): {
  productId: string;
  relPath: string;
}[] => {
  const reviewScreenshots: { productId: string; relPath: string }[] = [];
  const subscriptionGroups = products.subscriptionGroups;
  if (subscriptionGroups === undefined) return reviewScreenshots;
  for (const subscriptionGroup of subscriptionGroups) {
    for (const subscription of subscriptionGroup.subscriptions) {
      if (subscription.reviewScreenshot === undefined) continue;
      reviewScreenshots.push({
        productId: subscription.productId,
        relPath: subscription.reviewScreenshot,
      });
    }
  }
  return reviewScreenshots;
};
/** An app selector named a discovered app that does not exist. */
export type AppSelectionFailure = Readonly<{
  readonly _tag: 'AppSelectionFailure';
  readonly appName: string;
  readonly discoveredApps: readonly string[];
  readonly message: string;
}>;

export const makeAppSelectionFailure = Data.tagged<AppSelectionFailure>('AppSelectionFailure');

/** Resolve discovered apps from an optional comma-separated selector. */
export const selectApps = (
  apps: AppDescriptor[],
  selector: string | undefined,
): Effect.Effect<AppDescriptor[], AppSelectionFailure> => {
  if (selector === undefined) return Effect.succeed(apps);
  if (selector === '') return Effect.succeed(apps);
  const selectedNames = selector
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const discoveredByName = new Map(apps.map((app) => [app.name, app]));
  const discoveredNames = apps.map((app) => app.name);
  return Effect.forEach(selectedNames, (selectedName) => {
    const selectedApp = discoveredByName.get(selectedName);
    if (selectedApp !== undefined) return Effect.succeed(selectedApp);
    let discoveredAppList = discoveredNames.join(', ');
    if (discoveredAppList.length === 0) discoveredAppList = 'none';
    return Effect.fail(
      makeAppSelectionFailure({
        appName: selectedName,
        discoveredApps: discoveredNames,
        message: `Unknown app "${selectedName}". Discovered apps: ${discoveredAppList}.`,
      }),
    );
  });
};
/** Build the job list, dropping apps with no iOS bundle id and nothing (capabilities, products, listing, or assets) to sync. */
export const buildJobs = (apps: AppDescriptor[], config: LaunchConfig) =>
  Effect.gen(function* () {
    const jobs: SyncJob[] = [];
    for (const app of apps) {
      if (!app.bundleId) continue;
      const { enable, unmapped } = mapEntitlementsToCapabilities(app.iosEntitlements);
      let products: AppProducts = {};
      const configuredProducts = config.products?.[app.bundleId];
      if (configuredProducts !== undefined) products = configuredProducts;
      let productCount = 0;
      if (products.inAppPurchases !== undefined) {
        productCount += products.inAppPurchases.length;
      }
      if (products.subscriptionGroups !== undefined) {
        productCount += products.subscriptionGroups.length;
      }
      const listing = yield* loadListing(app.dir);
      const screenshots = [...(yield* discoverScreenshots(app.dir))];
      const previews = [...(yield* discoverPreviews(app.dir))];
      const subscriptionReviewScreenshots = collectSubscriptionReviewScreenshots(products);
      let hasAssets = screenshots.length > 0;
      if (!hasAssets) hasAssets = previews.length > 0;
      if (!hasAssets) hasAssets = subscriptionReviewScreenshots.length > 0;
      if (enable.length === 0 && productCount === 0 && !hasListing(listing) && !hasAssets) continue;
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
      if (listing !== undefined) syncJob.listing = listing;
      jobs.push(syncJob);
    }
    return jobs;
  });
