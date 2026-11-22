import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAppEntitlements } from '../config/config.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';
import type {
  AdoptCatalogApi,
  AdoptTarget,
  Adopter,
  EntitlementValue,
  PlannedWrite,
  ProductPiece,
} from '../types/adopt.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { AppProducts } from '../types/catalog.ts';
import {
  aggregateProductPieces,
  buildAdoptedConfig,
  renderEntitlementsBlock,
  serializeProductsSection,
} from './configWriter.ts';

type SkippedApp = Readonly<{
  app: AppDescriptor;
  reason: string;
}>;

type DetectedApp = Readonly<{
  target: AdoptTarget;
  signal: string;
}>;

type Detection = Readonly<{
  detected: readonly DetectedApp[];
  skipped: readonly SkippedApp[];
}>;

type DetectContext = Readonly<{
  keyId: string;
  cwd: string;
  hasLaunchConfig: boolean;
}>;

type AdopterError = Readonly<{
  domain: string;
  message: string;
}>;

export type TargetPlan = Readonly<{
  detected: DetectedApp;
  writes: readonly PlannedWrite[];
  errors: readonly AdopterError[];
}>;

/** Confirming live-version / build-count signal for one detected app. */
export function describeAdoptSignal(version: string | null, buildCount: number): string {
  const signalParts: string[] = [];

  if (version != null) {
    signalParts.push(`v${version} live`);
  }

  if (buildCount > 0) {
    let buildLabel = 'builds';

    if (buildCount == 1) {
      buildLabel = 'build';
    }

    signalParts.push(`${buildCount} ${buildLabel}`);
  }

  const hasNoSignal = signalParts.length == 0;

  if (hasNoSignal) {
    return 'registered, no builds yet';
  }

  return signalParts.join(' - ');
}

type AppDetection =
  | Readonly<{ readonly _tag: 'Detected'; readonly detectedApp: DetectedApp }>
  | Readonly<{ readonly _tag: 'Skipped'; readonly skippedApp: SkippedApp }>;

function byBundleId(firstApp: DetectedApp, secondApp: DetectedApp): number {
  return firstApp.target.bundleId.localeCompare(secondApp.target.bundleId);
}

function byAppName(firstApp: SkippedApp, secondApp: SkippedApp): number {
  return firstApp.app.name.localeCompare(secondApp.app.name);
}

/** Resolve discovered apps against App Store Connect. */
export async function detectTargets(
  appleCatalog: AdoptCatalogApi,
  apps: readonly AppDescriptor[],
  detectionContext: DetectContext,
): Promise<Detection> {
  async function readVersion(bundleId: string): Promise<string | null> {
    try {
      return await appleCatalog.getLatestMarketingVersion(bundleId);
    } catch {
      return null;
    }
  }

  async function readBuildCount(bundleId: string): Promise<number> {
    try {
      return await appleCatalog.getLatestBuildNumber(bundleId);
    } catch {
      return 0;
    }
  }

  async function detectApp(app: AppDescriptor): Promise<AppDetection> {
    if (app.bundleId == null) {
      return {
        _tag: 'Skipped',
        skippedApp: { app, reason: 'no iOS bundle id' },
      };
    }

    const appId = await appleCatalog.getAppId(app.bundleId);

    if (appId == null) {
      return {
        _tag: 'Skipped',
        skippedApp: {
          app,
          reason: 'no App Store Connect record (create the app once in App Store Connect)',
        },
      };
    }

    const versionPromise = readVersion(app.bundleId);
    const buildCountPromise = readBuildCount(app.bundleId);
    const version = await versionPromise;
    const buildCount = await buildCountPromise;

    return {
      _tag: 'Detected',
      detectedApp: {
        target: {
          app,
          appId,
          bundleId: app.bundleId,
          keyId: detectionContext.keyId,
          cwd: detectionContext.cwd,
          hasLaunchConfig: detectionContext.hasLaunchConfig,
        },
        signal: describeAdoptSignal(version, buildCount),
      },
    };
  }

  const appDetections = await Promise.all(apps.map(detectApp));
  const detected: DetectedApp[] = [];
  const skipped: SkippedApp[] = [];

  for (const appDetection of appDetections) {
    if (appDetection._tag == 'Detected') {
      detected.push(appDetection.detectedApp);
      continue;
    }

    skipped.push(appDetection.skippedApp);
  }

  detected.sort(byBundleId);
  skipped.sort(byAppName);

  return { detected, skipped };
}

