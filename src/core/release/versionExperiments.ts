import { FileSystem } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { appRecordMissing, plan, type ReconcileContext } from '../store/reconcile.js';
import type {
  ExperimentTreatmentResource,
  VersionExperimentResource,
} from '../types/appleCatalog.js';
import type { PlannedAction } from '../types/reconcile.js';

const DEFAULT_PLATFORM = 'IOS';

const ExperimentsDocumentSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});
const ExperimentNameSchema = Schema.String.pipe(
  Schema.nonEmptyString({
    message: () =>
      'experiments.config.json: experiment and treatment names must be non-empty strings.',
  }),
);
const TrafficProportionSchema = Schema.Number.annotations({
  message: () => 'experiments.config.json: trafficProportion must be a positive number.',
}).pipe(
  Schema.finite({
    message: () => 'experiments.config.json: trafficProportion must be a positive number.',
  }),
  Schema.positive({
    message: () => 'experiments.config.json: trafficProportion must be a positive number.',
  }),
);

export const TreatmentConfigSchema = Schema.mutable(
  Schema.Struct({
    name: ExperimentNameSchema,
    appIconName: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

export type TreatmentConfig = Schema.Schema.Type<typeof TreatmentConfigSchema>;

export const ExperimentConfigSchema = Schema.mutable(
  Schema.Struct({
    name: ExperimentNameSchema,
    trafficProportion: TrafficProportionSchema,
    platform: Schema.optionalWith(Schema.String, { exact: true }),
    treatments: Schema.optionalWith(Schema.mutable(Schema.Array(TreatmentConfigSchema)), {
      exact: true,
    }),
  }),
);

export type ExperimentConfig = Schema.Schema.Type<typeof ExperimentConfigSchema>;

export const VersionExperimentsConfigSchema = Schema.mutable(
  Schema.Struct({
    experiments: Schema.mutable(Schema.Array(ExperimentConfigSchema)).pipe(
      Schema.minItems(1, {
        message: () =>
          'experiments.config.json must declare at least one entry under "experiments".',
      }),
      Schema.filter((declaredExperiments) => {
        const experimentNames = new Set<string>();
        for (const declaredExperiment of declaredExperiments) {
          if (experimentNames.has(declaredExperiment.name)) {
            return `experiments.config.json: duplicate experiment name "${declaredExperiment.name}".`;
          }
          experimentNames.add(declaredExperiment.name);
        }
        return true;
      }),
    ),
  }),
);

export type VersionExperimentsConfig = Schema.Schema.Type<typeof VersionExperimentsConfigSchema>;

/** Experiments decoding or reconciliation failed. */
export type VersionExperimentsFailure = Readonly<{
  readonly _tag: 'VersionExperimentsFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeVersionExperimentsFailure = Data.tagged<VersionExperimentsFailure>(
  'VersionExperimentsFailure',
);

/** Store API calls used by product-page experiment reconciliation. */
export type AscExperimentsApi = Readonly<{
  getAppId: (bundleId: string) => Effect.Effect<string | null, unknown>;
  listVersionExperiments: (appId: string) => Effect.Effect<VersionExperimentResource[], unknown>;
  createVersionExperiment: (
    appId: string,
    experimentInput: {
      name: string;
      platform: string;
      trafficProportion: number;
    },
  ) => Effect.Effect<VersionExperimentResource, unknown>;
  listExperimentTreatments: (
    experimentId: string,
  ) => Effect.Effect<ExperimentTreatmentResource[], unknown>;
  createExperimentTreatment: (
    experimentId: string,
    treatmentInput: { name: string; appIconName?: string },
  ) => Effect.Effect<ExperimentTreatmentResource, unknown>;
}>;

/** Inputs for one app's experiment reconciliation. */
export type ExperimentsReconcileInput = Readonly<{
  bundleId: string;
  config: VersionExperimentsConfig;
  dryRun: boolean;
}>;

type EnsuredExperiment = Readonly<{
  experimentId: string | null;
  existed: boolean;
}>;

/** Convert an underlying failure to the experiments channel. */
const versionExperimentsFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): VersionExperimentsFailure => {
  let message = explicitMessage;
  if (message === undefined) message = errorMessage(cause);
  if (message.length === 0) message = `${operation} failed.`;
  return makeVersionExperimentsFailure({ operation, message, cause });
};

/** Read an experiment by name or create it when absent. */
const ensureExperiment = (
  reconcileContext: ReconcileContext,
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  desiredExperiment: ExperimentConfig,
  existingExperiment: VersionExperimentResource | undefined,
): Effect.Effect<EnsuredExperiment> => {
  if (existingExperiment !== undefined) {
    return Effect.succeed({
      experimentId: existingExperiment.id,
      existed: true,
    });
  }
  const plannedAction = plan(
    reconcileContext,
    `create experiment "${desiredExperiment.name}" (${desiredExperiment.trafficProportion}% traffic)`,
  );
  if (reconcileContext.dryRun) {
    return Effect.succeed({ experimentId: null, existed: false });
  }
  let platform = DEFAULT_PLATFORM;
  if (desiredExperiment.platform !== undefined) {
    platform = desiredExperiment.platform;
  }
  return appleExperimentsApi
    .createVersionExperiment(appId, {
      name: desiredExperiment.name,
      platform,
      trafficProportion: desiredExperiment.trafficProportion,
    })
    .pipe(
      Effect.match({
        onSuccess: (createdExperiment) => {
          plannedAction.status = 'applied';
          return { experimentId: createdExperiment.id, existed: false };
        },
        onFailure: (creationFailure) => {
          plannedAction.status = 'failed';
          plannedAction.error = errorMessage(creationFailure);
          return { experimentId: null, existed: false };
        },
      }),
    );
};

/** Create declared treatments that are not already present. */
const reconcileTreatments = (
  reconcileContext: ReconcileContext,
  appleExperimentsApi: AscExperimentsApi,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let desiredTreatments: TreatmentConfig[] = [];
    if (desiredExperiment.treatments !== undefined) {
      desiredTreatments = desiredExperiment.treatments;
    }
    const existingTreatmentNames = new Set<string>();
    if (ensuredExperiment.existed && ensuredExperiment.experimentId !== null) {
      const existingTreatments = yield* appleExperimentsApi.listExperimentTreatments(
        ensuredExperiment.experimentId,
      );
      for (const existingTreatment of existingTreatments) {
        existingTreatmentNames.add(existingTreatment.name);
      }
    }
    for (const desiredTreatment of desiredTreatments) {
      if (existingTreatmentNames.has(desiredTreatment.name)) continue;
      const plannedAction = plan(
        reconcileContext,
        `create treatment "${desiredTreatment.name}" on experiment "${desiredExperiment.name}"`,
      );
      if (reconcileContext.dryRun) continue;
      if (ensuredExperiment.experimentId === null) {
        plannedAction.status = 'skipped';
        continue;
      }
      const treatmentInput: { name: string; appIconName?: string } = {
        name: desiredTreatment.name,
      };
      if (desiredTreatment.appIconName !== undefined) {
        treatmentInput.appIconName = desiredTreatment.appIconName;
      }
      yield* appleExperimentsApi
        .createExperimentTreatment(ensuredExperiment.experimentId, treatmentInput)
        .pipe(
          Effect.match({
            onSuccess: () => {
              plannedAction.status = 'applied';
            },
            onFailure: (creationFailure) => {
              plannedAction.status = 'failed';
              plannedAction.error = errorMessage(creationFailure);
            },
          }),
        );
    }
  });

/** Reconcile product-page experiments for one App Store app. */
export const reconcileVersionExperiments = (
  appleExperimentsApi: AscExperimentsApi,
  reconciliationInput: ExperimentsReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, VersionExperimentsFailure> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = {
      actions: [],
      dryRun: reconciliationInput.dryRun,
    };
    const appId = yield* appleExperimentsApi.getAppId(reconciliationInput.bundleId);
    if (appId === null) {
      return yield* Effect.fail(appRecordMissing(reconciliationInput.bundleId, 'experiments'));
    }
    const existingExperiments = yield* appleExperimentsApi.listVersionExperiments(appId);
    const experimentsByName = new Map(
      existingExperiments.map((existingExperiment) => [
        existingExperiment.name,
        existingExperiment,
      ]),
    );
    for (const desiredExperiment of reconciliationInput.config.experiments) {
      const ensuredExperiment = yield* ensureExperiment(
        reconcileContext,
        appleExperimentsApi,
        appId,
        desiredExperiment,
        experimentsByName.get(desiredExperiment.name),
      );
      yield* reconcileTreatments(
        reconcileContext,
        appleExperimentsApi,
        desiredExperiment,
        ensuredExperiment,
      );
    }
    return {
      bundleId: reconciliationInput.bundleId,
      actions: reconcileContext.actions,
    };
  }).pipe(
    Effect.mapError((cause) => versionExperimentsFailure('reconcile version experiments', cause)),
  );

