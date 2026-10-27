import { FileSystem, Path } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { discoverScreenshotsAt, type LocalScreenshot } from '../listing/screenshots/assets.js';
import { errorMessage } from '../services/errorMessage.js';
import {
  groupBy,
  reconcileOwnerScreenshots,
  type ScreenshotSetApi,
  type ScreenshotSetOwner,
} from '../store/ascScreenshots.js';
import { act, DRY_RUN_ID, succeededOrPlanned, type ActionLog } from '../store/ascSync.js';
import { appRecordMissing, plan, type ReconcileContext } from '../store/reconcile.js';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  ReviewSubmissionResource,
  ScreenshotSetResource,
  VersionExperimentResource,
} from '../types/appleCatalog.js';
import type { PlannedAction } from '../types/reconcile.js';

const DEFAULT_PLATFORM = 'IOS';
const NEW_EXPERIMENT_STATE = 'PREPARE_FOR_SUBMISSION';
const SUBMITTABLE_STATES = new Set([NEW_EXPERIMENT_STATE, 'READY_FOR_REVIEW', 'REJECTED']);
const STARTABLE_STATES = new Set(['ACCEPTED', 'APPROVED']);

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
    screenshots: Schema.optionalWith(Schema.String, { exact: true }),
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
export type AscExperimentsApi = ScreenshotSetApi &
  Readonly<{
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
    startVersionExperiment: (experimentId: string) => Effect.Effect<void, unknown>;
    listExperimentTreatmentLocalizations: (
      treatmentId: string,
    ) => Effect.Effect<ExperimentTreatmentLocalizationResource[], unknown>;
    createExperimentTreatmentLocalization: (
      treatmentId: string,
      locale: string,
    ) => Effect.Effect<ExperimentTreatmentLocalizationResource, unknown>;
    listTreatmentScreenshotSets: (
      treatmentLocalizationId: string,
    ) => Effect.Effect<ScreenshotSetResource[], unknown>;
    createTreatmentScreenshotSet: (
      treatmentLocalizationId: string,
      displayType: string,
    ) => Effect.Effect<ScreenshotSetResource, unknown>;
    listReviewSubmissions: (
      appId: string,
      platform: string,
    ) => Effect.Effect<ReviewSubmissionResource[], unknown>;
    createReviewSubmission: (
      appId: string,
      platform: string,
    ) => Effect.Effect<ReviewSubmissionResource, unknown>;
    addExperimentReviewSubmissionItem: (
      submissionId: string,
      experimentId: string,
    ) => Effect.Effect<void, unknown>;
    submitReviewSubmission: (submissionId: string) => Effect.Effect<void, unknown>;
  }>;

/**
 * Inputs for one app's experiment reconciliation. `treatmentScreenshots` holds each treatment's local
 * screenshots, keyed by the `screenshots` folder the treatment declares.
 */
export type ExperimentsReconcileInput = Readonly<{
  bundleId: string;
  config: VersionExperimentsConfig;
  treatmentScreenshots: ReadonlyMap<string, readonly LocalScreenshot[]>;
  submit: boolean;
  start: boolean;
  dryRun: boolean;
}>;

type EnsuredExperiment = Readonly<{
  experimentId: string | null;
  existed: boolean;
}>;

type EnsuredTreatment = Readonly<{
  treatmentId: string | null;
  existed: boolean;
}>;

