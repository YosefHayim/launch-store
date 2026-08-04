import type { Effect } from 'effect';
import type { AppDescriptor } from './app.js';
import type { LaunchConfig } from './config.js';
import type { AscCatalogApi } from '../store/ascSync.js';
import type { PlannedAction } from './reconcile.js';
import type { AscReleaseApi } from '../release/releaseAttrs.js';
import type { AscGameCenterApi } from '../store/gameCenter.js';
import type { AscAppClipsApi } from '../store/appClips.js';
import type { AscAvailabilityApi } from '../store/availability.js';
import type { AscAccessibilityApi } from '../store/accessibility.js';
import type { AscExperimentsApi } from '../release/versionExperiments.js';
import type { AscCustomPagesApi } from '../store/customProductPages.js';
import type { AscWalletApi } from '../store/walletIds.js';
import type { AscEuDistributionApi } from '../store/euDistribution.js';
import type { AscOffersApi } from '../store/offers.js';
import type { PreviewsApi, ScreenshotsApi } from '../store/ascScreenshots.js';
import type { PlayProductsApi } from '../store/playProducts.js';
import type { PlaySubscriptionsApi } from '../store/playSubscriptions.js';
/** Which store a surface belongs to - drives credential resolution and how the diff is grouped. */
export type PlanStore = 'appstore' | 'play';
/**
 * The read surface of the Google Play catalog the Play planners share - the union of the products and
 * subscriptions reconcilers' interfaces. One resolver hands this to both planners (mirroring how a single
 * {@link AscCatalogApi} backs every App Store surface); each planner uses only the slice it needs, and
 * `GooglePlayClient` satisfies the whole thing structurally.
 */
export type PlayCatalogApi = PlayProductsApi & PlaySubscriptionsApi & {};
/**
 * The full read surface of App Store Connect the App Store planners share - the union of every ASC
 * surface reconciler's API slice (mirrors how {@link PlayCatalogApi} unions the two Play interfaces). One
 * resolver hands this to every App Store planner; each planner passes it to its reconciler, which uses
 * only the slice it needs. `AppStoreConnectClient` satisfies the whole thing structurally - every `launch`
 * command already passes that client to these reconcilers individually - so no widening of the client is
 * required, only of the resolver's declared type. Grows by one `extends` as each surface is wired.
 */
export type AscSurfacesApi = AscCatalogApi &
  AscReleaseApi &
  AscGameCenterApi &
  AscAppClipsApi &
  AscAvailabilityApi &
  AscAccessibilityApi &
  AscExperimentsApi &
  AscCustomPagesApi &
  AscWalletApi &
  AscEuDistributionApi &
  AscOffersApi &
  ScreenshotsApi &
  PreviewsApi & {};
/**
 * One app's slice of a surface's plan. `actions` is the reconciler's existing {@link PlannedAction} list
 * (all `planned` in dry-run, with advisory `skipped` lines for length-limit/precondition notes); empty
 * means in sync. `error` is set instead when the app couldn't be planned at all - a precondition the
 * user must fix, e.g. no App Store Connect app record - so the gate never silently certifies it as clean.
 */
export type AppPlan = {
  app: string;
  identifier: string;
  actions: PlannedAction[];
  error?: string;
};
/**
 * How completely a surface detects drift - surfaced on the plan and in `--json` so a `drift` gate's
 * guarantee is legible (ADR 0003 A3):
 * - `two-way` - the reconciler lists live state and reports items that are missing **and** extra/changed,
 *   so a `= in sync` result means live == config.
 * - `additive` - the reconciler only ensures declared items exist (it never deletes), so it detects
 *   `config -> live` gaps but is **blind to portal-side additions**; `= in sync` means "config is fully
 *   applied," not "live == config." Genuine bidirectional drift for these surfaces is a v2 depth pass.
 */
export type PlanDirection = 'two-way' | 'additive';
/**
 * The outcome of running one surface's planner, as a discriminated union on `state` (and, for a read
 * surface, on `scope`):
 * - `omitted` - nothing declared for this surface (e.g. no products at all); dropped from output and
 *   exit codes, so an ASC-only project never sees empty Play noise.
 * - `skipped` - declared but unreadable (credentials missing). Benign for plain `launch plan` (a visible
 *   skip at exit 0); a hard error for `launch plan --check`, which cannot certify what it could not read.
 * - `planned` + `scope: "app"` - read successfully; `apps` carries the per-app diff (the usual case).
 * - `planned` + `scope: "team"` - a team-level surface with no bundle id (wallet / EU distribution);
 *   `actions` carries the diff directly, with no per-app grouping (ADR 0003 A5).
 * Every `planned` variant carries its {@link PlanDirection} so the renderer can flag additive surfaces.
 */
export type SurfacePlan =
  | {
      surface: string;
      store: PlanStore;
      state: 'omitted';
    }
  | {
      surface: string;
      store: PlanStore;
      state: 'skipped';
      reason: string;
      hint?: string;
    }
  | {
      surface: string;
      store: PlanStore;
      state: 'planned';
      scope: 'app';
      direction: PlanDirection;
      apps: AppPlan[];
    }
  | {
      surface: string;
      store: PlanStore;
      state: 'planned';
      scope: 'team';
      direction: PlanDirection;
      actions: PlannedAction[];
    };
/**
 * What a {@link SurfacePlanner} is handed: the loaded config, the apps to consider (already narrowed by
 * `-a`), and lazy store-client resolvers. A resolver returns `null` when the account isn't configured,
 * letting the planner emit a `skipped` surface rather than throw. Resolvers are memoized by the command,
 * so several planners over the same store share one client (and one credential read).
 */
export type PlanContext = {
  config: LaunchConfig;
  apps: AppDescriptor[];
  resolveAscApi(): Effect.Effect<AscSurfacesApi | null, unknown>;
  resolvePlayApi(): Effect.Effect<PlayCatalogApi | null, unknown>;
};
/**
 * One config-as-code surface's planner. {@link plan} is **read-only**: it resolves live state and returns
 * the diff it *would* apply without performing any write, so the same call powers both `launch plan` and
 * the `launch drift` gate. Registered like a provider/adopter (see {@link import("./registry.js")}); the
 * orchestrator resolves every registered planner and never names a concrete one.
 */
export type SurfacePlanner = {
  id: string;
  store: PlanStore;
  plan(
    planContext: PlanContext,
  ): Effect.Effect<SurfacePlan, unknown, FileSystem.FileSystem | Path.Path>;
};
import type { FileSystem, Path } from '@effect/platform';
