/**
 * Shared scaffolds for the App Store planners that wrap a single reconciler in dry-run. Two shapes:
 * {@link planAppStoreSurface} for the per-app surfaces (release-config, game-center, app-clips, availability,
 * accessibility, experiments, custom-pages) that loop over `ctx.apps`, and {@link planTeamSurface} for the
 * team-level surfaces (wallet, eu-distribution) whose resources carry no bundle id (ADR 0003 A5). Each planner
 * differs only in its surface id, drift {@link PlanDirection}, how it resolves desired-state config, and which
 * reconciler it runs — the rest (omit when nothing is declared, the missing-account skip, dry-run with isolated
 * error capture) is identical, so it lives here instead of being copy-pasted across every planner file.
 *
 * Read-only by construction: the caller's `reconcile` runs with `dryRun: true`, so each change is recorded
 * as `planned` and no write closure fires (see `docs/adr/0003-plan-drift.md`).
 */

import type { PlannedAction } from '../../ascSync.js';
import type {
  AppPlan,
  AscSurfacesApi,
  PlanContext,
  PlanDirection,
  SurfacePlan,
} from '../../types.js';

/**
 * How one per-app App Store surface plans itself.
 * @typeParam TConfig - the surface's desired-state config shape (e.g. `ReleaseAttributesConfig`).
 */
export interface AppStoreSurfaceSpec<TConfig> {
  /** Surface id — also the `launch plan <surface>` argument. */
  surface: string;
  /** Whether the underlying reconciler detects both-way drift or only missing items (ADR 0003 A3). */
  direction: PlanDirection;
  /** Resolve one app's desired-state config (typed section or sidecar), or `undefined` when none is declared. */
  configFor: (bundleId: string) => TConfig | undefined;
  /** Run the surface's reconciler in dry-run for one app. */
  reconcile: (
    api: AscSurfacesApi,
    bundleId: string,
    config: TConfig,
  ) => Promise<{ actions: PlannedAction[] }>;
}

/**
 * Plan one per-app App Store surface: gather the apps that declare config, resolve the ASC client once
 * (skipping with a hint when no Apple account is active), then dry-run each app's reconciler concurrently,
 * capturing a per-app precondition failure (e.g. no ASC record) as an `error` rather than aborting the run.
 * Omits the surface entirely when no in-scope app declares anything.
 */
export async function planAppStoreSurface<TConfig>(
  ctx: PlanContext,
  spec: AppStoreSurfaceSpec<TConfig>,
): Promise<SurfacePlan> {
  const targets = ctx.apps.flatMap((app) => {
    if (!app.bundleId) return [];
    const config = spec.configFor(app.bundleId);
    return config === undefined ? [] : [{ app: app.name, bundleId: app.bundleId, config }];
  });
  if (targets.length === 0) return { surface: spec.surface, store: 'appstore', state: 'omitted' };

  const api = await ctx.resolveAscApi();
  if (!api) {
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch creds set-key`',
    };
  }

  const apps = await Promise.all(
    targets.map(async ({ app, bundleId, config }): Promise<AppPlan> => {
      try {
        const report = await spec.reconcile(api, bundleId, config);
        return { app, identifier: bundleId, actions: report.actions };
      } catch (error) {
        return {
          app,
          identifier: bundleId,
          actions: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return {
    surface: spec.surface,
    store: 'appstore',
    state: 'planned',
    scope: 'app',
    direction: spec.direction,
    apps,
  };
}

/**
 * How one **team-level** App Store surface plans itself (wallet / EU distribution). These reconcile
 * resources that have no bundle id, so there is no per-app loop: a single config is reconciled directly
 * against the team and the diff is returned as a `scope: "team"` plan (ADR 0003 A5).
 * @typeParam TConfig - the surface's desired-state config shape (e.g. `WalletConfig`).
 */
export interface TeamSurfaceSpec<TConfig> {
  /** Surface id — also the `launch plan <surface>` argument. */
  surface: string;
  /** Whether the underlying reconciler detects both-way drift or only missing items (ADR 0003 A3). */
  direction: PlanDirection;
  /** Resolve the team's desired-state config (typed field or sidecar), or `undefined` when none is declared. */
  config: () => TConfig | undefined;
  /** Run the surface's reconciler in dry-run for the whole team, returning its planned actions. */
  reconcile: (api: AscSurfacesApi, config: TConfig) => Promise<PlannedAction[]>;
}

/**
 * Plan one team-level App Store surface: omit when nothing is declared, skip with a hint when no Apple
 * account is active, otherwise dry-run the reconciler and return a team-scoped plan. A thrown reconcile
 * (e.g. an API read failure) degrades to a `skipped` surface rather than aborting the whole plan run, so
 * the `--check` gate still refuses to certify it while plain `launch plan` keeps going.
 */
export async function planTeamSurface<TConfig>(
  ctx: PlanContext,
  spec: TeamSurfaceSpec<TConfig>,
): Promise<SurfacePlan> {
  const config = spec.config();
  if (config === undefined) return { surface: spec.surface, store: 'appstore', state: 'omitted' };

  const api = await ctx.resolveAscApi();
  if (!api) {
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch creds set-key`',
    };
  }

  try {
    const actions = await spec.reconcile(api, config);
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'planned',
      scope: 'team',
      direction: spec.direction,
      actions,
    };
  } catch (error) {
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'skipped',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
