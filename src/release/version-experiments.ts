import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { discoverScreenshotsAt, type LocalScreenshot } from '../listing/screenshots/assets.ts';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import {
  groupBy,
  reconcileOwnerScreenshots,
  type ScreenshotSetApi,
  type ScreenshotSetOwner,
} from '../store/apple/asc-screenshots.ts';
import { act, DRY_RUN_ID, succeededOrPlanned, type ActionLog } from '../store/apple/asc-sync.ts';
import { appRecordMissing, plan } from '../store/shared/reconcile.ts';
import type {
  ExperimentTreatmentLocalizationResource,
  ExperimentTreatmentResource,
  ReviewSubmissionResource,
  ScreenshotSetResource,
  VersionExperimentResource,
} from '../types/apple-catalog.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const NEW_EXPERIMENT_STATE = 'PREPARE_FOR_SUBMISSION';
const submittableStates = new Set([NEW_EXPERIMENT_STATE, 'READY_FOR_REVIEW', 'REJECTED']);
const startableStates = new Set(['ACCEPTED', 'APPROVED']);
const NAME_MESSAGE =
  'experiments.config.json: experiment and treatment names must be non-empty strings.';
const TRAFFIC_MESSAGE = 'experiments.config.json: trafficProportion must be a positive number.';
const MINIMUM_EXPERIMENTS_MESSAGE =
  'experiments.config.json must declare at least one entry under "experiments".';

export interface TreatmentConfig {
  name: string;
  appIconName?: string;
  screenshots?: string;
}

interface ExperimentConfig {
  name: string;
  trafficProportion: number;
  platform?: string;
  treatments?: TreatmentConfig[];
}

export interface VersionExperimentsConfig {
  experiments: ExperimentConfig[];
}

/** Experiments decoding or reconciliation failed. */
type VersionExperimentsFailure = Readonly<{
  readonly _tag: 'VersionExperimentsFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

/** Store API calls used by product-page experiment reconciliation. */
export type AscExperimentsApi = ScreenshotSetApi &
  Readonly<{
    getAppId: (bundleId: string) => Promise<string | null>;
    listVersionExperiments: (appId: string) => Promise<VersionExperimentResource[]>;
    createVersionExperiment: (
      appId: string,
      experimentInput: {
        name: string;
        platform: string;
        trafficProportion: number;
      },
    ) => Promise<VersionExperimentResource>;
    listExperimentTreatments: (experimentId: string) => Promise<ExperimentTreatmentResource[]>;
    createExperimentTreatment: (
      experimentId: string,
      treatmentInput: { name: string; appIconName?: string },
    ) => Promise<ExperimentTreatmentResource>;
    startVersionExperiment: (experimentId: string) => Promise<void>;
    listExperimentTreatmentLocalizations: (
      treatmentId: string,
    ) => Promise<ExperimentTreatmentLocalizationResource[]>;
    createExperimentTreatmentLocalization: (
      treatmentId: string,
      locale: string,
    ) => Promise<ExperimentTreatmentLocalizationResource>;
    listTreatmentScreenshotSets: (
      treatmentLocalizationId: string,
    ) => Promise<ScreenshotSetResource[]>;
    createTreatmentScreenshotSet: (
      treatmentLocalizationId: string,
      displayType: string,
    ) => Promise<ScreenshotSetResource>;
    listReviewSubmissions: (appId: string, platform: string) => Promise<ReviewSubmissionResource[]>;
    createReviewSubmission: (appId: string, platform: string) => Promise<ReviewSubmissionResource>;
    addExperimentReviewSubmissionItem: (
      submissionId: string,
      experimentId: string,
    ) => Promise<void>;
    submitReviewSubmission: (submissionId: string) => Promise<void>;
  }>;

/** Inputs for one app's experiment reconciliation. */
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
function versionExperimentsFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): VersionExperimentsFailure {
  const providedMessage = explicitMessage ?? errorMessage(cause);
  const hasText = providedMessage.length > 0;
  let message = `${operation} failed.`;

  if (hasText) {
    message = providedMessage;
  }

  return { _tag: 'VersionExperimentsFailure', operation, message, cause };
}

