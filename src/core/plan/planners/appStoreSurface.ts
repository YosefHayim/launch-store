import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { PlannedAction } from '@core/types/reconcile.js';
import { errorMessage } from '@core/services/errorMessage.js';
import type {
  AppPlan,
  AscSurfacesApi,
  PlanContext,
  PlanDirection,
  SurfacePlan,
} from '@core/types/plan.js';
/**
 * How one per-app App Store surface plans itself.
 * @typeParam TConfig - the surface's desired-state config shape (e.g. `ReleaseAttributesConfig`).
 */
export type AppStoreSurfaceSpec<TConfig> = {
  surface: string;
  direction: PlanDirection;
  configFor: (
    bundleId: string,
  ) =>
    | Effect.Effect<TConfig | undefined, unknown, FileSystem.FileSystem | Path.Path>
    | TConfig
    | undefined;
  reconcile: (
    api: AscSurfacesApi,
    bundleId: string,
    config: TConfig,
  ) => Effect.Effect<
    {
      actions: readonly PlannedAction[];
    },
    unknown
  >;
};
/**
 * Plan one per-app App Store surface: gather the apps that declare config, resolve the ASC client once
 * (skipping with a hint when no Apple account is active), then dry-run each app's reconciler concurrently,
 * capturing a per-app precondition failure (e.g. no ASC record) as an `error` rather than aborting the run.
 * Omits the surface entirely when no in-scope app declares anything.
 */
export const planAppStoreSurface = <TConfig>(
  planContext: PlanContext,
  spec: AppStoreSurfaceSpec<TConfig>,
): Effect.Effect<SurfacePlan, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const targets: Array<{ app: string; bundleId: string; config: TConfig }> = [];
    for (const discoveredApp of planContext.apps) {
      if (discoveredApp.bundleId === undefined) continue;
      const configSource = spec.configFor(discoveredApp.bundleId);
      let surfaceConfig: TConfig | undefined;
      if (Effect.isEffect(configSource)) surfaceConfig = yield* configSource;
      else surfaceConfig = configSource;
      if (surfaceConfig === undefined) continue;
      targets.push({
        app: discoveredApp.name,
        bundleId: discoveredApp.bundleId,
        config: surfaceConfig,
      });
    }
    if (targets.length === 0) return { surface: spec.surface, store: 'appstore', state: 'omitted' };
    const api = yield* planContext.resolveAscApi();
    if (!api) {
      return {
        surface: spec.surface,
        store: 'appstore',
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };
    }
    const apps = yield* Effect.forEach(
      targets,
      ({ app, bundleId, config }) =>
        spec.reconcile(api, bundleId, config).pipe(
          Effect.match({
            onFailure: (reconciliationFailure): AppPlan => ({
              app,
              identifier: bundleId,
              actions: [],
              error: errorMessage(reconciliationFailure),
            }),
            onSuccess: (reconciliationReport): AppPlan => ({
              app,
              identifier: bundleId,
              actions: reconciliationReport.actions,
            }),
          }),
        ),
      { concurrency: 'unbounded' },
    );
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'planned',
      scope: 'app',
      direction: spec.direction,
      apps,
    };
  });
/**
 * How one **team-level** App Store surface plans itself (wallet / EU distribution). These reconcile
 * resources that have no bundle id, so there is no per-app loop: a single config is reconciled directly
 * against the team and the diff is returned as a `scope: "team"` plan (ADR 0003 A5).
 * @typeParam TConfig - the surface's desired-state config shape (e.g. `WalletConfig`).
 */
export type TeamSurfaceSpec<TConfig> = {
  surface: string;
  direction: PlanDirection;
  config: () =>
    | TConfig
    | Effect.Effect<TConfig | undefined, unknown, FileSystem.FileSystem>
    | undefined;
  reconcile: (
    api: AscSurfacesApi,
    config: TConfig,
  ) => Effect.Effect<readonly PlannedAction[], unknown>;
};
/**
 * Plan one team-level App Store surface: omit when nothing is declared, skip with a hint when no Apple
 * account is active, otherwise dry-run the reconciler and return a team-scoped plan. A thrown reconcile
 * (e.g. an API read failure) degrades to a `skipped` surface rather than aborting the whole plan run, so
 * the `--check` gate still refuses to certify it while plain `launch plan` keeps going.
 */
export const planTeamSurface = <TConfig>(
  planContext: PlanContext,
  spec: TeamSurfaceSpec<TConfig>,
): Effect.Effect<SurfacePlan, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const configSource = spec.config();
    let surfaceConfig: TConfig | undefined;
    if (Effect.isEffect(configSource)) surfaceConfig = yield* configSource;
    else surfaceConfig = configSource;
    if (surfaceConfig === undefined)
      return { surface: spec.surface, store: 'appstore', state: 'omitted' };
    const api = yield* planContext.resolveAscApi();
    if (!api) {
      return {
        surface: spec.surface,
        store: 'appstore',
        state: 'skipped',
        reason: 'no active Apple account',
        hint: 'run `launch creds set-key`',
      };
    }
    return yield* spec.reconcile(api, surfaceConfig).pipe(
      Effect.match({
        onSuccess: (actions): SurfacePlan => {
          return {
            surface: spec.surface,
            store: 'appstore',
            state: 'planned',
            scope: 'team',
            direction: spec.direction,
            actions,
          };
        },
        onFailure: (reconciliationFailure): SurfacePlan => ({
          surface: spec.surface,
          store: 'appstore',
          state: 'skipped',
          reason: errorMessage(reconciliationFailure),
        }),
      }),
    );
  });
