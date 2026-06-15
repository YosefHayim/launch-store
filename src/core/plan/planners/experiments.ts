/**
 * The App Store **experiments** plan surface: an app's declared product-page A/B experiments and their
 * treatment arms. Wraps `launch experiments`'s reconciler ({@link reconcileVersionExperiments}) in
 * dry-run, reading desired state from the `experiments.config.json` sidecar (its path overridable via
 * `configFiles.experiments`). Additive: the reconciler creates declared experiments/treatments it can't
 * find but never removes one, so a `= in sync` result means "config is fully applied," not that no extra
 * experiments exist in the portal.
 *
 * Sidecar-only — no typed `LaunchConfig` field — so the same single file applies to every in-scope app;
 * absent file ⇒ the surface is omitted.
 */

import { resolveSidecarConfig } from "../../config.js";
import { loadVersionExperimentsConfig, reconcileVersionExperiments } from "../../versionExperiments.js";
import { planAppStoreSurface } from "./appStoreSurface.js";
import type { SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan experiments`. */
const SURFACE = "experiments";

export const experimentsPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: "additive",
      configFor: () =>
        resolveSidecarConfig({
          typed: undefined,
          configPath: ctx.config.configFiles?.experiments ?? "experiments.config.json",
          explicitPath: false,
          load: loadVersionExperimentsConfig,
        }),
      reconcile: (api, bundleId, config) => reconcileVersionExperiments(api, { bundleId, config, dryRun: true }),
    }),
};