type EnsuredLocalization = Readonly<{
  localizationId: string;
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

/** Record an action that cannot run, with the reason in its description. */
const skipAction = (actionLog: ActionLog, description: string): void => {
  const plannedAction = plan(actionLog, description);
  plannedAction.status = 'skipped';
};

/** Read a treatment by name or create it; the id stays null while only planned or when creation failed. */
const ensureTreatment = (
  reconcileContext: ReconcileContext,
  appleExperimentsApi: AscExperimentsApi,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
  desiredTreatment: TreatmentConfig,
  existingTreatmentId: string | undefined,
): Effect.Effect<EnsuredTreatment> => {
  if (existingTreatmentId !== undefined) {
    return Effect.succeed({ treatmentId: existingTreatmentId, existed: true });
  }
  const missingTreatment: EnsuredTreatment = { treatmentId: null, existed: false };
  const plannedAction = plan(
    reconcileContext,
    `create treatment "${desiredTreatment.name}" on experiment "${desiredExperiment.name}"`,
  );
  if (reconcileContext.dryRun) return Effect.succeed(missingTreatment);
  if (ensuredExperiment.experimentId === null) {
    plannedAction.status = 'skipped';
    return Effect.succeed(missingTreatment);
  }
  const treatmentInput: { name: string; appIconName?: string } = {
    name: desiredTreatment.name,
  };
  if (desiredTreatment.appIconName !== undefined) {
    treatmentInput.appIconName = desiredTreatment.appIconName;
  }
  return appleExperimentsApi
    .createExperimentTreatment(ensuredExperiment.experimentId, treatmentInput)
    .pipe(
      Effect.match({
        onSuccess: (createdTreatment) => {
          plannedAction.status = 'applied';
          return { treatmentId: createdTreatment.id, existed: false };
        },
        onFailure: (creationFailure) => {
          plannedAction.status = 'failed';
          plannedAction.error = errorMessage(creationFailure);
          return missingTreatment;
        },
      }),
    );
};

/** Read a treatment locale or add it; null when adding it failed. */
const ensureTreatmentLocalization = (
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  treatmentName: string,
  treatmentId: string,
  locale: string,
  existingLocalizationId: string | undefined,
): Effect.Effect<EnsuredLocalization | null> =>
  Effect.gen(function* () {
    if (existingLocalizationId !== undefined) {
      return { localizationId: existingLocalizationId, existed: true };
    }
    const createAction = yield* act(
      actionLog,
      `add locale ${locale} to treatment "${treatmentName}"`,
      false,
      () => appleExperimentsApi.createExperimentTreatmentLocalization(treatmentId, locale),
    );
    if (!succeededOrPlanned(createAction.status)) return null;
    let localizationId = DRY_RUN_ID;
    if (createAction.actionValue !== undefined) localizationId = createAction.actionValue.id;
    return { localizationId, existed: false };
  });

/** A locale that is only planned has no sets to read yet. */
const listTreatmentLocaleSets = (
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  ensuredLocalization: EnsuredLocalization,
): Effect.Effect<ScreenshotSetResource[], unknown> => {
  const plannedOnly = actionLog.dryRun && !ensuredLocalization.existed;
  if (plannedOnly) return Effect.succeed([]);
  return appleExperimentsApi.listTreatmentScreenshotSets(ensuredLocalization.localizationId);
};

/** Add missing treatment locales, then upload each locale's screenshots Apple doesn't have yet. */
const reconcileTreatmentScreenshots = (
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  treatmentName: string,
  ensuredTreatment: EnsuredTreatment,
  screenshots: readonly LocalScreenshot[],
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const treatmentFailed = ensuredTreatment.treatmentId === null && !actionLog.dryRun;
    if (treatmentFailed) return;
    let treatmentId = DRY_RUN_ID;
    if (ensuredTreatment.treatmentId !== null) treatmentId = ensuredTreatment.treatmentId;
    const localizationIdsByLocale = new Map<string, string>();
    if (ensuredTreatment.existed) {
      const existingLocalizations =
        yield* appleExperimentsApi.listExperimentTreatmentLocalizations(treatmentId);
      for (const existingLocalization of existingLocalizations) {
        localizationIdsByLocale.set(existingLocalization.locale, existingLocalization.id);
      }
    }
    const screenshotsByLocale = groupBy(screenshots, (screenshot) => screenshot.locale);
    for (const [locale, localeScreenshots] of screenshotsByLocale) {
      const ensuredLocalization = yield* ensureTreatmentLocalization(
        actionLog,
        appleExperimentsApi,
        treatmentName,
        treatmentId,
        locale,
        localizationIdsByLocale.get(locale),
      );
      if (ensuredLocalization === null) continue;
      const setOwner: ScreenshotSetOwner = {
        locale,
        listSets: () =>
          listTreatmentLocaleSets(actionLog, appleExperimentsApi, ensuredLocalization),
        createSet: (displayType) =>
          appleExperimentsApi.createTreatmentScreenshotSet(
            ensuredLocalization.localizationId,
            displayType,
          ),
      };
      yield* reconcileOwnerScreenshots(appleExperimentsApi, actionLog, setOwner, localeScreenshots);
    }
  });