function failConfigFields(cause: unknown, message: string): never {
  throw versionExperimentsFailure('decode experiments config fields', cause, message);
}

function readExperimentName(field: unknown): string {
  if (typeof field != 'string') {
    failConfigFields(field, NAME_MESSAGE);
  }

  const isEmpty = field.length == 0;

  if (isEmpty) {
    failConfigFields(field, NAME_MESSAGE);
  }

  return field;
}

function readTrafficProportion(field: unknown): number {
  if (typeof field != 'number') {
    failConfigFields(field, TRAFFIC_MESSAGE);
  }

  const isFiniteNumber = Number.isFinite(field);

  if (isFiniteNumber == false) {
    failConfigFields(field, TRAFFIC_MESSAGE);
  }

  const isPositive = field > 0;

  if (isPositive == false) {
    failConfigFields(field, TRAFFIC_MESSAGE);
  }

  return field;
}

function readExactOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const keyIsAbsent = Object.hasOwn(record, key) == false;

  if (keyIsAbsent) {
    return undefined;
  }

  const field = record[key];

  if (typeof field != 'string') {
    failConfigFields(field, `experiments.config.json: ${key} must be a string.`);
  }

  return field;
}

function readTreatmentRecord(rawTreatment: Record<string, unknown>): TreatmentConfig {
  const treatment: TreatmentConfig = { name: readExperimentName(rawTreatment['name']) };
  const appIconName = readExactOptionalString(rawTreatment, 'appIconName');
  const screenshots = readExactOptionalString(rawTreatment, 'screenshots');

  if (appIconName != null) {
    treatment.appIconName = appIconName;
  }

  if (screenshots != null) {
    treatment.screenshots = screenshots;
  }

  return treatment;
}

function readTreatment(rawTreatment: unknown): TreatmentConfig {
  const rawTreatmentObject = readPlainObject(rawTreatment);

  if (rawTreatmentObject != null) {
    return readTreatmentRecord(rawTreatmentObject);
  }

  return failConfigFields(
    rawTreatment,
    'experiments.config.json: a treatment must be a JSON object.',
  );
}

function readTreatments(field: unknown): TreatmentConfig[] {
  if (Array.isArray(field)) {
    const treatments: TreatmentConfig[] = [];

    for (const rawTreatment of field) {
      const treatment = readTreatment(rawTreatment);
      treatments.push(treatment);
    }

    return treatments;
  }

  return failConfigFields(field, 'experiments.config.json: treatments must be a list.');
}

function readExperimentRecord(rawExperiment: Record<string, unknown>): ExperimentConfig {
  const experiment: ExperimentConfig = {
    name: readExperimentName(rawExperiment['name']),
    trafficProportion: readTrafficProportion(rawExperiment['trafficProportion']),
  };
  const platform = readExactOptionalString(rawExperiment, 'platform');
  const treatmentsAreAbsent = Object.hasOwn(rawExperiment, 'treatments') == false;

  if (platform != null) {
    experiment.platform = platform;
  }

  if (treatmentsAreAbsent) {
    return experiment;
  }

  experiment.treatments = readTreatments(rawExperiment['treatments']);

  return experiment;
}

function readExperiment(rawExperiment: unknown): ExperimentConfig {
  const rawExperimentObject = readPlainObject(rawExperiment);

  if (rawExperimentObject != null) {
    return readExperimentRecord(rawExperimentObject);
  }

  return failConfigFields(
    rawExperiment,
    'experiments.config.json: an experiment must be a JSON object.',
  );
}

