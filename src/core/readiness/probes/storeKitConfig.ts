/**
 * Probe: when an app declares IAPs/subscriptions, is there a StoreKit configuration file (`*.storekit`) in
 * the project? That file is what lets you exercise purchases on the simulator/local builds before anything
 * is live on App Store Connect — without it, the only way to test buying is a sandbox round-trip, so a
 * declared catalog with no `.storekit` is the "we never actually ran a purchase locally" gap. Purely local
 * (no credentials, never skips) and advisory (`warn`): testing this way is strongly recommended, not a
 * submission blocker. The lookup is the same bounded, read-only walk the code-reference probe uses. Tag `iap`.
 */

import { relative } from 'node:path';
import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from '../../types.js';
import { walkAppSource } from '../sourceScan.js';
import { declaredAppleProductIds } from './iapReadiness.js';

/** The first `.storekit` configuration file under `appDir` (as a path relative to it), or null when none. */
function findStoreKitConfig(appDir: string): string | null {
  let match: string | null = null;
  walkAppSource(appDir, (filePath, ext) => {
    if (ext !== '.storekit') return false;
    match = relative(appDir, filePath);
    return true;
  });
  return match;
}

/** The App Store Connect "StoreKit config file present for local testing" probe (local file scan). */
export const storeKitConfigProbe: ReadinessProbe = {
  id: 'apple-storekit-config',
  title: 'StoreKit config file present',
  store: 'appstore',
  categories: ['iap'],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = ctx.apps.flatMap((app) => {
      const bundleId = app.bundleId;
      if (!bundleId) return [];
      const declaresProducts = declaredAppleProductIds(ctx.config.products?.[bundleId]).length > 0;
      return declaresProducts ? [{ name: app.name, identifier: bundleId, dir: app.dir }] : [];
    });
    if (apps.length === 0) return { state: 'omitted' };

    const results: AppReadiness[] = apps.map(({ name, identifier, dir }) => {
      const file = findStoreKitConfig(dir);
      if (file) {
        return { app: name, identifier, status: 'ok', detail: `StoreKit config present (${file})` };
      }
      return {
        app: name,
        identifier,
        status: 'warn',
        detail: 'no .storekit configuration file found',
        hint: 'add a StoreKit configuration file in Xcode to test purchases on the simulator before submitting',
      };
    });
    return { state: 'checked', apps: results };
  },
};
