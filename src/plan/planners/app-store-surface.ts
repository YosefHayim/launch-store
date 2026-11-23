import { errorMessage } from '@/services/platform/error-message.js';
import type { PlannedAction } from '@/types/reconcile.js';
import type {
  AppPlan,
  AscSurfacesApi,
  PlanContext,
  PlanDirection,
  SurfacePlan,
} from '@/types/plan.js';

type MaybePromise<Value> = Value | Promise<Value>;

type AppStoreSurfaceSpec<TConfig> = {
  surface: string;
  direction: PlanDirection;
  configFor: (bundleId: string) => MaybePromise<TConfig | undefined>;
  reconcile: (
    api: AscSurfacesApi,
    bundleId: string,
    config: TConfig,
  ) => Promise<{
    actions: readonly PlannedAction[];
  }>;
};

type AppTarget<TConfig> = {
  app: string;
  bundleId: string;
  config: TConfig;
};

function isAppleAccountMissing(api: AscSurfacesApi | null): api is null {
  return api == null;
}

function isBundleIdMissing(bundleId: string | undefined): bundleId is undefined {
  return bundleId == null;
}

async function readMaybe<Value>(candidate: MaybePromise<Value>): Promise<Value> {
  const isAsync = candidate instanceof Promise;

  if (isAsync) {
    return candidate;
  }

  return candidate;
}

async function planOneApp<TConfig>(
  api: AscSurfacesApi,
  spec: AppStoreSurfaceSpec<TConfig>,
  target: AppTarget<TConfig>,
): Promise<AppPlan> {
  try {
    const reconciliationReport = await spec.reconcile(api, target.bundleId, target.config);

    return {
      app: target.app,
      identifier: target.bundleId,
      actions: reconciliationReport.actions,
    };
  } catch (reconciliationFailure) {
    return {
      app: target.app,
      identifier: target.bundleId,
      actions: [],
      error: errorMessage(reconciliationFailure),
    };
  }
}

export async function planAppStoreSurface<TConfig>(
  planContext: PlanContext,
  spec: AppStoreSurfaceSpec<TConfig>,
): Promise<SurfacePlan> {
  const targets: AppTarget<TConfig>[] = [];

  for (const discoveredApp of planContext.apps) {
    const bundleId = discoveredApp.bundleId;

    if (isBundleIdMissing(bundleId)) {
      continue;
    }

    const surfaceConfig = await readMaybe(spec.configFor(bundleId));

    const isUndeclared = surfaceConfig == null;

    if (isUndeclared) {
      continue;
    }

    targets.push({
      app: discoveredApp.name,
      bundleId,
      config: surfaceConfig,
    });
  }

  const isNothingDeclared = targets.length == 0;

  if (isNothingDeclared) {
    return { surface: spec.surface, store: 'appstore', state: 'omitted' };
  }

  const api = await planContext.resolveAscApi();

  if (isAppleAccountMissing(api)) {
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch-store creds set-key`',
    };
  }

  const appleApi = api;

  function planTarget(target: AppTarget<TConfig>): Promise<AppPlan> {
    return planOneApp(appleApi, spec, target);
  }

  const apps = await Promise.all(targets.map(planTarget));

  return {
    surface: spec.surface,
    store: 'appstore',
    state: 'planned',
    scope: 'app',
    direction: spec.direction,
    apps,
  };
}

type TeamSurfaceSpec<TConfig> = {
  surface: string;
  direction: PlanDirection;
  config: () => MaybePromise<TConfig | undefined>;
  reconcile: (api: AscSurfacesApi, config: TConfig) => Promise<readonly PlannedAction[]>;
};

export async function planTeamSurface<TConfig>(
  planContext: PlanContext,
  spec: TeamSurfaceSpec<TConfig>,
): Promise<SurfacePlan> {
  const surfaceConfig = await readMaybe(spec.config());

  const isUndeclared = surfaceConfig == null;

  if (isUndeclared) {
    return { surface: spec.surface, store: 'appstore', state: 'omitted' };
  }

  const api = await planContext.resolveAscApi();

  if (isAppleAccountMissing(api)) {
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'skipped',
      reason: 'no active Apple account',
      hint: 'run `launch-store creds set-key`',
    };
  }

  try {
    const actions = await spec.reconcile(api, surfaceConfig);

    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'planned',
      scope: 'team',
      direction: spec.direction,
      actions,
    };
  } catch (reconciliationFailure) {
    return {
      surface: spec.surface,
      store: 'appstore',
      state: 'skipped',
      reason: errorMessage(reconciliationFailure),
    };
  }
}
