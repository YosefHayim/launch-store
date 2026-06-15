/**
 * The App Store **release-config** plan surface: an app's declared release attributes — age rating, App
 * Store categories, base price, and App Review details. Wraps `launch release-config`'s reconciler
 * ({@link reconcileRelease}) in dry-run, reading desired state from the typed `releaseAttributes[bundleId]`
 * section or the `release.config.json` sidecar (via the shared {@link resolveSidecarConfig}). Two-way: the
 * reconciler reads live values and reports changes, so `= in sync` means live matches config.
 */

import { resolveSidecarConfig } from "../../config.js";
import { loadReleaseConfig, reconcileRelease } from "../../releaseAttrs.js";
import { planAppStoreSurface } from "./appStoreSurface.js";
import type { SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan release-config`. */
const SURFACE = "release-config";

export const releaseConfigPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: "two-way",
      configFor: (bundleId) =>
        resolveSidecarConfig({
          typed: ctx.config.releaseAttributes?.[bundleId],
          configPath: "release.config.json",
          explicitPath: false,
          load: loadReleaseConfig,
        }),
      reconcile: (api, bundleId, config) => reconcileRelease(api, { bundleId, config, dryRun: true }),
    }),
};
