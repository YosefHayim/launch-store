/**
 * Reconcile an app's **product-page A/B experiments** (Apple's v2 model) from a declarative
 * `experiments.config.json`, using the App Store Connect API key alone. Standing up experiments and their
 * treatment arms is click-heavy App Store Connect work that EAS doesn't touch.
 *
 * Per app, for each declared experiment (matched by its `name`):
 * 1. **Create** the experiment when missing, with its platform and traffic proportion.
 * 2. **Create** each declared treatment (variant arm, matched by name) the experiment doesn't have yet.
 *
 * Mirrors {@link reconcileGameCenter `core/gameCenter.ts`}: a read-only PLAN pass builds idempotent
 * {@link PlannedAction}s, then an APPLY pass performs them, each action isolated. Additive (existing
 * experiments/treatments are left untouched, re-run safe; nothing is deleted). Treatment **screenshots**,
 * treatment localizations, and **starting/stopping** an experiment are out of scope (a deliberate
 * follow-up) — Launch sets the experiment up; you launch it from App Store Connect.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { ExperimentTreatmentResource, VersionExperimentResource } from '../apple/ascClient.js';
import {
  appRecordMissing,
  plan,
  type PlannedAction,
  type ReconcileContext,
} from './asc/storeSync.js';
import { errorMessage } from './errorMessage.js';

/** Default platform for an experiment that doesn't name one. */
const DEFAULT_PLATFORM = 'IOS';

/** One declared treatment (variant arm) of an experiment. */
export interface TreatmentConfig {
  /** Treatment name (Apple's match key; shown in App Store Connect). */
  name: string;
  /** Optional custom app-icon asset name for this treatment. */
  appIconName?: string;
}

/** One declared product-page A/B experiment. */
export interface ExperimentConfig {
  /** Experiment name (Apple's match key). */
  name: string;
  /** Apple's traffic proportion for the experiment (the share of users entered into it). */
  trafficProportion: number;
  /** Platform the experiment runs on (default `IOS`). */
  platform?: string;
  /** The treatment arms; at least one is recommended (an experiment needs arms to be meaningful). */
  treatments?: TreatmentConfig[];
}

/** The full `experiments.config.json` document. */
export interface VersionExperimentsConfig {
  /** One entry per experiment; at least one required. */
  experiments: ExperimentConfig[];
}

/**
 * The exact slice of {@link AppStoreConnectClient} the experiments reconciler depends on, declared here so
 * the diff logic is unit-testable with a hand-rolled fake (mirrors {@link AscGameCenterApi}).
 */
export interface AscExperimentsApi {
  getAppId(bundleId: string): Promise<string | null>;
  listVersionExperiments(appId: string): Promise<VersionExperimentResource[]>;
  createVersionExperiment(
    appId: string,
    input: { name: string; platform: string; trafficProportion: number },
  ): Promise<VersionExperimentResource>;
  listExperimentTreatments(experimentId: string): Promise<ExperimentTreatmentResource[]>;
  createExperimentTreatment(
    experimentId: string,
    input: { name: string; appIconName?: string },
  ): Promise<ExperimentTreatmentResource>;
}

/** Inputs to reconcile one app's version experiments. */
export interface ExperimentsReconcileInput {
  bundleId: string;
  config: VersionExperimentsConfig;
  dryRun: boolean;
}

/** Where an experiment stands after ensuring it: its id (and whether it pre-existed), or null when create failed. */
interface EnsuredExperiment {
  experimentId: string | null;
  existed: boolean;
}

/**
 * Reconcile one app's product-page experiments. Throws only for a precondition the user must fix (no App
 * Store Connect app record); per-action failures are captured so one never aborts the rest.
 */
export async function reconcileVersionExperiments(
  api: AscExperimentsApi,
  input: ExperimentsReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  const ctx: ReconcileContext = { actions: [], dryRun: input.dryRun };

  const appId = await api.getAppId(input.bundleId);
  if (!appId) throw appRecordMissing(input.bundleId, 'experiments');

  const existing = new Map(
    (await api.listVersionExperiments(appId)).map((experiment) => [experiment.name, experiment]),
  );
  for (const experiment of input.config.experiments) {
    // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
    const ensured = await ensureExperiment(
      ctx,
      api,
      appId,
      experiment,
      existing.get(experiment.name),
    );
    await reconcileTreatments(ctx, api, experiment, ensured);
  }
  return { bundleId: input.bundleId, actions: ctx.actions };
}

/** Read the experiment by name, creating it when absent. */
async function ensureExperiment(
  ctx: ReconcileContext,
  api: AscExperimentsApi,
  appId: string,
  experiment: ExperimentConfig,
  existing: VersionExperimentResource | undefined,
): Promise<EnsuredExperiment> {
  if (existing) return { experimentId: existing.id, existed: true };

  const action = plan(
    ctx,
    `create experiment "${experiment.name}" (${experiment.trafficProportion}% traffic)`,
  );
  if (ctx.dryRun) return { experimentId: null, existed: false };
  try {
    const created = await api.createVersionExperiment(appId, {
      name: experiment.name,
      platform: experiment.platform ?? DEFAULT_PLATFORM,
      trafficProportion: experiment.trafficProportion,
    });
    action.status = 'applied';
    return { experimentId: created.id, existed: false };
  } catch (error) {
    action.status = 'failed';
    action.error = errorMessage(error);
    return { experimentId: null, existed: false };
  }
}

