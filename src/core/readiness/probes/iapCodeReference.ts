/**
 * Probe: does every IAP/subscription product id declared in `launch.config.ts` actually appear somewhere in
 * the app's own source? A declared id the app never references is almost always a typo or an orphan left
 * behind after a rename — the product exists on App Store Connect but no `Purchases.purchaseProduct("…")`
 * call can ever reach it, so it silently never sells. This is the one IAP check that reads the *app code*
 * rather than the store, so it's purely local (no credentials, never skips) and advisory (`warn`, not a hard
 * blocker — the scan deliberately skips native/generated trees, so a miss is "couldn't find it", not "proven
 * absent"). The scan is bounded and read-only and never executes anything (see {@link walkAppSource}). Tag `iap`.
 */

import { readFileSync, statSync } from "node:fs";
import type { AppReadiness, ProbeResult, ReadinessContext, ReadinessProbe } from "../types.js";
import { walkAppSource } from "../sourceScan.js";
import { declaredAppleProductIds } from "./iapReadiness.js";

/** Extensions a product id can realistically be referenced from: JS/TS, native sources, and config/JSON. */
const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".json",
  ".swift",
  ".m",
  ".mm",
  ".h",
  ".kt",
  ".java",
]);

/** Skip an individual file larger than this (minified bundles, lockfiles) — they won't hold a hand-typed id. */
const MAX_FILE_BYTES = 512 * 1024;
/** Stop scanning contents once this many bytes have been read — the budget that actually bounds the work. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/**
 * Which of `productIds` appear as a literal substring in the app's source under `appDir`. Reads only
 * scannable text files within the per-file and total byte budgets and stops as soon as every id is found.
 */
function findReferencedIds(appDir: string, productIds: string[]): Set<string> {
  const found = new Set<string>();
  const pending = new Set(productIds);
  let bytesScanned = 0;

  walkAppSource(appDir, (filePath, ext) => {
    if (!SCANNABLE_EXTENSIONS.has(ext)) return false;
    let size: number;
    try {
      size = statSync(filePath).size;
    } catch {
      return false;
    }
    if (size > MAX_FILE_BYTES) return false;
    if (bytesScanned + size > MAX_SCAN_BYTES) return true; // byte budget exhausted — stop the walk
    let text: string;
    try {
      text = readFileSync(filePath, "utf8");
    } catch {
      return false;
    }
    bytesScanned += size;
    for (const id of pending) {
      if (text.includes(id)) {
        found.add(id);
        pending.delete(id);
      }
    }
    return pending.size === 0; // every declared id accounted for — no need to keep walking
  });

  return found;
}

/** The App Store Connect "declared product ids are referenced in app code" probe (local source scan). */
export const iapCodeReferenceProbe: ReadinessProbe = {
  id: "apple-iap-code-reference",
  title: "Product ids referenced in app code",
  store: "appstore",
  categories: ["iap"],
  async check(ctx: ReadinessContext): Promise<ProbeResult> {
    const apps = ctx.apps.flatMap((app) => {
      const bundleId = app.bundleId;
      if (!bundleId) return [];
      const ids = declaredAppleProductIds(ctx.config.products?.[bundleId]);
      return ids.length > 0 ? [{ name: app.name, identifier: bundleId, dir: app.dir, ids }] : [];
    });
    if (apps.length === 0) return { state: "omitted" };

    const results: AppReadiness[] = apps.map(({ name, identifier, dir, ids }) => {
      const referenced = findReferencedIds(dir, ids);
      const orphaned = ids.filter((id) => !referenced.has(id));
      if (orphaned.length === 0) {
        return {
          app: name,
          identifier,
          status: "ok",
          detail: `all ${ids.length} declared product id${ids.length === 1 ? "" : "s"} referenced in source`,
        };
      }
      return {
        app: name,
        identifier,
        status: "warn",
        detail: `${orphaned.length} declared product id${orphaned.length === 1 ? "" : "s"} not found in source: ${orphaned.join(", ")}`,
        hint: "check for a typo or an orphaned product in launch.config.ts (native/generated dirs are skipped)",
      };
    });
    return { state: "checked", apps: results };
  },
};