/** Decode an untrusted experiments.config.json document. */
export const parseVersionExperimentsConfig = (
  rawDocument: unknown,
): Effect.Effect<VersionExperimentsConfig, VersionExperimentsFailure> =>
  Effect.gen(function* () {
    const experimentsDocument = yield* Schema.decodeUnknown(ExperimentsDocumentSchema)(
      rawDocument,
    ).pipe(
      Effect.mapError((cause) =>
        versionExperimentsFailure(
          'decode experiments config document',
          cause,
          'experiments.config.json must be a JSON object.',
        ),
      ),
    );
    return yield* Schema.decodeUnknown(VersionExperimentsConfigSchema)(experimentsDocument).pipe(
      Effect.mapError((cause) =>
        versionExperimentsFailure('decode experiments config fields', cause, errorMessage(cause)),
      ),
    );
  });

/** Read and decode experiments.config.json through Effect Platform. */
export const loadVersionExperimentsConfig = (
  configPath: string,
): Effect.Effect<VersionExperimentsConfig, VersionExperimentsFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configExists = yield* fileSystem
      .exists(configPath)
      .pipe(
        Effect.mapError((cause) => versionExperimentsFailure('inspect experiments config', cause)),
      );
    if (!configExists) {
      return yield* Effect.fail(
        versionExperimentsFailure(
          'read experiments config',
          configPath,
          `No experiments config at ${configPath}. Create one (see \`launch experiments --help\`) or pass --config.`,
        ),
      );
    }
    const configSource = yield* fileSystem
      .readFileString(configPath)
      .pipe(
        Effect.mapError((cause) => versionExperimentsFailure('read experiments config', cause)),
      );
    const rawDocument = yield* Schema.decodeUnknown(Schema.parseJson())(configSource).pipe(
      Effect.mapError((cause) =>
        versionExperimentsFailure(
          'parse experiments config JSON',
          cause,
          `Invalid JSON in ${configPath}.`,
        ),
      ),
    );
    return yield* parseVersionExperimentsConfig(rawDocument);
  });

/** Count applied, failed, and skipped experiment actions. */
export const summarizeExperiments = (
  plannedActions: PlannedAction[],
): Readonly<{ applied: number; failed: number; skipped: number }> => {
  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (const plannedAction of plannedActions) {
    switch (plannedAction.status) {
      case 'applied':
        applied += 1;
        break;
      case 'failed':
        failed += 1;
        break;
      case 'skipped':
        skipped += 1;
        break;
      case 'planned':
        break;
    }
  }
  return { applied, failed, skipped };
};