function readExperiments(rawDocument: Record<string, unknown>): ExperimentConfig[] {
  const experimentsAreAbsent = Object.hasOwn(rawDocument, 'experiments') == false;

  if (experimentsAreAbsent) {
    failConfigFields(rawDocument, MINIMUM_EXPERIMENTS_MESSAGE);
  }

  const field = rawDocument['experiments'];

  if (Array.isArray(field)) {
    return readExperimentList(field);
  }

  return failConfigFields(field, MINIMUM_EXPERIMENTS_MESSAGE);
}

function readExperimentList(field: unknown[]): ExperimentConfig[] {
  const minimumExperimentCount = 1;

  const isEmpty = field.length < minimumExperimentCount;

  if (isEmpty) {
    failConfigFields(field, MINIMUM_EXPERIMENTS_MESSAGE);
  }

  const experiments: ExperimentConfig[] = [];
  const experimentNames = new Set<string>();

  for (const rawExperiment of field) {
    const experiment = readExperiment(rawExperiment);

    const isDuplicate = experimentNames.has(experiment.name);

    if (isDuplicate) {
      failConfigFields(
        experiment.name,
        `experiments.config.json: duplicate experiment name "${experiment.name}".`,
      );
    }

    experimentNames.add(experiment.name);
    experiments.push(experiment);
  }

  return experiments;
}

function readExperimentPlatform(desiredExperiment: ExperimentConfig): string {
  if (desiredExperiment.platform != null) {
    return desiredExperiment.platform;
  }

  return 'IOS';
}

function readExperimentId(ensuredExperiment: EnsuredExperiment): string {
  if (ensuredExperiment.experimentId != null) {
    return ensuredExperiment.experimentId;
  }

  return DRY_RUN_ID;
}

function readTreatmentId(ensuredTreatment: EnsuredTreatment): string {
  if (ensuredTreatment.treatmentId != null) {
    return ensuredTreatment.treatmentId;
  }

  return DRY_RUN_ID;
}

function readExperimentState(existingExperiment: VersionExperimentResource | undefined): string {
  if (existingExperiment != null) {
    return existingExperiment.state;
  }

  return NEW_EXPERIMENT_STATE;
}

function canListExistingTreatments(ensuredExperiment: EnsuredExperiment): boolean {
  if (ensuredExperiment.existed == false) {
    return false;
  }

  return ensuredExperiment.experimentId != null;
}

function treatmentWasNotCreated(ensuredTreatment: EnsuredTreatment, dryRun: boolean): boolean {
  if (ensuredTreatment.treatmentId != null) {
    return false;
  }

  return dryRun == false;
}

function isLocalizationOnlyPlanned(dryRun: boolean, existed: boolean): boolean {
  if (dryRun == false) {
    return false;
  }

  return existed == false;
}

function actionFailed(plannedAction: PlannedAction): boolean {
  return plannedAction.status == 'failed';
}

function screenshotLocale(screenshot: LocalScreenshot): string {
  return screenshot.locale;
}

function isReadyForReview(reviewSubmission: ReviewSubmissionResource): boolean {
  return reviewSubmission.state == 'READY_FOR_REVIEW';
}

/** Read an experiment by name or create it when absent. */
async function ensureExperiment(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  desiredExperiment: ExperimentConfig,
  existingExperiment: VersionExperimentResource | undefined,
): Promise<EnsuredExperiment> {
  if (existingExperiment != null) {
    return {
      experimentId: existingExperiment.id,
      existed: true,
    };
  }

  const plannedAction = plan(
    actionLog,
    `create experiment "${desiredExperiment.name}" (${desiredExperiment.trafficProportion}% traffic)`,
  );

  if (actionLog.dryRun) {
    return { experimentId: null, existed: false };
  }

  const platform = readExperimentPlatform(desiredExperiment);

  try {
    const createdExperiment = await appleExperimentsApi.createVersionExperiment(appId, {
      name: desiredExperiment.name,
      platform,
      trafficProportion: desiredExperiment.trafficProportion,
    });

    plannedAction.status = 'applied';

    return { experimentId: createdExperiment.id, existed: false };
  } catch (creationFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(creationFailure);

    return { experimentId: null, existed: false };
  }
}

