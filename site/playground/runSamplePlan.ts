import { FileSystem, Path } from '@effect/platform';
import { Effect, Layer } from 'effect';
import { runPlanners, type PlanOutcome } from '@core/plan/orchestrator.js';
import { catalogPlanner } from '@core/plan/planners/catalog.js';
import { offersPlanner } from '@core/plan/planners/offers.js';
import { playProductsPlanner } from '@core/plan/planners/playProducts.js';
import { playSubscriptionsPlanner } from '@core/plan/planners/playSubscriptions.js';
import type { PlannedAction } from '@core/types/reconcile.js';
import type { PlanContext } from '@core/types/plan.js';
import { makeSampleAscApi, makeSamplePlayApi } from './browserStoreApis.js';
import type { PlaygroundSettings } from './presets.js';
import { SAMPLE_APP, buildSampleConfig } from './sampleConfig.js';
import { sampleAscStoreFor } from './sampleStores.js';

type PlanLine = Readonly<{ glyph: '+' | '~' | '-'; description: string }>;

export type SamplePlan = Readonly<{
  lines: readonly PlanLine[];
  createCount: number;
  updateCount: number;
  deleteCount: number;
  appErrorCount: number;
}>;

const BROWSER_PLATFORM = Layer.mergeAll(FileSystem.layerNoop({}), Path.layer);

const glyphFor = (plannedAction: PlannedAction): PlanLine['glyph'] => {
  if (plannedAction.status === 'skipped') return '-';
  if (plannedAction.destructive) return '-';
  if (/^update\b/i.test(plannedAction.description)) return '~';
  return '+';
};

const collectActions = (planOutcome: PlanOutcome): PlannedAction[] => {
  const collectedActions: PlannedAction[] = [];
  for (const surface of planOutcome.surfaces) {
    if (surface.state !== 'planned') continue;
    if (surface.scope === 'team') {
      collectedActions.push(...surface.actions);
      continue;
    }
    for (const appPlan of surface.apps) collectedActions.push(...appPlan.actions);
  }
  return collectedActions;
};

const summarizePlan = (planOutcome: PlanOutcome): SamplePlan => {
  const lines: PlanLine[] = [];
  let createCount = 0;
  let updateCount = 0;
  let deleteCount = 0;
  for (const plannedAction of collectActions(planOutcome)) {
    const glyph = glyphFor(plannedAction);
    lines.push({ glyph, description: plannedAction.description });
    if (plannedAction.status !== 'planned') continue;
    if (glyph === '+') createCount += 1;
    if (glyph === '~') updateCount += 1;
    if (glyph === '-') deleteCount += 1;
  }
  return { lines, createCount, updateCount, deleteCount, appErrorCount: planOutcome.appErrorCount };
};

const buildPlanContext = (settings: PlaygroundSettings): PlanContext => {
  const ascApi = makeSampleAscApi(sampleAscStoreFor(settings.presetId));
  const playApi = makeSamplePlayApi({});
  return {
    config: buildSampleConfig(settings),
    apps: [SAMPLE_APP],
    resolveAscApi: () => Effect.succeed(ascApi),
    resolvePlayApi: () => Effect.succeed(playApi),
  };
};

export const runSamplePlan = (settings: PlaygroundSettings): Promise<SamplePlan> =>
  runPlanners(
    buildPlanContext(settings),
    [catalogPlanner, offersPlanner, playProductsPlanner, playSubscriptionsPlanner],
    { check: false },
  ).pipe(Effect.map(summarizePlan), Effect.provide(BROWSER_PLATFORM), Effect.runPromise);
