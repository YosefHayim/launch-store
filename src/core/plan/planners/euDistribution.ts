/**
 * The App Store **eu-distribution** plan surface: the team's authorized EU alternative-distribution
 * domains (DMA). Wraps `launch eu-distribution`'s reconciler ({@link reconcileEuDistributionDomains}) in
 * dry-run, reading desired state from the typed `LaunchConfig.euDistribution` field or the
 * `eu-distribution.config.json` sidecar (via the shared {@link resolveSidecarConfig}). Team-level — these
 * domains carry no bundle id — so it returns a `scope: "team"` plan. Additive: the reconciler only
 * authorizes declared domains it can't find, so a `= in sync` result means "config is fully applied," not
 * that no extra domains exist in the portal.
 */

import { resolveSidecarConfig } from "../../config.js";
import { loadEuDistributionConfig, reconcileEuDistributionDomains } from "../../euDistribution.js";
import { planTeamSurface } from "./appStoreSurface.js";
import type { SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan eu-distribution`. */
const SURFACE = "eu-distribution";

export const euDistributionPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  plan: (ctx) =>
    planTeamSurface(ctx, {
      surface: SURFACE,
      direction: "additive",
      config: () =>
        resolveSidecarConfig({
          typed: ctx.config.euDistribution,
          configPath: "eu-distribution.config.json",
          explicitPath: false,
          load: loadEuDistributionConfig,
        }),
      reconcile: (api, config) => reconcileEuDistributionDomains(api, config, true),
    }),
};
