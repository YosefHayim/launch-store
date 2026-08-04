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

export type SkippedApp = {
  app: AppDescriptor;
  reason: string;
};

export type DetectedApp = {
  target: AdoptTarget;
  signal: string;
};

export type Detection = {
  detected: DetectedApp[];
  skipped: SkippedApp[];
};

export type DetectContext = {
  keyId: string;
  cwd: string;
  hasLaunchConfig: boolean;
};

export type AdopterError = {
  domain: string;
  message: string;
};

export type TargetPlan = {
  detected: DetectedApp;
  writes: PlannedWrite[];
  errors: AdopterError[];
};

/** Render the latest version and build-count signal for one detected app. */
const describeSignal = (version: string | null, buildCount: number): string => {
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
  apps: AppDescriptor[],
  detectionContext: DetectContext,
): Effect.Effect<Detection, unknown> =>
  Effect.gen(function* () {
    const appDetections = yield* Effect.forEach(
      apps,
      (app): Effect.Effect<AppDetection, unknown> =>
        Effect.gen(function* () {
          if (app.bundleId === undefined) {
            return {
              _tag: 'Skipped',
              skippedApp: { app, reason: 'no iOS bundle id' },
            };
          }
          const appId = yield* appleCatalog.getAppId(app.bundleId);
          if (appId === null) {
            return {
              _tag: 'Skipped',
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
              signal: describeSignal(version, buildCount),
            },
          };
        }),
      { concurrency: 'unbounded' },
    );
    const detected: DetectedApp[] = [];
    const skipped: SkippedApp[] = [];
    for (const appDetection of appDetections) {
      if (appDetection._tag === 'Detected') detected.push(appDetection.detectedApp);
      else skipped.push(appDetection.skippedApp);
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
  adopters: Adopter<Requirements>[],
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

export type ApplyContext<Requirements = never> = {
  cwd: string;
  hasLaunchConfig: boolean;
  appRoot: string | null;
  pullListing: (bundleId: string, configPath: string) => Effect.Effect<void, unknown, Requirements>;
};

export type AdoptApplyResult = {
  configWritten?: string;
  configBlock?: string;
  appJsonPatched: {
    app: string;
    configPath: string;
    added: string[];
  }[];
  appJsonBlocks: {
    app: string;
    configPath: string;
    block: string;
  }[];
  listingsPulled: string[];
  listingErrors: {
    app: string;
    message: string;
  }[];
};

/** Collect imported product pieces into a bundle-keyed catalog. */
const collectProducts = (plans: TargetPlan[]): Record<string, AppProducts> => {
  const productsByBundleId: Record<string, AppProducts> = {};
  for (const targetPlan of plans) {
    const productPieces: ProductPiece[] = [];
    for (const plannedWrite of targetPlan.writes) {
      if (plannedWrite.change.home === 'launch.config')
        productPieces.push(plannedWrite.change.piece);
    }
    if (productPieces.length > 0) {
      productsByBundleId[targetPlan.detected.target.bundleId] =
        aggregateProductPieces(productPieces);
    }
  }
  return productsByBundleId;
};

/** Apply a confirmed adoption plan to local configuration and delegated listing pulls. */
export const applyAdopt = <Requirements>(
  plans: TargetPlan[],
  applyContext: ApplyContext<Requirements>,
): Effect.Effect<AdoptApplyResult, unknown, FileSystem.FileSystem | Path.Path | Requirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const adoptionSummary: AdoptApplyResult = {
      appJsonPatched: [],
      appJsonBlocks: [],
      listingsPulled: [],
      listingErrors: [],
    };
    const productsByBundleId = collectProducts(plans);
    if (Object.keys(productsByBundleId).length > 0) {
      if (applyContext.hasLaunchConfig) {
        adoptionSummary.configBlock = serializeProductsSection(productsByBundleId);
      } else {
        const configPath = pathService.join(applyContext.cwd, 'launch.config.ts');
        yield* fileSystem.writeFileString(
          configPath,
          buildAdoptedConfig(applyContext.appRoot, productsByBundleId),
        );
        adoptionSummary.configWritten = configPath;
      }
    }
    for (const targetPlan of plans) {
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
          adoptionSummary.appJsonPatched.push({
            app: app.name,
            configPath: app.configPath,
            added: addedEntitlements,
          });
        }
        continue;
      }
      adoptionSummary.appJsonBlocks.push({
        app: app.name,
        configPath: app.configPath,
        block: renderEntitlementsBlock(entitlements),
      });
    }
    for (const targetPlan of plans) {
      for (const plannedWrite of targetPlan.writes) {
        if (plannedWrite.change.home !== 'store.config') continue;
        const listingPull = yield* applyContext
          .pullListing(plannedWrite.change.bundleId, plannedWrite.change.configPath)
          .pipe(Effect.either);
        if (listingPull._tag === 'Right') {
          adoptionSummary.listingsPulled.push(plannedWrite.change.appName);
          continue;
        }
        adoptionSummary.listingErrors.push({
          app: plannedWrite.change.appName,
          message: errorMessage(listingPull.left),
        });
      }
    }
    return adoptionSummary;
  });
