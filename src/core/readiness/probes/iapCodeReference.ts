/**
 * Probe: does every IAP/subscription product id declared in `launch.config.ts` actually appear somewhere in
 * the app's own source? A declared id the app never references is almost always a typo or an orphan left
 * behind after a rename — the product exists on App Store Connect but no `Purchases.purchaseProduct("…")`
 * call can ever reach it, so it silently never sells. This is the one IAP check that reads the *app code*
 * rather than the store, so it's purely local (no credentials, never skips) and advisory (`warn`, not a hard
 * blocker — the scan deliberately skips native/generated trees, so a miss is "couldn't find it", not "proven
 * absent"). The scan is bounded and read-only and never executes anything (see {@link walkAppSource}). Tag `iap`.
 */

import { readFileSync, statSync } from 'node:fs';
import { Effect } from 'effect';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { walkAppSource } from '../sourceScan.js';
import { declaredAppleProductIds } from './iapReadiness.js';

/** Extensions a product id can realistically be referenced from: JS/TS, native sources, and config/JSON. */
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

/** Skip an individual file larger than this (minified bundles, lockfiles) — they won't hold a hand-typed id. */
const MAX_FILE_BYTES = 512 * 1024;
/** Stop scanning contents once this many bytes have been read — the budget that actually bounds the work. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/**
 * Which of `productIds` appear as a literal substring in the app's source under `appDir`. Reads only
 * scannable text files within the per-file and total byte budgets and stops as soon as every id is found.
 *
 * @param appDir - App source root to scan.
 * @param productIds - Declared Apple product ids that should appear in source.
 * @returns An Effect that succeeds with the subset of ids found in source text.
 */
function findReferencedIds(appDir: string, productIds: string[]): Effect.Effect<Set<string>> {
  const found = new Set<string>();
  const pending = new Set(productIds);
  let bytesScanned = 0;

  return walkAppSource(appDir, (filePath, ext) =>
    Effect.gen(function* () {
      if (!SCANNABLE_EXTENSIONS.has(ext)) return false;
      const size = yield* Effect.try({
        try: () => statSync(filePath).size,
        catch: (statFailure) => statFailure,
      }).pipe(Effect.catchAll(() => Effect.succeed(0)));
      if (size > MAX_FILE_BYTES) return false;
      if (bytesScanned + size > MAX_SCAN_BYTES) return true; // byte budget exhausted — stop the walk
      const text = yield* Effect.try({
        try: () => readFileSync(filePath, 'utf8'),
        catch: (readFailure) => readFailure,
      }).pipe(Effect.catchAll(() => Effect.succeed('')));
      bytesScanned += size;
      for (const id of pending) {
        if (text.includes(id)) {
          found.add(id);
          pending.delete(id);
        }
      }
      return pending.size === 0; // every declared id accounted for — no need to keep walking
    }),
  ).pipe(Effect.as(found));
}

/** The App Store Connect "declared product ids are referenced in app code" probe (local source scan). */
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
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult> {
    return Effect.gen(function* () {
      const apps = readinessContext.apps.flatMap((app) => {
        const bundleId = app.bundleId;
        if (!bundleId) return [];
        const productIds = declaredAppleProductIds(readinessContext.config.products?.[bundleId]);
        return productIds.length > 0
          ? [{ name: app.name, identifier: bundleId, dir: app.dir, productIds }]
          : [];
      });
      if (apps.length === 0) return { state: 'omitted' };

      const results: AppReadiness[] = yield* Effect.forEach(
        apps,
        ({ name, identifier, dir, productIds }) =>
          Effect.gen(function* () {
            const referenced = yield* findReferencedIds(dir, productIds);
            const orphaned = productIds.filter((productId) => !referenced.has(productId));
            if (orphaned.length === 0) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: `all ${productIds.length} declared product id${productIds.length === 1 ? '' : 's'} referenced in source`,
              };
            }
            return {
              app: name,
              identifier,
              status: 'warn' as const,
              detail: `${orphaned.length} declared product id${orphaned.length === 1 ? '' : 's'} not found in source: ${orphaned.join(', ')}`,
              hint: 'check for a typo or an orphaned product in launch.config.ts (native/generated dirs are skipped)',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
