/**
 * The App Store **accessibility** plan surface: an app's declared accessibility-support declarations per
 * device family. Wraps `launch accessibility`'s reconciler ({@link reconcileAccessibility}) in dry-run,
 * reading desired state from the `accessibility.config.json` sidecar (its path overridable via
 * `configFiles.accessibility`). Additive: the reconciler creates/updates declared declarations but never
 * removes one, so a `= in sync` result means "config is fully applied," not that no extra declarations
 * exist in the portal.
 *
 * Sidecar-only — no typed `LaunchConfig` field — so the same single file applies to every in-scope app;
 * absent file ⇒ the surface is omitted.
 */

import { resolveSidecarConfig } from "../../config.js";
import { loadAccessibilityConfig, reconcileAccessibility } from "../../accessibility.js";
import { planAppStoreSurface } from "./appStoreSurface.js";
import type { SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan accessibility`. */
const SURFACE = "accessibility";

export const accessibilityPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: "additive",
      configFor: () =>
        resolveSidecarConfig({
          typed: undefined,
          configPath: ctx.config.configFiles?.accessibility ?? "accessibility.config.json",
          explicitPath: false,
          load: loadAccessibilityConfig,
        }),
      reconcile: (api, bundleId, config) => reconcileAccessibility(api, { bundleId, config, dryRun: true }),
    }),
};