/** Create each declared treatment the experiment doesn't have yet (matched by name). */
async function reconcileTreatments(
  ctx: ReconcileContext,
  api: AscExperimentsApi,
  experiment: ExperimentConfig,
  ensured: EnsuredExperiment,
): Promise<void> {
  const declared = experiment.treatments ?? [];
  const existingNames =
    ensured.existed && ensured.experimentId
      ? new Set(
          (await api.listExperimentTreatments(ensured.experimentId)).map(
            (treatment) => treatment.name,
          ),
        )
      : new Set<string>();

  for (const treatment of declared) {
    if (existingNames.has(treatment.name)) continue;

    const action = plan(
      ctx,
      `create treatment "${treatment.name}" on experiment "${experiment.name}"`,
    );
    if (ctx.dryRun) continue;
    if (!ensured.experimentId) {
      action.status = 'skipped'; // the experiment create failed, so its treatments can't be created
      continue;
    }
    try {
      // biome-ignore lint/performance/noAwaitInLoops: serial App Store Connect writes — the API rate-limits parallel bursts and dependent creates read ids from earlier ones
      await api.createExperimentTreatment(ensured.experimentId, {
        name: treatment.name,
        ...(treatment.appIconName ? { appIconName: treatment.appIconName } : {}),
      });
      action.status = 'applied';
    } catch (error) {
      action.status = 'failed';
      action.error = errorMessage(error);
    }
  }
}

/** Narrow an unknown value to a plain object, or null. Arrays are rejected so a malformed section fails loudly. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read a required non-empty string field, throwing a located error when missing or the wrong type. */
function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`experiments.config.json: ${where}.${key} must be a non-empty string.`);
  }
  return value;
}

/** Parse one treatment entry. */
function parseTreatment(raw: unknown, where: string): TreatmentConfig {
  const record = asRecord(raw);
  if (!record) throw new Error(`experiments.config.json: ${where} must be an object.`);
  const config: TreatmentConfig = { name: requireString(record, 'name', where) };
  if (record['appIconName'] !== undefined) {
    if (typeof record['appIconName'] !== 'string') {
      throw new Error(`experiments.config.json: ${where}.appIconName must be a string.`);
    }
    config.appIconName = record['appIconName'];
  }
  return config;
}

/** Parse one experiment entry, validating its name, traffic proportion, and treatments. */
function parseExperiment(raw: unknown, index: number): ExperimentConfig {
  const record = asRecord(raw);
  const where = `experiments[${index}]`;
  if (!record) throw new Error(`experiments.config.json: ${where} must be an object.`);

  const trafficProportion = record['trafficProportion'];
  if (typeof trafficProportion !== 'number' || trafficProportion <= 0) {
    throw new Error(
      `experiments.config.json: ${where}.trafficProportion must be a positive number.`,
    );
  }

  const config: ExperimentConfig = {
    name: requireString(record, 'name', where),
    trafficProportion,
  };
  if (record['platform'] !== undefined) {
    if (typeof record['platform'] !== 'string') {
      throw new Error(`experiments.config.json: ${where}.platform must be a string (e.g. "IOS").`);
    }
    config.platform = record['platform'];
  }
  if (record['treatments'] !== undefined) {
    if (!Array.isArray(record['treatments'])) {
      throw new Error(`experiments.config.json: ${where}.treatments must be an array.`);
    }
    config.treatments = record['treatments'].map((entry, i) =>
      parseTreatment(entry, `${where}.treatments[${i}]`),
    );
  }
  return config;
}

/**
 * Parse and validate a raw `experiments.config.json` value into a typed {@link VersionExperimentsConfig}.
 * Rejects a non-object document, a missing/empty `experiments` list, and a duplicate experiment name.
 */
export function parseVersionExperimentsConfig(raw: unknown): VersionExperimentsConfig {
  const record = asRecord(raw);
  if (!record) throw new Error('experiments.config.json must be a JSON object.');

  const rawExperiments = record['experiments'];
  if (!Array.isArray(rawExperiments))
    throw new Error('experiments.config.json: "experiments" must be an array.');
  if (rawExperiments.length === 0) {
    throw new Error('experiments.config.json must declare at least one entry under "experiments".');
  }
  const experiments = rawExperiments.map(parseExperiment);

  const seen = new Set<string>();
  for (const experiment of experiments) {
    if (seen.has(experiment.name))
      throw new Error(`experiments.config.json: duplicate experiment name "${experiment.name}".`);
    seen.add(experiment.name);
  }
  return { experiments };
}

/** Read and parse an `experiments.config.json` from disk. */
export function loadVersionExperimentsConfig(path: string): VersionExperimentsConfig {
  if (!existsSync(path)) {
    throw new Error(
      `No experiments config at ${path}. Create one (see \`launch experiments --help\`) or pass --config.`,
    );
  }
  return parseVersionExperimentsConfig(JSON.parse(readFileSync(path, 'utf8')));
}

/** Tally a report's action statuses for the run summary (mirrors the other store-sync commands). */
export function summarizeExperiments(actions: PlannedAction[]): {
  applied: number;
  failed: number;
  skipped: number;
} {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const action of actions) {
    if (action.status === 'applied') applied++;
    else if (action.status === 'failed') failed++;
    else if (action.status === 'skipped') skipped++;
  }
  return { applied, failed, skipped };
}
