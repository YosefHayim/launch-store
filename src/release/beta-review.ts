import { readFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { plan, skip, type ReconcileContext } from '../store/shared/reconcile.ts';
import type {
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BetaReviewState,
  BuildResource,
} from '../types/apple-catalog.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type BetaReviewConfig = {
  readonly whatToTest: Record<string, string>;
};

type BetaReviewFailure = Readonly<{
  readonly _tag: 'BetaReviewFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeBetaReviewFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): BetaReviewFailure {
  if (fields.cause == null) {
    return { _tag: 'BetaReviewFailure', operation: fields.operation, message: fields.message };
  }

  return {
    _tag: 'BetaReviewFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

export type AscBetaReviewApi = Readonly<{
  readonly listBuilds: (appId: string, limit?: number) => Promise<BuildResource[]>;
  readonly listBetaBuildLocalizations: (
    buildId: string,
  ) => Promise<BetaBuildLocalizationResource[]>;
  readonly createBetaBuildLocalization: (
    buildId: string,
    locale: string,
    whatsNew: string,
  ) => Promise<void>;
  readonly updateBetaBuildLocalization: (localizationId: string, whatsNew: string) => Promise<void>;
  readonly getBetaAppReviewSubmission: (
    buildId: string,
  ) => Promise<BetaAppReviewSubmissionResource | null>;
  readonly createBetaAppReviewSubmission: (buildId: string) => Promise<void>;
}>;

export type BetaReviewReconcileInput = Readonly<{
  readonly appId: string;
  readonly buildVersion?: string;
  readonly whatToTest: Record<string, string>;
  readonly submitForReview: boolean;
  readonly dryRun: boolean;
}>;

type BetaReviewReport = Readonly<{
  readonly buildVersion: string;
  readonly actions: PlannedAction[];
}>;

/** Return human wording for Apple's Beta App Review state. */
function describeState(state: BetaReviewState | undefined): string {
  switch (state) {
    case 'WAITING_FOR_REVIEW':
      return 'waiting for review';
    case 'IN_REVIEW':
      return 'in review';
    case 'REJECTED':
      return 'rejected';
    case 'APPROVED':
      return 'approved';
    case undefined:
      return 'submitted';
  }
}

function isEligibleLatestBuild(availableBuild: BuildResource): boolean {
  const isValid = availableBuild.processingState == 'VALID';

  if (isValid == false) {
    return false;
  }

  const isExpired = availableBuild.expired == true;
  return isExpired == false;
}

function selectRequestedBuild(
  availableBuilds: BuildResource[],
  requestedVersion: string,
): BuildResource {
  function hasRequestedVersion(availableBuild: BuildResource): boolean {
    return availableBuild.version == requestedVersion;
  }

  const matchedBuild = availableBuilds.find(hasRequestedVersion);
  const isBuildMissing = matchedBuild == null;

  if (isBuildMissing) {
    throw makeBetaReviewFailure({
      operation: 'select TestFlight build',
      message: `No build ${requestedVersion} for this app. Upload it first, or omit --build to use the latest.`,
    });
  }

  const isExpired = matchedBuild.expired == true;

  if (isExpired) {
    throw makeBetaReviewFailure({
      operation: 'select TestFlight build',
      message: `Build ${requestedVersion} has expired (TestFlight's 90-day limit) and cannot be submitted.`,
    });
  }

  return matchedBuild;
}

/** Select the requested build or the newest valid, non-expired build. */
function selectBuild(
  availableBuilds: BuildResource[],
  requestedVersion: string | undefined,
): BuildResource {
  const hasRequestedVersion = requestedVersion != null;

  if (hasRequestedVersion) {
    return selectRequestedBuild(availableBuilds, requestedVersion);
  }

  const latestBuild = availableBuilds.find(isEligibleLatestBuild);
  const isLatestMissing = latestBuild == null;

  if (isLatestMissing) {
    throw makeBetaReviewFailure({
      operation: 'select TestFlight build',
      message:
        'No VALID, non-expired build to release. Upload a build and wait for processing to finish.',
    });
  }

  return latestBuild;
}

/** Apply one write while retaining per-action failures in the reconciliation report. */
async function applyPlannedAction(
  action: PlannedAction,
  actionWrite: Promise<void>,
): Promise<void> {
  try {
    await actionWrite;
    action.status = 'applied';
  } catch (cause) {
    action.status = 'failed';
    action.error = errorMessage(cause);
  }
}

async function writeLocalizationNote(
  action: PlannedAction,
  appleStore: AscBetaReviewApi,
  buildId: string,
  locale: string,
  noteText: string,
  currentLocalization: BetaBuildLocalizationResource | undefined,
): Promise<void> {
  const isNewLocalization = currentLocalization == null;

  if (isNewLocalization) {
    await applyPlannedAction(
      action,
      appleStore.createBetaBuildLocalization(buildId, locale, noteText),
    );
    return;
  }

  await applyPlannedAction(
    action,
    appleStore.updateBetaBuildLocalization(currentLocalization.id, noteText),
  );
}

function localizationNote(localization: BetaBuildLocalizationResource | undefined): string {
  if (localization == null) {
    return '';
  }

  if (localization.whatsNew == null) {
    return '';
  }

  return localization.whatsNew;
}

/** Reconcile localized What-to-Test notes serially for App Store rate limits. */
async function reconcileNotes(
  reconciliation: ReconcileContext,
  appleStore: AscBetaReviewApi,
  buildId: string,
  localizedNotes: Record<string, string>,
): Promise<void> {
  const existingLocalizations = await appleStore.listBetaBuildLocalizations(buildId);

  function localizationEntry(
    localization: BetaBuildLocalizationResource,
  ): readonly [string, BetaBuildLocalizationResource] {
    return [localization.locale, localization];
  }

  const localizationsByLocale = new Map(existingLocalizations.map(localizationEntry));

  for (const [locale, noteText] of Object.entries(localizedNotes)) {
    const currentLocalization = localizationsByLocale.get(locale);
    const currentText = localizationNote(currentLocalization);
    const isUnchanged = currentText == noteText;

    if (isUnchanged) {
      continue;
    }

    let description = `set "What to Test" (${locale})`;
    const hasLocalization = currentLocalization != null;

    if (hasLocalization) {
      description = `update "What to Test" (${locale})`;
    }

    const action = plan(reconciliation, description);

    if (reconciliation.dryRun) {
      continue;
    }

    await writeLocalizationNote(action, appleStore, buildId, locale, noteText, currentLocalization);
  }
}

/** Reconcile the Beta App Review submission while retaining an API failure as an action failure. */
async function reconcileSubmission(
  reconciliation: ReconcileContext,
  appleStore: AscBetaReviewApi,
  buildId: string,
): Promise<void> {
  const existingSubmission = await appleStore.getBetaAppReviewSubmission(buildId);
  const isAlreadySubmitted = existingSubmission != null;

  if (isAlreadySubmitted) {
    const describe = describeState(existingSubmission.state);
    skip(reconciliation, `submit for Beta App Review: build already submitted (${describe})`);
    return;
  }

  const action = plan(reconciliation, 'submit for Beta App Review');

  if (reconciliation.dryRun) {
    return;
  }

  await applyPlannedAction(action, appleStore.createBetaAppReviewSubmission(buildId));
}

/** Reconcile one build's localized notes and optional Beta App Review submission. */
export async function reconcileBetaReview(
  appleStore: AscBetaReviewApi,
  reconciliationInput: BetaReviewReconcileInput,
): Promise<BetaReviewReport> {
  const reconciliation: ReconcileContext = {
    actions: [],
    dryRun: reconciliationInput.dryRun,
  };
  const buildScanLimit = 50;
  const availableBuilds = await appleStore.listBuilds(reconciliationInput.appId, buildScanLimit);
  const selectedBuild = selectBuild(availableBuilds, reconciliationInput.buildVersion);

  await reconcileNotes(
    reconciliation,
    appleStore,
    selectedBuild.id,
    reconciliationInput.whatToTest,
  );

  if (reconciliationInput.submitForReview) {
    await reconcileSubmission(reconciliation, appleStore, selectedBuild.id);
  }

  return { buildVersion: selectedBuild.version, actions: reconciliation.actions };
}

function isNoteText(noteText: unknown): noteText is string {
  if (typeof noteText != 'string') {
    return false;
  }

  return noteText.length > 0;
}

/** Decode an unknown TestFlight configuration. */
export function parseBetaReviewConfig(rawConfiguration: unknown): BetaReviewConfig {
  const rawConfigurationObject = readPlainObject(rawConfiguration);

  if (rawConfigurationObject == null) {
    throw makeBetaReviewFailure({
      operation: 'decode TestFlight config',
      message: 'Invalid testflight.config.json: expected an object.',
      cause: rawConfiguration,
    });
  }

  const localizedNotes = rawConfigurationObject['whatToTest'];
  const localizedNotesObject = readPlainObject(localizedNotes);

  if (localizedNotesObject == null) {
    throw makeBetaReviewFailure({
      operation: 'decode TestFlight config',
      message: 'Invalid testflight.config.json: whatToTest must be an object.',
      cause: rawConfigurationObject,
    });
  }

  const locales = Object.keys(localizedNotesObject);
  const hasNoLocales = locales.length == 0;

  if (hasNoLocales) {
    throw makeBetaReviewFailure({
      operation: 'decode TestFlight config',
      message: 'Invalid testflight.config.json: whatToTest must declare at least one locale.',
      cause: rawConfigurationObject,
    });
  }

  const whatToTest: Record<string, string> = {};

  for (const locale of locales) {
    const noteText = localizedNotesObject[locale];
    const isValidNote = isNoteText(noteText);

    if (isValidNote == false) {
      throw makeBetaReviewFailure({
        operation: 'decode TestFlight config',
        message: `Invalid testflight.config.json: whatToTest.${locale} must be a non-empty string.`,
        cause: rawConfigurationObject,
      });
    }

    whatToTest[locale] = noteText;
  }

  return { whatToTest };
}

/** Read and decode a TestFlight configuration file. */
export async function loadBetaReviewConfig(configPath: string): Promise<BetaReviewConfig> {
  let configExists = false;

  try {
    configExists = await pathExists(configPath);
  } catch (cause) {
    throw makeBetaReviewFailure({
      operation: 'inspect TestFlight config',
      message: `Could not inspect ${configPath}.`,
      cause,
    });
  }

  if (configExists == false) {
    throw makeBetaReviewFailure({
      operation: 'read TestFlight config',
      message: `No TestFlight config at ${configPath}. Add a "whatToTest" map, or pass --whats-new <text>.`,
    });
  }

  let configurationText = '';

  try {
    configurationText = await readFile(configPath, 'utf8');
  } catch (cause) {
    throw makeBetaReviewFailure({
      operation: 'read TestFlight config',
      message: `Could not read ${configPath}.`,
      cause,
    });
  }

  let rawConfiguration: unknown;

  try {
    rawConfiguration = JSON.parse(configurationText);
  } catch (cause) {
    throw makeBetaReviewFailure({
      operation: 'parse TestFlight config',
      message: `Invalid JSON in ${configPath}.`,
      cause,
    });
  }

  return parseBetaReviewConfig(rawConfiguration);
}

/** Count applied, failed, and skipped beta-review actions. */
export function summarizeBetaReview(actions: PlannedAction[]): Readonly<{
  applied: number;
  failed: number;
  skipped: number;
}> {
  let applied = 0;
  let failed = 0;
  let skipped = 0;

  for (const action of actions) {
    switch (action.status) {
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
