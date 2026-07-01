/**
 * The App Store **wallet** plan surface: the team's Apple Pay merchant ids and Wallet pass type ids.
 * Wraps `launch wallet`'s reconciler ({@link reconcileWalletIds}) in dry-run, reading desired state from
 * the typed `LaunchConfig.wallet` field or the `wallet.config.json` sidecar (via the shared
 * {@link resolveSidecarConfig}). Team-level — these ids carry no bundle id — so it returns a `scope: "team"`
 * plan. Additive: the reconciler only registers declared ids it can't find, so a `= in sync` result means
 * "config is fully applied," not that no extra ids exist in the portal.
 */

import { resolveSidecarConfig } from '../../config.js';
import { loadWalletConfig, reconcileWalletIds } from '../../walletIds.js';
import { planTeamSurface } from './appStoreSurface.js';
import type { SurfacePlanner } from '../../types.js';

/** Surface id — also the value users pass as `launch plan wallet`. */
const SURFACE = 'wallet';

export const walletPlanner: SurfacePlanner = {
  id: SURFACE,
  store: 'appstore',
  plan: (ctx) =>
    planTeamSurface(ctx, {
      surface: SURFACE,
      direction: 'additive',
      config: () =>
        resolveSidecarConfig({
          typed: ctx.config.wallet,
          configPath: 'wallet.config.json',
          explicitPath: false,
          load: loadWalletConfig,
        }),
      reconcile: (api, config) => reconcileWalletIds(api, config, true),
    }),
};
