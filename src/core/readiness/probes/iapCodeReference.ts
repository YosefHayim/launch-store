import { FileSystem } from '@effect/platform';
import { Effect } from 'effect';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '@core/types/readiness.js';
import { type SourceScanRequirements, walkAppSource } from '../sourceScan.js';
import { declaredAppleProductIds } from './iapReadiness.js';
const SCANNABLE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.swift',
  '.m',
  '.mm',
  '.h',
  '.kt',
  '.java',
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/** Find declared product identifiers in a bounded app-source scan. */
const findReferencedIds = (
  appDirectory: string,
  productIds: string[],
): Effect.Effect<Set<string>, never, SourceScanRequirements> => {
  const referencedIds = new Set<string>();
  const pendingIds = new Set(productIds);
  let bytesScanned = 0;
  return walkAppSource(appDirectory, (filePath, fileExtension) =>
    Effect.gen(function* () {
      if (!SCANNABLE_EXTENSIONS.has(fileExtension)) return false;
      const fileSystem = yield* FileSystem.FileSystem;
      const fileMetadata = yield* fileSystem
        .stat(filePath)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      if (fileMetadata === undefined) return false;
      const fileBytes = Number(fileMetadata.size);
      if (fileBytes > MAX_FILE_BYTES) return false;
      if (bytesScanned + fileBytes > MAX_SCAN_BYTES) return true;
      const sourceText = yield* fileSystem
        .readFileString(filePath)
        .pipe(Effect.catchAll(() => Effect.succeed('')));
      bytesScanned += fileBytes;
      for (const productId of pendingIds) {
        if (sourceText.includes(productId)) {
          referencedIds.add(productId);
          pendingIds.delete(productId);
        }
      }
      return pendingIds.size === 0;
    }),
  ).pipe(Effect.as(referencedIds));
};

/** Check whether declared App Store products appear in local app source. */
export const iapCodeReferenceProbe = {
  id: 'apple-iap-code-reference',
  title: 'Product ids referenced in app code',
  store: 'appstore',
  categories: ['iap'],
  /**
   * Verify that declared Apple product ids appear in each app's source.
   *
   * @param readinessContext - Loaded config and selected apps for the readiness run.
   * @returns An Effect that succeeds with one source-reference finding per in-scope app.
   */
  check(
    readinessContext: ReadinessContext,
  ): Effect.Effect<ProbeResult, never, SourceScanRequirements> {
    return Effect.gen(function* () {
      const scopedApps: {
        name: string;
        identifier: string;
        directory: string;
        productIds: string[];
      }[] = [];
      for (const configuredApp of readinessContext.apps) {
        if (configuredApp.bundleId === undefined) continue;
        const productIds = declaredAppleProductIds(
          readinessContext.config.products?.[configuredApp.bundleId],
        );
        if (productIds.length === 0) continue;
        scopedApps.push({
          name: configuredApp.name,
          identifier: configuredApp.bundleId,
          directory: configuredApp.dir,
          productIds,
        });
      }
      if (scopedApps.length === 0) return { state: 'omitted' };
      const appFindings = yield* Effect.forEach(
        scopedApps,
        ({
          name,
          identifier,
          directory,
          productIds,
        }): Effect.Effect<AppReadiness, never, SourceScanRequirements> =>
          Effect.gen(function* () {
            const referencedIds = yield* findReferencedIds(directory, productIds);
            const missingIds = productIds.filter((productId) => !referencedIds.has(productId));
            if (missingIds.length === 0) {
              let productLabel = 'product ids';
              if (productIds.length === 1) productLabel = 'product id';
              return {
                app: name,
                identifier,
                status: 'ok',
                detail: `all ${productIds.length} declared ${productLabel} referenced in source`,
              };
            }
            let productLabel = 'product ids';
            if (missingIds.length === 1) productLabel = 'product id';
            return {
              app: name,
              identifier,
              status: 'warn',
              detail: `${missingIds.length} declared ${productLabel} not found in source: ${missingIds.join(', ')}`,
              hint: 'check for a typo or an orphaned product in launch.config.ts (native/generated dirs are skipped)',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: appFindings };
    });
  },
} satisfies ReadinessProbe;
