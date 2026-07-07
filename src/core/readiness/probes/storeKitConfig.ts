/**
 * Probe: when an app declares IAPs/subscriptions, is there a StoreKit configuration file (`*.storekit`) in
 * the project? That file is what lets you exercise purchases on the simulator/local builds before anything
 * is live on App Store Connect — without it, the only way to test buying is a sandbox round-trip, so a
 * declared catalog with no `.storekit` is the "we never actually ran a purchase locally" gap. Purely local
 * (no credentials, never skips) and advisory (`warn`): testing this way is strongly recommended, not a
 * submission blocker. The lookup is the same bounded, read-only walk the code-reference probe uses. Tag `iap`.
 */

import { relative } from 'node:path';
import { Effect } from 'effect';
import type {
  AppReadiness,
  ProbeResult,
  ReadinessContext,
  ReadinessProbe,
} from '../../types/index.js';
import { walkAppSource } from '../sourceScan.js';
import { declaredAppleProductIds } from './iapReadiness.js';

/**
 * Find the first `.storekit` configuration file under an app root.
 *
 * @param appDir - App source root to scan.
 * @returns An Effect that succeeds with the first relative `.storekit` path, or null when none exists.
 */
function findStoreKitConfig(appDir: string): Effect.Effect<string | null> {
  let match: string | null = null;
  return walkAppSource(appDir, (filePath, ext) =>
    Effect.sync(() => {
      if (ext !== '.storekit') return false;
      match = relative(appDir, filePath);
      return true;
    }),
  ).pipe(Effect.map(() => match));
}

/** The App Store Connect "StoreKit config file present for local testing" probe (local file scan). */
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
  check(readinessContext: ReadinessContext): Effect.Effect<ProbeResult> {
    return Effect.gen(function* () {
      const apps = readinessContext.apps.flatMap((app) => {
        const bundleId = app.bundleId;
        if (!bundleId) return [];
        const declaresProducts =
          declaredAppleProductIds(readinessContext.config.products?.[bundleId]).length > 0;
        return declaresProducts ? [{ name: app.name, identifier: bundleId, dir: app.dir }] : [];
      });
      if (apps.length === 0) return { state: 'omitted' };

      const results: AppReadiness[] = yield* Effect.forEach(
        apps,
        ({ name, identifier, dir }) =>
          Effect.gen(function* () {
            const file = yield* findStoreKitConfig(dir);
            if (file) {
              return {
                app: name,
                identifier,
                status: 'ok' as const,
                detail: `StoreKit config present (${file})`,
              };
            }
            return {
              app: name,
              identifier,
              status: 'warn' as const,
              detail: 'no .storekit configuration file found',
              hint: 'add a StoreKit configuration file in Xcode to test purchases on the simulator before submitting',
            };
          }),
        { concurrency: 'unbounded' },
      );
      return { state: 'checked', apps: results };
    });
  },
} satisfies ReadinessProbe;