/** Record an action that cannot run, with the reason in its description. */
function skipAction(actionLog: ActionLog, description: string): void {
  const plannedAction = plan(actionLog, description);
  plannedAction.status = 'skipped';
}

/** Read a treatment by name or create it; the id stays null while only planned or when creation failed. */
async function ensureTreatment(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
  desiredTreatment: TreatmentConfig,
  existingTreatmentId: string | undefined,
): Promise<EnsuredTreatment> {
  if (existingTreatmentId != null) {
    return { treatmentId: existingTreatmentId, existed: true };
  }

  const missingTreatment: EnsuredTreatment = { treatmentId: null, existed: false };
  const plannedAction = plan(
    actionLog,
    `create treatment "${desiredTreatment.name}" on experiment "${desiredExperiment.name}"`,
  );

  if (actionLog.dryRun) {
    return missingTreatment;
  }

  if (ensuredExperiment.experimentId == null) {
    plannedAction.status = 'skipped';

    return missingTreatment;
  }

  const treatmentInput: { name: string; appIconName?: string } = {
    name: desiredTreatment.name,
  };

  if (desiredTreatment.appIconName != null) {
    treatmentInput.appIconName = desiredTreatment.appIconName;
  }

  try {
    const createdTreatment = await appleExperimentsApi.createExperimentTreatment(
      ensuredExperiment.experimentId,
      treatmentInput,
    );

    plannedAction.status = 'applied';

    return { treatmentId: createdTreatment.id, existed: false };
  } catch (creationFailure) {
    plannedAction.status = 'failed';
    plannedAction.error = errorMessage(creationFailure);

    return missingTreatment;
  }
}

/** Read a treatment locale or add it; null when adding it failed. */
async function ensureTreatmentLocalization(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  treatmentName: string,
  treatmentId: string,
  locale: string,
  existingLocalizationId: string | undefined,
): Promise<EnsuredLocalization | null> {
  if (existingLocalizationId != null) {
    return { localizationId: existingLocalizationId, existed: true };
  }

  function createLocalization(): Promise<ExperimentTreatmentLocalizationResource> {
    return appleExperimentsApi.createExperimentTreatmentLocalization(treatmentId, locale);
  }

  const createAction = await act(
    actionLog,
    `add locale ${locale} to treatment "${treatmentName}"`,
    false,
    createLocalization,
  );

  const didNotSucceed = succeededOrPlanned(createAction.status) == false;

  if (didNotSucceed) {
    return null;
  }

  if (createAction.actionValue != null) {
    return { localizationId: createAction.actionValue.id, existed: false };
  }

  return { localizationId: DRY_RUN_ID, existed: false };
}

/** A locale that is only planned has no sets to read yet. */
async function listTreatmentLocaleSets(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  ensuredLocalization: EnsuredLocalization,
): Promise<ScreenshotSetResource[]> {
  const plannedOnly = isLocalizationOnlyPlanned(actionLog.dryRun, ensuredLocalization.existed);

  if (plannedOnly) {
    return [];
  }

  return appleExperimentsApi.listTreatmentScreenshotSets(ensuredLocalization.localizationId);
}