/** Create declared treatments that are not already present, then sync their screenshots. */
const reconcileTreatments = (
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  reconciliationInput: ExperimentsReconcileInput,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    let desiredTreatments: TreatmentConfig[] = [];
    if (desiredExperiment.treatments !== undefined) {
      desiredTreatments = desiredExperiment.treatments;
    }
    const treatmentIdsByName = new Map<string, string>();
    if (ensuredExperiment.existed && ensuredExperiment.experimentId !== null) {
      const existingTreatments = yield* appleExperimentsApi.listExperimentTreatments(
        ensuredExperiment.experimentId,
      );
      for (const existingTreatment of existingTreatments) {
        treatmentIdsByName.set(existingTreatment.name, existingTreatment.id);
      }
    }
    for (const desiredTreatment of desiredTreatments) {
      const ensuredTreatment = yield* ensureTreatment(
        actionLog,
        appleExperimentsApi,
        desiredExperiment,
        ensuredExperiment,
        desiredTreatment,
        treatmentIdsByName.get(desiredTreatment.name),
      );
      if (desiredTreatment.screenshots === undefined) continue;
      const treatmentScreenshots = reconciliationInput.treatmentScreenshots.get(
        desiredTreatment.screenshots,
      );
      if (treatmentScreenshots === undefined) continue;
      yield* reconcileTreatmentScreenshots(
        actionLog,
        appleExperimentsApi,
        desiredTreatment.name,
        ensuredTreatment,
        treatmentScreenshots,
      );
    }
  });

/** Reuse an open (`READY_FOR_REVIEW`) review submission for the platform, or open a new one. */
const openReviewSubmission = (
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  platform: string,
): Effect.Effect<ReviewSubmissionResource, unknown> =>
  Effect.gen(function* () {
    const reviewSubmissions = yield* appleExperimentsApi.listReviewSubmissions(appId, platform);
    const openSubmission = reviewSubmissions.find(
      (reviewSubmission) => reviewSubmission.state === 'READY_FOR_REVIEW',
    );
    if (openSubmission !== undefined) return openSubmission;
    return yield* appleExperimentsApi.createReviewSubmission(appId, platform);
  });

/** Add the experiment to a review submission and submit it to Apple. */
const sendExperimentToReview = (
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  platform: string,
  experimentId: string,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const reviewSubmission = yield* openReviewSubmission(appleExperimentsApi, appId, platform);
    yield* appleExperimentsApi.addExperimentReviewSubmissionItem(reviewSubmission.id, experimentId);
    yield* appleExperimentsApi.submitReviewSubmission(reviewSubmission.id);
  });

/** Submit an experiment for App Review when its state allows it and nothing before it failed. */
const submitExperiment = (
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
  existingExperiment: VersionExperimentResource | undefined,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const description = `submit experiment "${desiredExperiment.name}" for App Review`;
    let state = NEW_EXPERIMENT_STATE;
    if (existingExperiment !== undefined) state = existingExperiment.state;
    if (!SUBMITTABLE_STATES.has(state)) {
      skipAction(actionLog, `${description}: it is already ${state}`);
      return;
    }
    const earlierChangeFailed = actionLog.actions.some(
      (plannedAction) => plannedAction.status === 'failed',
    );
    if (earlierChangeFailed) {
      skipAction(actionLog, `${description}: an earlier change failed - fix it, then re-run`);
      return;
    }
    let platform = DEFAULT_PLATFORM;
    if (desiredExperiment.platform !== undefined) platform = desiredExperiment.platform;
    let experimentId = DRY_RUN_ID;
    if (ensuredExperiment.experimentId !== null) experimentId = ensuredExperiment.experimentId;
    yield* act(actionLog, description, false, () =>
      sendExperimentToReview(appleExperimentsApi, appId, platform, experimentId),
    );
  });

