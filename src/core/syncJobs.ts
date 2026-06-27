/**
 * Build the per-app reconcile work list shared by `launch sync` and `launch plan`.
 *
 * `sync` and the catalog plan/drift surface both answer the same first question — "given the discovered
 * apps and `launch.config.ts`, what does each app declare for App Store Connect?" — before they diverge
 * (sync applies, plan only reports). That shared question is {@link buildJobs}: it resolves each app's
 * capabilities (from `app.json` entitlements), product catalog (from `config.products[bundleId]`), store
 * listing (from `store.config.json`), and on-disk screenshot/preview assets into one {@link SyncJob}.
 * Extracted here (rather than left private in `cli/commands/sync.ts`) so `core/plan` can reuse it without
 * a `core → cli` import — the command layer depends on core, never the reverse.
 *
 * Read-only: building a job reads the filesystem and config but never touches App Store Connect.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDescriptor, AppProducts, LaunchConfig } from './types.js';
import { mapEntitlementsToCapabilities, type CapabilityType } from './capabilities.js';
import {
  discoverPreviews,
  discoverScreenshots,
  type LocalPreview,
  type LocalScreenshot,
} from './screenshotAssets.js';
import { loadStoreConfig, type AppleStoreConfig } from './storeConfig.js';

/** One app's reconcile work: the resolved capabilities + products plus any entitlements we couldn't map. */
export interface SyncJob {
  app: AppDescriptor;
  bundleId: string;
  capabilities: CapabilityType[];
  products: AppProducts;
  /** The app's `store.config.json` `apple` listing, when present — reconciled natively into ASC. */
  listing?: AppleStoreConfig;
  /** App Store screenshots discovered under `<appDir>/screenshots/<locale>/<displayType>/`, fingerprinted. */
  screenshots: LocalScreenshot[];
  /** App preview videos discovered under `<appDir>/previews/<locale>/<previewType>/`, fingerprinted. */
  previews: LocalPreview[];
  /** Subscriptions declaring a `reviewScreenshot`, paired with the path fingerprinted at apply time. */
  subscriptionReviewScreenshots: { productId: string; relPath: string }[];
  /** Entitlement keys with no known capability mapping — surfaced as a warning, not an error. */
  unmapped: string[];
}

/**
 * Read an app's `store.config.json` `apple` listing, or undefined when absent. A malformed file is
 * swallowed here (returns undefined) so a broken listing never blocks product/capability sync — the
 * dedicated `launch metadata` command is where it's loudly validated.
 */
function loadListing(appDir: string): AppleStoreConfig | undefined {
  const path = join(appDir, 'store.config.json');
  if (!existsSync(path)) return undefined;
  try {
    return loadStoreConfig(path).apple;
  } catch {
    return undefined;
  }
}

/**
 * Whether a listing carries at least one locale with at least one field worth reconciling. A type guard,
 * so callers that filter on it (`launch plan`'s listing surface) narrow `listing` to a present
 * {@link AppleStoreConfig} without an assertion.
 */
export function hasListing(listing: AppleStoreConfig | undefined): listing is AppleStoreConfig {
  return (
    listing !== undefined &&
    Object.values(listing.info).some((info) => Object.keys(info).length > 0)
  );
}

/** The subscriptions that declare a review screenshot, paired with the relative path to upload. */
function collectSubscriptionReviewScreenshots(
  products: AppProducts,
): { productId: string; relPath: string }[] {
  return (products.subscriptionGroups ?? [])
    .flatMap((group) => group.subscriptions)
    .flatMap((sub) =>
      sub.reviewScreenshot ? [{ productId: sub.productId, relPath: sub.reviewScreenshot }] : [],
    );
}

/** Resolve the apps to act on from discovery + the optional `--app` selector, erroring on an unknown name. */
export function selectApps(apps: AppDescriptor[], selector: string | undefined): AppDescriptor[] {
  if (!selector) return apps;
  const wanted = selector
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const byName = new Map(apps.map((app) => [app.name, app]));
  return wanted.map((name) => {
    const app = byName.get(name);
    if (!app)
      throw new Error(
        `Unknown app "${name}". Discovered apps: ${apps.map((a) => a.name).join(', ') || 'none'}.`,
      );
    return app;
  });
}

/** Build the job list, dropping apps with no iOS bundle id and nothing (capabilities, products, listing, or assets) to sync. */
export function buildJobs(apps: AppDescriptor[], config: LaunchConfig): SyncJob[] {
  const jobs: SyncJob[] = [];
  for (const app of apps) {
    if (!app.bundleId) continue;
    const { enable, unmapped } = mapEntitlementsToCapabilities(app.iosEntitlements);
    const products = config.products?.[app.bundleId] ?? {};
    const productCount =
      (products.inAppPurchases?.length ?? 0) + (products.subscriptionGroups?.length ?? 0);
    const listing = loadListing(app.dir);
    const screenshots = discoverScreenshots(app.dir);
    const previews = discoverPreviews(app.dir);
    const subscriptionReviewScreenshots = collectSubscriptionReviewScreenshots(products);
    const hasAssets =
      screenshots.length > 0 || previews.length > 0 || subscriptionReviewScreenshots.length > 0;
    if (enable.length === 0 && productCount === 0 && !hasListing(listing) && !hasAssets) continue;
    jobs.push({
      app,
      bundleId: app.bundleId,
      capabilities: enable,
      products,
      ...(listing ? { listing } : {}),
      screenshots,
      previews,
      subscriptionReviewScreenshots,
      unmapped,
    });
  }
  return jobs;
}