/** Add missing treatment locales, then upload each locale's screenshots Apple doesn't have yet. */
async function reconcileTreatmentScreenshots(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  treatmentName: string,
  ensuredTreatment: EnsuredTreatment,
  screenshots: readonly LocalScreenshot[],
): Promise<void> {
  const treatmentFailed = treatmentWasNotCreated(ensuredTreatment, actionLog.dryRun);

  if (treatmentFailed) {
    return;
  }

  const treatmentId = readTreatmentId(ensuredTreatment);
  const localizationIdsByLocale = new Map<string, string>();

  if (ensuredTreatment.existed) {
    const existingLocalizations =
      await appleExperimentsApi.listExperimentTreatmentLocalizations(treatmentId);

    for (const existingLocalization of existingLocalizations) {
      localizationIdsByLocale.set(existingLocalization.locale, existingLocalization.id);
    }
  }

  const screenshotsByLocale = groupBy(screenshots, screenshotLocale);

  for (const [locale, localeScreenshots] of screenshotsByLocale) {
    const ensuredLocalization = await ensureTreatmentLocalization(
      actionLog,
      appleExperimentsApi,
      treatmentName,
      treatmentId,
      locale,
      localizationIdsByLocale.get(locale),
    );

    if (ensuredLocalization == null) {
      continue;
    }

    const savedLocalization = ensuredLocalization;

    function listSets(): Promise<ScreenshotSetResource[]> {
      return listTreatmentLocaleSets(actionLog, appleExperimentsApi, savedLocalization);
    }

    function createSet(displayType: string): Promise<ScreenshotSetResource> {
      return appleExperimentsApi.createTreatmentScreenshotSet(
        savedLocalization.localizationId,
        displayType,
      );
    }

    const setOwner: ScreenshotSetOwner = {
      locale,
      listSets,
      createSet,
      exact: true,
    };

    await reconcileOwnerScreenshots(appleExperimentsApi, actionLog, setOwner, localeScreenshots);
  }
}

function readDeclaredTreatments(desiredExperiment: ExperimentConfig): TreatmentConfig[] {
  if (desiredExperiment.treatments != null) {
    return desiredExperiment.treatments;
  }

  return [];
}

/** Create declared treatments that are not already present, then sync their screenshots. */
async function reconcileTreatments(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  reconciliationInput: ExperimentsReconcileInput,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
): Promise<void> {
  const desiredTreatments = readDeclaredTreatments(desiredExperiment);

  const treatmentIdsByName = new Map<string, string>();

  const shouldListTreatments = canListExistingTreatments(ensuredExperiment);

  if (shouldListTreatments) {
    const experimentId = readExperimentId(ensuredExperiment);
    const existingTreatments = await appleExperimentsApi.listExperimentTreatments(experimentId);

    for (const existingTreatment of existingTreatments) {
      treatmentIdsByName.set(existingTreatment.name, existingTreatment.id);
    }
  }

  for (const desiredTreatment of desiredTreatments) {
    const ensuredTreatment = await ensureTreatment(
      actionLog,
      appleExperimentsApi,
      desiredExperiment,
      ensuredExperiment,
      desiredTreatment,
      treatmentIdsByName.get(desiredTreatment.name),
    );
    const screenshotsFolder = desiredTreatment.screenshots;

    if (screenshotsFolder == null) {
      continue;
    }

    const treatmentScreenshots = reconciliationInput.treatmentScreenshots.get(screenshotsFolder);

    if (treatmentScreenshots == null) {
      continue;
    }

    await reconcileTreatmentScreenshots(
      actionLog,
      appleExperimentsApi,
      desiredTreatment.name,
      ensuredTreatment,
      treatmentScreenshots,
    );
  }
}

/** Reuse an open (`READY_FOR_REVIEW`) review submission for the platform, or open a new one. */
async function openReviewSubmission(
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  platform: string,
): Promise<ReviewSubmissionResource> {
  const reviewSubmissions = await appleExperimentsApi.listReviewSubmissions(appId, platform);
  const openSubmission = reviewSubmissions.find(isReadyForReview);

  if (openSubmission != null) {
    return openSubmission;
  }

  return appleExperimentsApi.createReviewSubmission(appId, platform);
}

/** Add the experiment to a review submission and submit it to Apple. */
async function sendExperimentToReview(
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  platform: string,
  experimentId: string,
): Promise<void> {
  const reviewSubmission = await openReviewSubmission(appleExperimentsApi, appId, platform);

  await appleExperimentsApi.addExperimentReviewSubmissionItem(reviewSubmission.id, experimentId);
  await appleExperimentsApi.submitReviewSubmission(reviewSubmission.id);
}

