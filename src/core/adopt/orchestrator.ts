import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { writeAppEntitlements } from '../config/config.js';
import { errorMessage } from '../services/errorMessage.js';
import type {
  AdoptCatalogApi,
  AdoptTarget,
  Adopter,
  EntitlementValue,
  PlannedWrite,
  ProductPiece,
} from '../types/adopt.js';
import type { AppDescriptor } from '../types/app.js';
import type { AppProducts } from '../types/catalog.js';
import {
  aggregateProductPieces,
  buildAdoptedConfig,
  renderEntitlementsBlock,
  serializeProductsSection,
} from './configWriter.js';

export type SkippedApp = Readonly<{
  app: AppDescriptor;
  reason: string;
}>;

export type DetectedApp = Readonly<{
  target: AdoptTarget;
  signal: string;
}>;

export type Detection = Readonly<{
  detected: readonly DetectedApp[];
  skipped: readonly SkippedApp[];
}>;

export type DetectContext = Readonly<{
  keyId: string;
  cwd: string;
  hasLaunchConfig: boolean;
}>;

export type AdopterError = Readonly<{
  domain: string;
  message: string;
}>;

export type TargetPlan = Readonly<{
  detected: DetectedApp;
  writes: readonly PlannedWrite[];
  errors: readonly AdopterError[];
}>;

/** Confirming live-version / build-count signal for one detected app. */
export const describeAdoptSignal = (version: string | null, buildCount: number): string => {
  const signalParts: string[] = [];
  if (version !== null) signalParts.push(`v${version} live`);
  if (buildCount > 0) {
    let buildLabel = 'builds';
    if (buildCount === 1) buildLabel = 'build';
    signalParts.push(`${buildCount} ${buildLabel}`);
  }
  if (signalParts.length === 0) return 'registered, no builds yet';
  return signalParts.join(' - ');
};

type AppDetection =
  | Readonly<{ readonly _tag: 'Detected'; readonly detectedApp: DetectedApp }>
  | Readonly<{ readonly _tag: 'Skipped'; readonly skippedApp: SkippedApp }>;

/** Resolve discovered apps against App Store Connect. */
export const detectTargets = (
  appleCatalog: AdoptCatalogApi,
  apps: readonly AppDescriptor[],
  detectionContext: DetectContext,
): Effect.Effect<Detection, unknown> =>
  Effect.gen(function* () {
    const appDetections = yield* Effect.forEach(
      apps,
      (app): Effect.Effect<AppDetection, unknown> =>
        Effect.gen(function* () {
          if (app.bundleId === undefined) {
            return {
              _tag: 'Skipped' as const,
              skippedApp: { app, reason: 'no iOS bundle id' },
            };
          }
          const appId = yield* appleCatalog.getAppId(app.bundleId);
          if (appId === null) {
            return {
              _tag: 'Skipped' as const,
              skippedApp: {
                app,
                reason: 'no App Store Connect record (create the app once in App Store Connect)',
              },
            };
          }
          const [version, buildCount] = yield* Effect.all(
            [
              appleCatalog
                .getLatestMarketingVersion(app.bundleId)
                .pipe(Effect.catchAll(() => Effect.succeed(null))),
              appleCatalog
                .getLatestBuildNumber(app.bundleId)
                .pipe(Effect.catchAll(() => Effect.succeed(0))),
            ],
            { concurrency: 'unbounded' },
          );
          return {
            _tag: 'Detected' as const,
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
        }),
      { concurrency: 'unbounded' },
    );
    const detected: DetectedApp[] = [];
    const skipped: SkippedApp[] = [];
    for (const appDetection of appDetections) {
      if (appDetection._tag === 'Detected') {
        detected.push(appDetection.detectedApp);
        continue;
      }
      skipped.push(appDetection.skippedApp);
    }
    detected.sort((firstApp, secondApp) =>
      firstApp.target.bundleId.localeCompare(secondApp.target.bundleId),
    );
    skipped.sort((firstApp, secondApp) => firstApp.app.name.localeCompare(secondApp.app.name));
    return { detected, skipped };
  });

/** Run adopters in registry order while isolating each domain failure. */
export const planTargets = <Requirements>(
  appleCatalog: AdoptCatalogApi,
  detection: Detection,
  adopters: readonly Adopter<Requirements>[],
): Effect.Effect<TargetPlan[], never, Requirements> =>
  Effect.forEach(
    detection.detected,
    (detectedApp) =>
      Effect.gen(function* () {
        const plannedWrites: PlannedWrite[] = [];
        const adopterErrors: AdopterError[] = [];
        for (const adopter of adopters) {
          const adoptionAttempt = yield* adopter
            .read(appleCatalog, detectedApp.target)
            .pipe(Effect.either);
          if (adoptionAttempt._tag === 'Right') {
            plannedWrites.push(...adoptionAttempt.right);
            continue;
          }
          adopterErrors.push({
            domain: adopter.domain,
            message: errorMessage(adoptionAttempt.left),
          });
        }
        return { detected: detectedApp, writes: plannedWrites, errors: adopterErrors };
      }),
    { concurrency: 'unbounded' },
  );

export type ApplyContext<Requirements = never> = Readonly<{
  cwd: string;
  hasLaunchConfig: boolean;
  appRoot: string | null;
  pullListing: (bundleId: string, configPath: string) => Effect.Effect<void, unknown, Requirements>;
}>;

export type AppJsonPatch = Readonly<{
  app: string;
  configPath: string;
  added: readonly string[];
}>;

export type AppJsonPasteBlock = Readonly<{
  app: string;
  configPath: string;
  block: string;
}>;

export type ListingError = Readonly<{
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
export const collectAdoptedProducts = (
  targetPlans: readonly TargetPlan[],
): Record<string, AppProducts> => {
  const productsByBundleId: Record<string, AppProducts> = {};
  for (const targetPlan of targetPlans) {
    const productPieces: ProductPiece[] = [];
    for (const plannedWrite of targetPlan.writes) {
      if (plannedWrite.change.home === 'launch.config')
        productPieces.push(plannedWrite.change.piece);
    }
    if (productPieces.length === 0) continue;
    productsByBundleId[targetPlan.detected.target.bundleId] = aggregateProductPieces(productPieces);
  }
  return productsByBundleId;
};

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
const applyProductCatalog = (
  productsByBundleId: Record<string, AppProducts>,
  applyContext: Readonly<{
    cwd: string;
    hasLaunchConfig: boolean;
    appRoot: string | null;
  }>,
): Effect.Effect<ProductCatalogOutcome, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (Object.keys(productsByBundleId).length === 0) return {};
    if (applyContext.hasLaunchConfig) {
      return { configBlock: serializeProductsSection(productsByBundleId) };
    }
    const pathService = yield* Path.Path;
    const fileSystem = yield* FileSystem.FileSystem;
    const configPath = pathService.join(applyContext.cwd, 'launch.config.ts');
    yield* fileSystem.writeFileString(
      configPath,
      buildAdoptedConfig(applyContext.appRoot, productsByBundleId),
    );
    return { configWritten: configPath };
  });

