import { Path } from '@effect/platform';
import { Effect } from 'effect';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { type SourceScanRequirements, walkAppSource } from '../sourceScan.js';
import { declaredAppleProductIds } from './iapReadiness.js';
import { OMITTED_PROBE } from './credentialsSkip.js';
/** Return the first StoreKit configuration path found under an app directory. */
const findStoreKitConfig = (
  appDirectory: string,
): Effect.Effect<string | null, never, SourceScanRequirements> => {
  return Effect.gen(function* () {
    const pathService = yield* Path.Path;
    let matchedConfigPath: string | null = null;
    yield* walkAppSource(appDirectory, (filePath, fileExtension) =>
      Effect.sync(() => {
        if (fileExtension !== '.storekit') return false;
        matchedConfigPath = pathService.relative(appDirectory, filePath);
        return true;
      }),
    );
    return matchedConfigPath;
  });
};

/** Check that product-selling iOS apps include a StoreKit test configuration. */
export const storeKitConfigProbe = {
  id: 'apple-storekit-config',
  title: 'StoreKit config file present',
  store: 'appstore',
  categories: ['iap'],
  /**
   * Verify that each product-selling iOS app has a local StoreKit config file.
   *
   * @param readinessContext - Loaded config and selected apps for the readiness run.
   * @returns An Effect that succeeds with one StoreKit-config finding per in-scope app.
   */
  check(
    readinessContext: ReadinessContext,
  ): Effect.Effect<ProbeResult, never, SourceScanRequirements> {
    return Effect.gen(function* () {
      const scopedApps: { name: string; identifier: string; directory: string }[] = [];
      for (const configuredApp of readinessContext.apps) {
        if (configuredApp.bundleId === undefined) continue;
        const declaresProducts =
          declaredAppleProductIds(readinessContext.config.products?.[configuredApp.bundleId])
            .length > 0;
        if (!declaresProducts) continue;
        scopedApps.push({
          name: configuredApp.name,
          identifier: configuredApp.bundleId,
          directory: configuredApp.dir,
        });
      }
      if (scopedApps.length === 0) return OMITTED_PROBE;
      const appFindings = yield* Effect.forEach(
        scopedApps,
        ({
          name,
          identifier,
          directory,
        }): Effect.Effect<AppReadiness, never, SourceScanRequirements> =>
          Effect.gen(function* () {
            const configPath = yield* findStoreKitConfig(directory);
            if (configPath !== null) {
              return {
                app: name,
                identifier,
                status: 'ok',
                detail: `StoreKit config present (${configPath})`,
              };
            }
            return {
              app: name,
              identifier,
              status: 'warn',
              detail: 'no .storekit configuration file found',
              hint: 'add a StoreKit configuration file in Xcode to test purchases on the simulator before submitting',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: appFindings };
    });
  },
} satisfies ReadinessProbe;