/** Run adopters in registry order while isolating each domain failure. */
export async function planTargets(
  appleCatalog: AdoptCatalogApi,
  detection: Detection,
  adopters: readonly Adopter[],
): Promise<TargetPlan[]> {
  async function planDetectedApp(detectedApp: DetectedApp): Promise<TargetPlan> {
    const plannedWrites: PlannedWrite[] = [];
    const adopterErrors: AdopterError[] = [];

    for (const adopter of adopters) {
      try {
        const adopterWrites = await adopter.read(appleCatalog, detectedApp.target);
        plannedWrites.push(...adopterWrites);
      } catch (cause) {
        adopterErrors.push({
          domain: adopter.domain,
          message: errorMessage(cause),
        });
      }
    }

    return { detected: detectedApp, writes: plannedWrites, errors: adopterErrors };
  }

  return Promise.all(detection.detected.map(planDetectedApp));
}

export type ApplyContext = Readonly<{
  cwd: string;
  hasLaunchConfig: boolean;
  appRoot: string | null;
  pullListing: (bundleId: string, configPath: string) => Promise<void>;
}>;

type AppJsonPatch = Readonly<{
  app: string;
  configPath: string;
  added: readonly string[];
}>;

type AppJsonPasteBlock = Readonly<{
  app: string;
  configPath: string;
  block: string;
}>;

type ListingError = Readonly<{
  app: string;
  message: string;
}>;

export type AdoptApplyResult = Readonly<{
  configWritten?: string;
  configBlock?: string;
  appJsonPatched: readonly AppJsonPatch[];
  appJsonBlocks: readonly AppJsonPasteBlock[];
  listingsPulled: readonly string[];
  listingErrors: readonly ListingError[];
}>;

/** Collect imported product pieces into a bundle-keyed catalog. */
export function collectAdoptedProducts(
  targetPlans: readonly TargetPlan[],
): Record<string, AppProducts> {
  const productsByBundleId: Record<string, AppProducts> = {};

  for (const targetPlan of targetPlans) {
    const productPieces: ProductPiece[] = [];

    for (const plannedWrite of targetPlan.writes) {
      if (plannedWrite.change.home == 'launch.config') {
        productPieces.push(plannedWrite.change.piece);
      }
    }

    const hasNoPieces = productPieces.length == 0;

    if (hasNoPieces) {
      continue;
    }

    productsByBundleId[targetPlan.detected.target.bundleId] = aggregateProductPieces(productPieces);
  }

  return productsByBundleId;
}

type ProductCatalogOutcome = Readonly<{
  configWritten?: string;
  configBlock?: string;
}>;

type EntitlementWriteOutcome = Readonly<{
  appJsonPatched: readonly AppJsonPatch[];
  appJsonBlocks: readonly AppJsonPasteBlock[];
}>;

type ListingPullOutcome = Readonly<{
  listingsPulled: readonly string[];
  listingErrors: readonly ListingError[];
}>;

/** Write or print the adopted products section for launch.config.ts. */
async function applyProductCatalog(
  productsByBundleId: Record<string, AppProducts>,
  applyContext: Readonly<{
    cwd: string;
    hasLaunchConfig: boolean;
    appRoot: string | null;
  }>,
): Promise<ProductCatalogOutcome> {
  const hasNoProducts = Object.keys(productsByBundleId).length == 0;

  if (hasNoProducts) {
    return {};
  }

  if (applyContext.hasLaunchConfig) {
    return { configBlock: serializeProductsSection(productsByBundleId) };
  }

  const configPath = join(applyContext.cwd, 'launch.config.ts');
  await writeFile(configPath, buildAdoptedConfig(applyContext.appRoot, productsByBundleId));

  return { configWritten: configPath };
}