/** Start an experiment Apple approved that has not started yet. */
const startExperiment = (
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  desiredExperiment: ExperimentConfig,
  existingExperiment: VersionExperimentResource | undefined,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const description = `start experiment "${desiredExperiment.name}"`;
    if (existingExperiment === undefined) {
      skipAction(actionLog, `${description}: submit it and wait for Apple's approval first`);
      return;
    }
    if (existingExperiment.startDate !== undefined) {
      skipAction(
        actionLog,
        `${description}: it already started on ${existingExperiment.startDate}`,
      );
      return;
    }
    if (!STARTABLE_STATES.has(existingExperiment.state)) {
      skipAction(
        actionLog,
        `${description}: it is ${existingExperiment.state} - Apple must approve it first`,
      );
      return;
    }
    yield* act(actionLog, description, false, () =>
      appleExperimentsApi.startVersionExperiment(existingExperiment.id),
    );
  });

/** Reconcile product-page experiments for one App Store app. */
export const reconcileVersionExperiments = (
  appleExperimentsApi: AscExperimentsApi,
  reconciliationInput: ExperimentsReconcileInput,
): Effect.Effect<{ bundleId: string; actions: PlannedAction[] }, VersionExperimentsFailure> =>
  Effect.gen(function* () {
    const actionLog: ActionLog = {
      actions: [],
      dryRun: reconciliationInput.dryRun,
      allowDestructive: false,
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
      const existingExperiment = experimentsByName.get(desiredExperiment.name);
      const ensuredExperiment = yield* ensureExperiment(
        actionLog,
        appleExperimentsApi,
        appId,
        desiredExperiment,
        existingExperiment,
      );
      yield* reconcileTreatments(
        actionLog,
        appleExperimentsApi,
        reconciliationInput,
        desiredExperiment,
        ensuredExperiment,
      );
      if (reconciliationInput.submit) {
        yield* submitExperiment(
          actionLog,
          appleExperimentsApi,
          appId,
          desiredExperiment,
          ensuredExperiment,
          existingExperiment,
        );
      }
      if (reconciliationInput.start) {
        yield* startExperiment(
          actionLog,
          appleExperimentsApi,
          desiredExperiment,
          existingExperiment,
        );
      }
    }
    return {
      bundleId: reconciliationInput.bundleId,
      actions: actionLog.actions,
    };
  }).pipe(
    Effect.mapError((cause) => versionExperimentsFailure('reconcile version experiments', cause)),
  );

/** Every distinct `screenshots` folder the treatments declare. */
const declaredScreenshotFolders = (experimentsConfig: VersionExperimentsConfig): string[] => {
  const screenshotFolders = experimentsConfig.experiments.flatMap((declaredExperiment) => {
    if (declaredExperiment.treatments === undefined) return [];
    return declaredExperiment.treatments.flatMap((declaredTreatment) => {
      if (declaredTreatment.screenshots === undefined) return [];
      return [declaredTreatment.screenshots];
    });
  });
  return [...new Set(screenshotFolders)];
};

/**
 * Read each treatment's screenshots folder, resolved from the config file's folder and laid out like
 * the listing's `<locale>/<DISPLAY_TYPE>/*.png`. Keyed by the folder exactly as the config declares it.
 */
export const discoverTreatmentScreenshots = (
  configPath: string,
  experimentsConfig: VersionExperimentsConfig,
): Effect.Effect<
  ReadonlyMap<string, readonly LocalScreenshot[]>,
  VersionExperimentsFailure,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const configDirectory = pathService.dirname(configPath);
    const treatmentScreenshots = new Map<string, readonly LocalScreenshot[]>();
    for (const screenshotsFolder of declaredScreenshotFolders(experimentsConfig)) {
      const folderPath = pathService.resolve(configDirectory, screenshotsFolder);
      const folderExists = yield* fileSystem
        .exists(folderPath)
        .pipe(
          Effect.mapError((cause) =>
            versionExperimentsFailure('inspect treatment screenshots', cause),
          ),
        );
      if (!folderExists) {
        return yield* Effect.fail(
          versionExperimentsFailure(
            'read treatment screenshots',
            folderPath,
            `No treatment screenshots folder at ${folderPath}.`,
          ),
        );
      }
      const folderScreenshots = yield* discoverScreenshotsAt(folderPath).pipe(
        Effect.mapError((cause) => versionExperimentsFailure('read treatment screenshots', cause)),
      );
      treatmentScreenshots.set(screenshotsFolder, folderScreenshots);
    }
    return treatmentScreenshots;
  });

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
