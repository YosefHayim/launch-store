/**
 * The App Store **custom-pages** plan surface: an app's custom product pages (alternate listings) and
 * their per-locale promotional text. Wraps `launch custom-pages`'s reconciler
 * ({@link reconcileCustomProductPages}) in dry-run, reading desired state from the
 * `custom-pages.config.json` sidecar (its path overridable via `configFiles.customPages`). Two-way: the
 * reconciler re-reads the live pages and their localizations and reports changes, so a `= in sync` result
 * means live matches config.
 *
 * Sidecar-only — no typed `LaunchConfig` field — so the same single file applies to every in-scope app;
 * absent file ⇒ the surface is omitted.
 */

import { resolveSidecarConfig } from "../../config.js";
import { loadCustomProductPagesConfig, reconcileCustomProductPages } from "../../customProductPages.js";
import { planAppStoreSurface } from "./appStoreSurface.js";
import type { SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan custom-pages`. */
const SURFACE = "custom-pages";

export const customPagesPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: "two-way",
      configFor: () =>
        resolveSidecarConfig({
          typed: undefined,
          configPath: ctx.config.configFiles?.customPages ?? "custom-pages.config.json",
          explicitPath: false,
          load: loadCustomProductPagesConfig,
        }),
      reconcile: (api, bundleId, config) => reconcileCustomProductPages(api, { bundleId, config, dryRun: true }),
    }),
};
