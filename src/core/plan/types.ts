/**
 * Shared vocabulary for `launch plan` / `launch drift` — the read-only diff of `launch.config.ts`
 * against live store state (see `docs/adr/0003-plan-drift.md`).
 *
 * Where `core/ascSync.ts` *applies* a per-app reconcile and `core/adopt` *imports* live state into
 * config, plan only *reports*: it runs every registered {@link SurfacePlanner} in dry-run and aggregates
 * the diff each already computes. A planner owns one config-as-code surface (the ASC product catalog,
 * the App Store listing, Play products, …) across every app; the orchestrator never names a concrete
 * surface, so adding one is a new file + one `registerSurfacePlanner()` line — exactly the "implement an
 * interface + register it" seam the provider and adopter registries use.
 *
 * These types describe the *plan mechanism*, not a config shape, so they live here rather than in
 * `core/types.ts` — the same reason `ascSync.ts` keeps `AscCatalogApi`/`PlannedAction` local.
 */

import type { AppDescriptor, LaunchConfig } from "../types.js";
import type { AscCatalogApi, PlannedAction } from "../ascSync.js";
import type { AscReleaseApi } from "../releaseAttrs.js";
import type { AscGameCenterApi } from "../gameCenter.js";
import type { AscAppClipsApi } from "../appClips.js";
import type { AscAvailabilityApi } from "../availability.js";
import type { AscAccessibilityApi } from "../accessibility.js";
import type { AscExperimentsApi } from "../versionExperiments.js";
import type { AscCustomPagesApi } from "../customProductPages.js";
import type { AscWalletApi } from "../walletIds.js";
import type { AscEuDistributionApi } from "../euDistribution.js";
import type { PlayProductsApi } from "../playProducts.js";
import type { PlaySubscriptionsApi } from "../playSubscriptions.js";

/** Which store a surface belongs to — drives credential resolution and how the diff is grouped. */
export type PlanStore = "appstore" | "play";

/**
 * The read surface of the Google Play catalog the Play planners share — the union of the products and
 * subscriptions reconcilers' interfaces. One resolver hands this to both planners (mirroring how a single
 * {@link AscCatalogApi} backs every App Store surface); each planner uses only the slice it needs, and
 * `GooglePlayClient` satisfies the whole thing structurally.
 */
export interface PlayCatalogApi extends PlayProductsApi, PlaySubscriptionsApi {}

/**
 * The full read surface of App Store Connect the App Store planners share — the union of every ASC
 * surface reconciler's API slice (mirrors how {@link PlayCatalogApi} unions the two Play interfaces). One
 * resolver hands this to every App Store planner; each planner passes it to its reconciler, which uses
 * only the slice it needs. `AppStoreConnectClient` satisfies the whole thing structurally — every `launch`
 * command already passes that client to these reconcilers individually — so no widening of the client is
 * required, only of the resolver's declared type. Grows by one `extends` as each surface is wired.
 */
export interface AscSurfacesApi
  extends
    AscCatalogApi,
    AscReleaseApi,
    AscGameCenterApi,
    AscAppClipsApi,
    AscAvailabilityApi,
    AscAccessibilityApi,
    AscExperimentsApi,
    AscCustomPagesApi,
    AscWalletApi,
    AscEuDistributionApi {}

/**
 * One app's slice of a surface's plan. `actions` is the reconciler's existing {@link PlannedAction} list
 * (all `planned` in dry-run, with advisory `skipped` lines for length-limit/precondition notes); empty
 * means in sync. `error` is set instead when the app couldn't be planned at all — a precondition the
 * user must fix, e.g. no App Store Connect app record — so the gate never silently certifies it as clean.
 */
export interface AppPlan {
  /** App handle as discovered (used for grouping and the `-a` selector). */
  app: string;
  /** The app's identifier on this store — iOS bundle id / Android package name. */
  identifier: string;
  /** Planned (and advisory-skipped) actions for this app; empty means in sync. */
  actions: PlannedAction[];
  /** Set when this app's reconcile threw a precondition; mutually exclusive with real `actions`. */
  error?: string;
}

/**
 * How completely a surface detects drift — surfaced on the plan and in `--json` so a `drift` gate's
 * guarantee is legible (ADR 0003 A3):
 * - `two-way` — the reconciler lists live state and reports items that are missing **and** extra/changed,
 *   so a `= in sync` result means live == config.
 * - `additive` — the reconciler only ensures declared items exist (it never deletes), so it detects
 *   `config → live` gaps but is **blind to portal-side additions**; `= in sync` means "config is fully
 *   applied," not "live == config." Genuine bidirectional drift for these surfaces is a v2 depth pass.
 */
export type PlanDirection = "two-way" | "additive";

/**
 * The outcome of running one surface's planner, as a discriminated union on `state` (and, for a read
 * surface, on `scope`):
 * - `omitted` — nothing declared for this surface (e.g. no products at all); dropped from output and
 *   exit codes, so an ASC-only project never sees empty Play noise.
 * - `skipped` — declared but unreadable (credentials missing). Benign for plain `launch plan` (a visible
 *   skip at exit 0); a hard error for `launch plan --check`, which cannot certify what it could not read.
 * - `planned` + `scope: "app"` — read successfully; `apps` carries the per-app diff (the usual case).
 * - `planned` + `scope: "team"` — a team-level surface with no bundle id (wallet / EU distribution);
 *   `actions` carries the diff directly, with no per-app grouping (ADR 0003 A5).
 * Every `planned` variant carries its {@link PlanDirection} so the renderer can flag additive surfaces.
 */
export type SurfacePlan =
  | { surface: string; store: PlanStore; state: "omitted" }
  | { surface: string; store: PlanStore; state: "skipped"; reason: string; hint?: string }
  | { surface: string; store: PlanStore; state: "planned"; scope: "app"; direction: PlanDirection; apps: AppPlan[] }
  | {
      surface: string;
      store: PlanStore;
      state: "planned";
      scope: "team";
      direction: PlanDirection;
      actions: PlannedAction[];
    };

/**
 * What a {@link SurfacePlanner} is handed: the loaded config, the apps to consider (already narrowed by
 * `-a`), and lazy store-client resolvers. A resolver returns `null` when the account isn't configured,
 * letting the planner emit a `skipped` surface rather than throw. Resolvers are memoized by the command,
 * so several planners over the same store share one client (and one credential read).
 */
export interface PlanContext {
  config: LaunchConfig;
  apps: AppDescriptor[];
  /** Resolve the read-only App Store Connect client (every wired surface), or `null` when no Apple account is active. */
  resolveAscApi(): Promise<AscSurfacesApi | null>;
  /** Resolve the read-only Google Play catalog client, or `null` when no Play service account is configured. */
  resolvePlayApi(): Promise<PlayCatalogApi | null>;
}

/**
 * One config-as-code surface's planner. {@link plan} is **read-only**: it resolves live state and returns
 * the diff it *would* apply without performing any write, so the same call powers both `launch plan` and
 * the `launch drift` gate. Registered like a provider/adopter (see {@link import("./registry.js")}); the
 * orchestrator resolves every registered planner and never names a concrete one.
 */
export interface SurfacePlanner {
  /** Stable surface key shown in the plan and accepted as the `launch plan <surface>` argument. */
  id: string;
  /** Which store this surface lives on. */
  store: PlanStore;
  /** Read live state for the in-scope apps and return the diff, performing no writes. */
  plan(ctx: PlanContext): Promise<SurfacePlan>;
}
