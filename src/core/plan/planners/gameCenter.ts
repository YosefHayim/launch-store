/**
 * The App Store **game-center** plan surface: an app's declared Game Center achievements and leaderboards.
 * Wraps `launch game-center`'s reconciler ({@link reconcileGameCenter}) in dry-run, reading desired state
 * from the typed `gameCenter[bundleId]` section or the `gamecenter.config.json` sidecar (via the shared
 * {@link resolveSidecarConfig}). Additive: the reconciler only creates declared items it can't find, so a
 * `= in sync` result means "config is fully applied," not that no extra items exist in the portal.
 */

import { resolveSidecarConfig } from "../../config.js";
import { loadGameCenterConfig, reconcileGameCenter } from "../../gameCenter.js";
import { planAppStoreSurface } from "./appStoreSurface.js";
import type { SurfacePlanner } from "../types.js";

/** Surface id — also the value users pass as `launch plan game-center`. */
const SURFACE = "game-center";

export const gameCenterPlanner: SurfacePlanner = {
  id: SURFACE,
  store: "appstore",
  plan: (ctx) =>
    planAppStoreSurface(ctx, {
      surface: SURFACE,
      direction: "additive",
      configFor: (bundleId) =>
        resolveSidecarConfig({
          typed: ctx.config.gameCenter?.[bundleId],
          configPath: "gamecenter.config.json",
          explicitPath: false,
          load: loadGameCenterConfig,
        }),
      reconcile: (api, bundleId, config) => reconcileGameCenter(api, { bundleId, config, dryRun: true }),
    }),
};