/** Patch static app.json entitlements or emit paste blocks for dynamic configs. */
const applyEntitlementWrites = (
  targetPlans: readonly TargetPlan[],
): Effect.Effect<EntitlementWriteOutcome, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const appJsonPatched: AppJsonPatch[] = [];
    const appJsonBlocks: AppJsonPasteBlock[] = [];
    for (const targetPlan of targetPlans) {
      const app = targetPlan.detected.target.app;
      const entitlements: Record<string, EntitlementValue> = {};
      for (const plannedWrite of targetPlan.writes) {
        if (plannedWrite.change.home === 'app.json') {
          entitlements[plannedWrite.change.key] = plannedWrite.change.value;
        }
      }
      if (Object.keys(entitlements).length === 0) continue;
      if (app.configPath.endsWith('.json')) {
        const addedEntitlements = yield* writeAppEntitlements(app, entitlements);
        if (addedEntitlements.length > 0) {
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
  });

/** Delegate store.config listing pulls and capture per-app failures. */
const applyListingPulls = <Requirements>(
  targetPlans: readonly TargetPlan[],
  pullListing: (bundleId: string, configPath: string) => Effect.Effect<void, unknown, Requirements>,
): Effect.Effect<ListingPullOutcome, never, Requirements> =>
  Effect.gen(function* () {
    const listingsPulled: string[] = [];
    const listingErrors: ListingError[] = [];
    for (const targetPlan of targetPlans) {
      for (const plannedWrite of targetPlan.writes) {
        if (plannedWrite.change.home !== 'store.config') continue;
        const listingPull = yield* pullListing(
          plannedWrite.change.bundleId,
          plannedWrite.change.configPath,
        ).pipe(Effect.either);
        if (listingPull._tag === 'Right') {
          listingsPulled.push(plannedWrite.change.appName);
          continue;
        }
        listingErrors.push({
          app: plannedWrite.change.appName,
          message: errorMessage(listingPull.left),
        });
      }
    }
    return { listingsPulled, listingErrors };
  });

/** Apply a confirmed adoption plan to local configuration and delegated listing pulls. */
export const applyAdopt = <Requirements>(
  targetPlans: readonly TargetPlan[],
  applyContext: ApplyContext<Requirements>,
): Effect.Effect<AdoptApplyResult, unknown, FileSystem.FileSystem | Path.Path | Requirements> =>
  Effect.gen(function* () {
    const productsByBundleId = collectAdoptedProducts(targetPlans);
    const productOutcome = yield* applyProductCatalog(productsByBundleId, {
      cwd: applyContext.cwd,
      hasLaunchConfig: applyContext.hasLaunchConfig,
      appRoot: applyContext.appRoot,
    });
    const entitlementOutcome = yield* applyEntitlementWrites(targetPlans);
    const listingOutcome = yield* applyListingPulls(targetPlans, applyContext.pullListing);
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
    if (productOutcome.configWritten !== undefined)
      adoptionSummary.configWritten = productOutcome.configWritten;
    if (productOutcome.configBlock !== undefined)
      adoptionSummary.configBlock = productOutcome.configBlock;
    return adoptionSummary;
  });