/** Submit an experiment for App Review when its state allows it and nothing before it failed. */
async function submitExperiment(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  appId: string,
  desiredExperiment: ExperimentConfig,
  ensuredExperiment: EnsuredExperiment,
  existingExperiment: VersionExperimentResource | undefined,
): Promise<void> {
  const description = `submit experiment "${desiredExperiment.name}" for App Review`;
  const state = readExperimentState(existingExperiment);

  const cannotSubmit = submittableStates.has(state) == false;

  if (cannotSubmit) {
    skipAction(actionLog, `${description}: it is already ${state}`);

    return;
  }

  const earlierChangeFailed = actionLog.actions.some(actionFailed);

  if (earlierChangeFailed) {
    skipAction(actionLog, `${description}: an earlier change failed - fix it, then re-run`);

    return;
  }

  const platform = readExperimentPlatform(desiredExperiment);
  const experimentId = readExperimentId(ensuredExperiment);

  function submitForReview(): Promise<void> {
    return sendExperimentToReview(appleExperimentsApi, appId, platform, experimentId);
  }

  await act(actionLog, description, false, submitForReview);
}

/** Start an experiment Apple approved that has not started yet. */
async function startExperiment(
  actionLog: ActionLog,
  appleExperimentsApi: AscExperimentsApi,
  desiredExperiment: ExperimentConfig,
  existingExperiment: VersionExperimentResource | undefined,
): Promise<void> {
  const description = `start experiment "${desiredExperiment.name}"`;

  if (existingExperiment == null) {
    skipAction(actionLog, `${description}: submit it and wait for Apple's approval first`);

    return;
  }

  const approvedExperiment = existingExperiment;

  const alreadyStarted = approvedExperiment.startDate != null;

  if (alreadyStarted) {
    skipAction(actionLog, `${description}: it already started on ${approvedExperiment.startDate}`);

    return;
  }

  const cannotStart = startableStates.has(approvedExperiment.state) == false;

  if (cannotStart) {
    skipAction(
      actionLog,
      `${description}: it is ${approvedExperiment.state} - Apple must approve it first`,
    );

    return;
  }

  function startApprovedExperiment(): Promise<void> {
    return appleExperimentsApi.startVersionExperiment(approvedExperiment.id);
  }

  await act(actionLog, description, false, startApprovedExperiment);
}