/** Patch static app.json entitlements or emit paste blocks for dynamic configs. */
async function applyEntitlementWrites(
  targetPlans: readonly TargetPlan[],
): Promise<EntitlementWriteOutcome> {
  const appJsonPatched: AppJsonPatch[] = [];
  const appJsonBlocks: AppJsonPasteBlock[] = [];

  for (const targetPlan of targetPlans) {
    const app = targetPlan.detected.target.app;
    const entitlements: Record<string, EntitlementValue> = {};

    for (const plannedWrite of targetPlan.writes) {
      if (plannedWrite.change.home == 'app.json') {
        entitlements[plannedWrite.change.key] = plannedWrite.change.value;
      }
    }

    const hasNoEntitlements = Object.keys(entitlements).length == 0;

    if (hasNoEntitlements) {
      continue;
    }

    const isStaticConfig = app.configPath.endsWith('.json');

    if (isStaticConfig) {
      const addedEntitlements = await writeAppEntitlements(app, entitlements);
      const addedEntitlementCount = addedEntitlements.length;

      if (addedEntitlementCount > 0) {
        appJsonPatched.push({
          app: app.name,
          configPath: app.configPath,
          added: addedEntitlements,
        });
      }

      continue;
    }

    appJsonBlocks.push({
      app: app.name,
      configPath: app.configPath,
      block: renderEntitlementsBlock(entitlements),
    });
  }

  return { appJsonPatched, appJsonBlocks };
}

/** Delegate store.config listing pulls and capture per-app failures. */
async function applyListingPulls(
  targetPlans: readonly TargetPlan[],
  pullListing: (bundleId: string, configPath: string) => Promise<void>,
): Promise<ListingPullOutcome> {
  const listingsPulled: string[] = [];
  const listingErrors: ListingError[] = [];

  for (const targetPlan of targetPlans) {
    for (const plannedWrite of targetPlan.writes) {
      if (plannedWrite.change.home != 'store.config') {
        continue;
      }

      try {
        await pullListing(plannedWrite.change.bundleId, plannedWrite.change.configPath);
        listingsPulled.push(plannedWrite.change.appName);
      } catch (cause) {
        listingErrors.push({
          app: plannedWrite.change.appName,
          message: errorMessage(cause),
        });
      }
    }
  }

  return { listingsPulled, listingErrors };
}

/** Apply a confirmed adoption plan to local configuration and delegated listing pulls. */
export async function applyAdopt(
  targetPlans: readonly TargetPlan[],
  applyContext: ApplyContext,
): Promise<AdoptApplyResult> {
  const productsByBundleId = collectAdoptedProducts(targetPlans);
  const productOutcome = await applyProductCatalog(productsByBundleId, {
    cwd: applyContext.cwd,
    hasLaunchConfig: applyContext.hasLaunchConfig,
    appRoot: applyContext.appRoot,
  });
  const entitlementOutcome = await applyEntitlementWrites(targetPlans);
  const listingOutcome = await applyListingPulls(targetPlans, applyContext.pullListing);
  const adoptionSummary: {
    configWritten?: string;
    configBlock?: string;
    appJsonPatched: readonly AppJsonPatch[];
    appJsonBlocks: readonly AppJsonPasteBlock[];
    listingsPulled: readonly string[];
    listingErrors: readonly ListingError[];
  } = {
    appJsonPatched: entitlementOutcome.appJsonPatched,
    appJsonBlocks: entitlementOutcome.appJsonBlocks,
    listingsPulled: listingOutcome.listingsPulled,
    listingErrors: listingOutcome.listingErrors,
  };

  if (productOutcome.configWritten != null) {
    adoptionSummary.configWritten = productOutcome.configWritten;
  }

  if (productOutcome.configBlock != null) {
    adoptionSummary.configBlock = productOutcome.configBlock;
  }

  return adoptionSummary;
}