/** Reconcile product-page experiments for one App Store app. */
export async function reconcileVersionExperiments(
  appleExperimentsApi: AscExperimentsApi,
  reconciliationInput: ExperimentsReconcileInput,
): Promise<{ bundleId: string; actions: PlannedAction[] }> {
  try {
    const actionLog: ActionLog = {
      actions: [],
      dryRun: reconciliationInput.dryRun,
      allowDestructive: false,
    };
    const appId = await appleExperimentsApi.getAppId(reconciliationInput.bundleId);

    if (appId == null) {
      throw appRecordMissing(reconciliationInput.bundleId, 'experiments');
    }

    const existingExperiments = await appleExperimentsApi.listVersionExperiments(appId);

    function experimentName(existingExperiment: VersionExperimentResource): string {
      return existingExperiment.name;
    }

    const experimentsByName = new Map(
      existingExperiments.map(function pairExperiment(existingExperiment) {
        return [experimentName(existingExperiment), existingExperiment] as const;
      }),
    );

    for (const desiredExperiment of reconciliationInput.config.experiments) {
      const existingExperiment = experimentsByName.get(desiredExperiment.name);
      const ensuredExperiment = await ensureExperiment(
        actionLog,
        appleExperimentsApi,
        appId,
        desiredExperiment,
        existingExperiment,
      );

      await reconcileTreatments(
        actionLog,
        appleExperimentsApi,
        reconciliationInput,
        desiredExperiment,
        ensuredExperiment,
      );

      if (reconciliationInput.submit) {
        await submitExperiment(
          actionLog,
          appleExperimentsApi,
          appId,
          desiredExperiment,
          ensuredExperiment,
          existingExperiment,
        );
      }

      if (reconciliationInput.start) {
        await startExperiment(
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
  } catch (error) {
    throw versionExperimentsFailure('reconcile version experiments', error);
  }
}

/** Every distinct `screenshots` folder the treatments declare. */
function declaredScreenshotFolders(experimentsConfig: VersionExperimentsConfig): string[] {
  const screenshotFolders: string[] = [];

  for (const declaredExperiment of experimentsConfig.experiments) {
    const declaredTreatments = declaredExperiment.treatments;

    const treatmentsAreUndeclared = declaredTreatments == null;

    if (treatmentsAreUndeclared) {
      continue;
    }

    for (const declaredTreatment of declaredTreatments) {
      const screenshotsFolder = declaredTreatment.screenshots;

      const folderIsUndeclared = screenshotsFolder == null;

      if (folderIsUndeclared) {
        continue;
      }

      screenshotFolders.push(screenshotsFolder);
    }
  }

  return [...new Set(screenshotFolders)];
}

/** Read each treatment's screenshots folder */
export async function discoverTreatmentScreenshots(
  configPath: string,
  experimentsConfig: VersionExperimentsConfig,
): Promise<ReadonlyMap<string, readonly LocalScreenshot[]>> {
  const configDirectory = dirname(configPath);
  const treatmentScreenshots = new Map<string, readonly LocalScreenshot[]>();

  for (const screenshotsFolder of declaredScreenshotFolders(experimentsConfig)) {
    const folderPath = resolve(configDirectory, screenshotsFolder);
    var folderExists = false;

    try {
      folderExists = await pathExists(folderPath);
    } catch (error) {
      throw versionExperimentsFailure('inspect treatment screenshots', error);
    }

    const folderIsMissing = folderExists == false;

    if (folderIsMissing) {
      throw versionExperimentsFailure(
        'read treatment screenshots',
        folderPath,
        `No treatment screenshots folder at ${folderPath}.`,
      );
    }

    try {
      const folderScreenshots = await discoverScreenshotsAt(folderPath);
      treatmentScreenshots.set(screenshotsFolder, folderScreenshots);
    } catch (error) {
      throw versionExperimentsFailure('read treatment screenshots', error);
    }
  }

  return treatmentScreenshots;
}

/** Decode an untrusted experiments.config.json document. */
export async function parseVersionExperimentsConfig(
  rawDocument: unknown,
): Promise<VersionExperimentsConfig> {
  const rawDocumentObject = readPlainObject(rawDocument);

  if (rawDocumentObject != null) {
    return { experiments: readExperiments(rawDocumentObject) };
  }

  throw versionExperimentsFailure(
    'decode experiments config document',
    rawDocument,
    'experiments.config.json must be a JSON object.',
  );
}

/** Read and decode experiments.config.json. */
export async function loadVersionExperimentsConfig(
  configPath: string,
): Promise<VersionExperimentsConfig> {
  var configExists = false;

  try {
    configExists = await pathExists(configPath);
  } catch (error) {
    throw versionExperimentsFailure('inspect experiments config', error);
  }

  const configIsMissing = configExists == false;

  if (configIsMissing) {
    throw versionExperimentsFailure(
      'read experiments config',
      configPath,
      `No experiments config at ${configPath}. Create one (see \`launch-store experiments --help\`) or pass --config.`,
    );
  }

  var configSource = '';

  try {
    configSource = await readFile(configPath, 'utf8');
  } catch (error) {
    throw versionExperimentsFailure('read experiments config', error);
  }

  var rawDocument: unknown;

  try {
    rawDocument = JSON.parse(configSource);
  } catch (error) {
    throw versionExperimentsFailure(
      'parse experiments config JSON',
      error,
      `Invalid JSON in ${configPath}.`,
    );
  }

  return parseVersionExperimentsConfig(rawDocument);
}

/** Count applied, failed, and skipped experiment actions. */
export function summarizeExperiments(plannedActions: PlannedAction[]): Readonly<{
  applied: number;
  failed: number;
  skipped: number;
}> {
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
}
