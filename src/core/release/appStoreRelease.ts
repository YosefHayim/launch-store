import { Data, Effect } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import type {
  AppStoreVersionResource,
  BuildResource,
  ReviewSubmissionResource,
} from '../types/appleCatalog.js';
import type { ReleaseType } from '../types/storeSurface.js';

/**
 * Exact App Store Connect surface the release walk needs. Declared here so the state machine is
 * fakeable and documents the client's release methods in one place; AppStoreConnectClient satisfies
 * it structurally.
 */
export type AscReleaseApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  /** Used by release command / release-train; kept on the surface for structural client typing. */
  getLatestMarketingVersion(bundleId: string): Effect.Effect<string | null, unknown>;
  listBuilds(appId: string, limit?: number): Effect.Effect<BuildResource[], unknown>;
  findBuild(
    bundleId: string,
    buildNumber: number,
  ): Effect.Effect<{ id: string; usesNonExemptEncryption: boolean | null } | null, unknown>;
  findBuildByVersion(
    appId: string,
    buildNumber: number,
  ): Effect.Effect<BuildResource | null, unknown>;
  setBuildUsesNonExemptEncryption(
    buildId: string,
    usesNonExemptEncryption: boolean,
  ): Effect.Effect<void, unknown>;
  listAppStoreVersions(
    appId: string,
    platform: string,
  ): Effect.Effect<AppStoreVersionResource[], unknown>;
  createAppStoreVersion(
    appId: string,
    createInput: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Effect.Effect<AppStoreVersionResource, unknown>;
  updateAppStoreVersion(
    versionId: string,
    versionUpdate: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
    },
  ): Effect.Effect<void, unknown>;
  selectBuildForVersion(versionId: string, buildId: string): Effect.Effect<void, unknown>;
  listAppStoreVersionLocalizations(
    versionId: string,
  ): Effect.Effect<ReadonlyArray<{ id: string; locale: string; whatsNew?: string }>, unknown>;
  createAppStoreVersionLocalization(
    versionId: string,
    localizationInput: { locale: string; whatsNew: string },
  ): Effect.Effect<unknown, unknown>;
  updateAppStoreVersionLocalization(
    localizationId: string,
    whatsNew: string,
  ): Effect.Effect<void, unknown>;
  getPhasedRelease(
    versionId: string,
  ): Effect.Effect<{ id: string; phasedReleaseState: string } | null, unknown>;
  createPhasedRelease(versionId: string): Effect.Effect<unknown, unknown>;
  deletePhasedRelease(phasedReleaseId: string): Effect.Effect<void, unknown>;
  listReviewSubmissions(
    appId: string,
    platform: string,
  ): Effect.Effect<ReviewSubmissionResource[], unknown>;
  createReviewSubmission(
    appId: string,
    platform: string,
  ): Effect.Effect<ReviewSubmissionResource, unknown>;
  addReviewSubmissionItem(submissionId: string, versionId: string): Effect.Effect<void, unknown>;
  submitReviewSubmission(submissionId: string): Effect.Effect<void, unknown>;
  getReviewSubmission(submissionId: string): Effect.Effect<ReviewSubmissionResource, unknown>;
  /** Used by release-train go-live; kept on the surface for structural client typing. */
  createAppStoreVersionReleaseRequest(versionId: string): Effect.Effect<void, unknown>;
};

export type AppStoreReleaseFailure = Readonly<{
  readonly _tag: 'AppStoreReleaseFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeAppStoreReleaseFailure =
  Data.tagged<AppStoreReleaseFailure>('AppStoreReleaseFailure');

const releaseFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AppStoreReleaseFailure => {
  let message = explicitMessage;
  if (message === undefined) message = errorMessage(cause);
  if (message.length === 0) message = `${operation} failed.`;
  return makeAppStoreReleaseFailure({ operation, message, cause });
};

/** Apple platform filter/create value for App Store versions. iOS is all v1 covers. */
export const IOS_PLATFORM = 'IOS';

/**
 * What a version's `appStoreState` permits - the transition table for idempotent resume.
 * - `editable`: attach build, set notes, submit
 * - `submitted`: already in Apple's queue - re-run is a no-op
 * - `pending-release`: approved, awaiting go-live
 * - `live`: exact version is public - must bump
 * - `blocked`: unknown/removed state we will not mutate
 */
export type ReleasePhase = 'editable' | 'submitted' | 'pending-release' | 'live' | 'blocked';

/** Classify a version's `appStoreState` into the action the release flow may take. Pure. */
export const nextReleaseAction = (appStoreState: string): ReleasePhase => {
  switch (appStoreState) {
    case 'PREPARE_FOR_SUBMISSION':
    case 'DEVELOPER_REJECTED':
    case 'REJECTED':
    case 'METADATA_REJECTED':
    case 'INVALID_BINARY':
      return 'editable';
    case 'WAITING_FOR_REVIEW':
    case 'IN_REVIEW':
    case 'WAITING_FOR_EXPORT_COMPLIANCE':
    case 'PROCESSING_FOR_APP_STORE':
      return 'submitted';
    case 'PENDING_DEVELOPER_RELEASE':
    case 'PENDING_APPLE_RELEASE':
      return 'pending-release';
    case 'READY_FOR_SALE':
    case 'READY_FOR_DISTRIBUTION':
    case 'REPLACED_WITH_NEW_VERSION':
    case 'REMOVED_FROM_SALE':
    case 'DEVELOPER_REMOVED_FROM_SALE':
      return 'live';
    default:
      return 'blocked';
  }
};

/** Terminal-or-transient read of where a submitted version stands (`launch status` / watch). */
export type ReleaseVerdict = {
  label: string;
  state: 'released' | 'pending-release' | 'in-review' | 'preparing' | 'rejected' | 'unknown';
  done: boolean;
  exitCode: number;
};

/** Map a version's `appStoreState` to a {@link ReleaseVerdict} (`--watch` / exit-code contract). Pure. */
export const classifyVerdict = (appStoreState: string): ReleaseVerdict => {
  switch (appStoreState) {
    case 'READY_FOR_SALE':
    case 'READY_FOR_DISTRIBUTION':
      return { label: 'Live on the App Store', state: 'released', done: true, exitCode: 0 };
    case 'PENDING_DEVELOPER_RELEASE':
      return {
        label: 'Approved - awaiting your release (`launch status`, or the portal)',
        state: 'pending-release',
        done: true,
        exitCode: 0,
      };
    case 'PENDING_APPLE_RELEASE':
      return {
        label: 'Approved - scheduled to go live',
        state: 'pending-release',
        done: true,
        exitCode: 0,
      };
    case 'IN_REVIEW':
      return { label: 'In review', state: 'in-review', done: false, exitCode: 3 };
    case 'WAITING_FOR_REVIEW':
      return { label: 'Waiting for review', state: 'in-review', done: false, exitCode: 3 };
    case 'PROCESSING_FOR_APP_STORE':
      return {
        label: 'Processing for the App Store',
        state: 'in-review',
        done: false,
        exitCode: 3,
      };
    case 'WAITING_FOR_EXPORT_COMPLIANCE':
      return {
        label: 'Waiting for export compliance',
        state: 'preparing',
        done: false,
        exitCode: 3,
      };
    case 'PREPARE_FOR_SUBMISSION':
      return {
        label: 'Preparing for submission (not yet submitted)',
        state: 'preparing',
        done: true,
        exitCode: 0,
      };
    case 'REJECTED':
    case 'METADATA_REJECTED':
    case 'DEVELOPER_REJECTED':
    case 'INVALID_BINARY':
      return {
        label: 'Rejected - open Resolution Center in App Store Connect',
        state: 'rejected',
        done: true,
        exitCode: 2,
      };
    default: {
      let label = appStoreState;
      if (label.length === 0) label = 'no App Store version yet';
      return {
        label,
        state: 'unknown',
        done: true,
        exitCode: 1,
      };
    }
  }
};

/** Everything {@link releaseApp} needs for one submission (config + flags resolved by the command). */
export type ReleaseInput = {
  bundleId: string;
  platform: string;
  versionString: string;
  releaseType: ReleaseType;
  earliestReleaseDate?: string;
  phasedRelease: boolean;
  usesNonExemptEncryption: boolean;
  whatsNew: Record<string, string>;
  build: BuildResource | null;
  dryRun: boolean;
};

/** Where one release step ended: planned (dry-run), or applied / skipped / failed after a real run. */
export type ReleaseActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';

/** One step of the release walk - for `--dry-run` plan and the post-run summary. */
export type ReleaseAction = {
  description: string;
  status: ReleaseActionStatus;
  error?: string;
  note?: string;
};

/** Outcome of a release run: version acted on and ordered steps performed. */
export type ReleaseReport = {
  bundleId: string;
  versionId: string;
  versionString: string;
  appStoreState: string;
  submitted: boolean;
  alreadyInReview: boolean;
  actions: ReleaseAction[];
};

/** Actionable message when an app has no ASC record (Apple has no API to create one). */
export const appRecordMissingMessage = (bundleId: string, command = 'launch release ios'): string =>
  `No App Store Connect app record for ${bundleId}. Apple has no API to create one - create the app ` +
  `once at https://appstoreconnect.com/apps. A brand-new app also needs its screenshots, age rating, ` +
  `privacy details, and signed Paid/Free Apps agreement set there once. Then re-run \`${command}\`.`;

/** Placeholder id when a version create was only planned or failed (create closure never produced an id). */
const DRY_RUN_ID = '(dry-run)';

/** Mutable per-run context threaded through the release walk. */
type ReleaseContext = {
  appleReleaseApi: AscReleaseApi;
  actions: ReleaseAction[];
  dryRun: boolean;
};

type SelectedReleaseVersion = Readonly<{
  versionId: string;
  versionString: string;
  idempotentState?: string;
}>;

/**
 * Record a step and, unless dry-run, perform it. Failures are captured on the action (status
 * `failed`) rather than propagated so the walk keeps going and the summary reports every failure.
 * Returns the terminal status plus the run's value (e.g. a created resource), undefined on dry-run
 * or failure - callers fall back to {@link DRY_RUN_ID} for a not-yet-created version id.
 */
const performReleaseAction = <ActionValue>(
  releaseContext: ReleaseContext,
  description: string,
  runAction: () => Effect.Effect<ActionValue, unknown>,
): Effect.Effect<{
  status: ReleaseActionStatus;
  actionValue?: ActionValue;
}> => {
  const releaseAction: {
    description: string;
    status: ReleaseActionStatus;
    error?: string;
    note?: string;
  } = { description, status: 'planned' };
  releaseContext.actions.push(releaseAction);
  if (releaseContext.dryRun) return Effect.succeed({ status: 'planned' });
  return runAction().pipe(
    Effect.match({
      onSuccess: (actionValue) => {
        releaseAction.status = 'applied';
        return { status: 'applied' as const, actionValue };
      },
      onFailure: (cause) => {
        releaseAction.status = 'failed';
        releaseAction.error = errorMessage(cause);
        return { status: 'failed' as const };
      },
    }),
  );
};

const requireValidStoreBuild = (
  storeBuild: BuildResource,
): Effect.Effect<void, AppStoreReleaseFailure> => {
  if (storeBuild.processingState !== 'VALID') {
    let processingState = storeBuild.processingState;
    if (processingState === null) processingState = 'still processing';
    return Effect.fail(
      releaseFailure(
        'validate App Store build',
        storeBuild,
        `Build ${storeBuild.version} is ${processingState} on App Store Connect - wait for it to finish (\`launch status\`), then re-run.`,
      ),
    );
  }
  if (storeBuild.expired) {
    return Effect.fail(
      releaseFailure(
        'validate App Store build',
        storeBuild,
        `Build ${storeBuild.version} has expired on App Store Connect - upload a fresh build first.`,
      ),
    );
  }
  return Effect.void;
};

/**
 * Drive one App Store version to "submitted for review", idempotently. Reuses, retargets, or creates
 * the editable version; attaches build; declares export compliance; writes notes; sets release type /
 * phased rollout; submits via Apple's review-submission model. With `releaseInput.dryRun` records
 * planned steps and performs no writes. Fails only on preconditions the user must fix (no app record,
 * build not VALID/expired, version already live); every other step is captured per-action so one
 * failure never aborts the rest.
 */
export const releaseApp = (
  appleReleaseApi: AscReleaseApi,
  releaseInput: ReleaseInput,
): Effect.Effect<ReleaseReport, AppStoreReleaseFailure> =>
  Effect.gen(function* () {
    const releaseContext: ReleaseContext = {
      appleReleaseApi,
      actions: [],
      dryRun: releaseInput.dryRun,
    };
    const appId = yield* appleReleaseApi
      .getAppId(releaseInput.bundleId)
      .pipe(Effect.mapError((cause) => releaseFailure('find App Store app', cause)));
    if (appId === null) {
      return yield* Effect.fail(
        releaseFailure(
          'find App Store app',
          releaseInput.bundleId,
          appRecordMissingMessage(releaseInput.bundleId),
        ),
      );
    }
    const storeBuild = releaseInput.build;
    if (storeBuild !== null) {
      yield* requireValidStoreBuild(storeBuild);
    }
    const selectedVersion = yield* selectReleaseVersion(releaseContext, appId, releaseInput);
    if (selectedVersion.idempotentState !== undefined) {
      releaseContext.actions.push({
        description: `version ${selectedVersion.versionString} already ${selectedVersion.idempotentState} - nothing to submit`,
        status: 'skipped',
      });
      return {
        bundleId: releaseInput.bundleId,
        versionId: selectedVersion.versionId,
        versionString: selectedVersion.versionString,
        appStoreState: selectedVersion.idempotentState,
        submitted: false,
        alreadyInReview: true,
        actions: releaseContext.actions,
      };
    }
    const versionId = selectedVersion.versionId;
    if (!releaseContext.dryRun && versionId === DRY_RUN_ID) {
      return {
        bundleId: releaseInput.bundleId,
        versionId,
        versionString: releaseInput.versionString,
        appStoreState: 'PREPARE_FOR_SUBMISSION',
        submitted: false,
        alreadyInReview: false,
        actions: releaseContext.actions,
      };
    }
    if (storeBuild !== null) {
      yield* performReleaseAction(releaseContext, `attach build ${storeBuild.version}`, () =>
        appleReleaseApi.selectBuildForVersion(versionId, storeBuild.id),
      );
      yield* applyExportCompliance(
        releaseContext,
        releaseInput.bundleId,
        storeBuild,
        releaseInput.usesNonExemptEncryption,
      );
    }
    yield* applyReleaseNotes(releaseContext, versionId, releaseInput.whatsNew);
    let releaseTypeDescription = `set release type ${releaseInput.releaseType}`;
    const versionUpdate: { releaseType: string; earliestReleaseDate?: string } = {
      releaseType: releaseInput.releaseType,
    };
    if (releaseInput.earliestReleaseDate !== undefined) {
      releaseTypeDescription += ` @ ${releaseInput.earliestReleaseDate}`;
      versionUpdate.earliestReleaseDate = releaseInput.earliestReleaseDate;
    }
    yield* performReleaseAction(releaseContext, releaseTypeDescription, () =>
      appleReleaseApi.updateAppStoreVersion(versionId, versionUpdate),
    );
    yield* applyPhasedRelease(releaseContext, versionId, releaseInput.phasedRelease);
    yield* submitForReview(releaseContext, appId, versionId, releaseInput.platform);
    return {
      bundleId: releaseInput.bundleId,
      versionId,
      versionString: selectedVersion.versionString,
      appStoreState: 'WAITING_FOR_REVIEW',
      submitted: !releaseInput.dryRun,
      alreadyInReview: false,
      actions: releaseContext.actions,
    };
  });

const isExportComplianceAlreadySetError = (cause: unknown): boolean => {
  if (!(cause instanceof Error)) return false;
  const message = cause.message.toLowerCase();
  let alreadySet = message.includes('cannot update when the value is already set');
  if (!alreadySet) alreadySet = message.includes('already set') && message.includes('409');
  if (!alreadySet) return false;
  if (!('status' in cause)) return true;
  return cause.status === 409;
};

/** Declare export compliance only when App Store Connect has not already stored the desired answer. */
const applyExportCompliance = (
  releaseContext: ReleaseContext,
  bundleId: string,
  storeBuild: BuildResource,
  usesNonExemptEncryption: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const description = `declare export compliance (usesNonExemptEncryption=${String(usesNonExemptEncryption)})`;
    const buildNumber = Number.parseInt(storeBuild.version, 10);
    if (!Number.isNaN(buildNumber)) {
      const currentBuild = yield* releaseContext.appleReleaseApi
        .findBuild(bundleId, buildNumber)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (
        currentBuild !== null &&
        currentBuild.usesNonExemptEncryption === usesNonExemptEncryption
      ) {
        releaseContext.actions.push({
          description,
          status: 'skipped',
          note: 'already answered on this build',
        });
        return;
      }
    }
    if (releaseContext.dryRun) {
      releaseContext.actions.push({ description, status: 'planned' });
      return;
    }
    yield* releaseContext.appleReleaseApi
      .setBuildUsesNonExemptEncryption(storeBuild.id, usesNonExemptEncryption)
      .pipe(
        Effect.match({
          onSuccess: () => {
            releaseContext.actions.push({ description, status: 'applied' });
          },
          onFailure: (cause) => {
            if (isExportComplianceAlreadySetError(cause)) {
              releaseContext.actions.push({
                description,
                status: 'skipped',
                note: 'already answered on this build',
              });
              return;
            }
            releaseContext.actions.push({
              description,
              status: 'failed',
              error: errorMessage(cause),
            });
          },
        }),
      );
  });

/**
 * Resolve the version to act on: reuse the one already at this version string (no-op if already
 * submitted/approved, error if live), else retarget the open editable version, else create a fresh
 * one. Returns its id ({@link DRY_RUN_ID} when create was only planned or failed) plus
 * `idempotentState` when the caller should stop (already submitted/approved).
 */
const selectReleaseVersion = (
  releaseContext: ReleaseContext,
  appId: string,
  releaseInput: ReleaseInput,
): Effect.Effect<SelectedReleaseVersion, AppStoreReleaseFailure> =>
  Effect.gen(function* () {
    const storeVersions = yield* releaseContext.appleReleaseApi
      .listAppStoreVersions(appId, releaseInput.platform)
      .pipe(Effect.mapError((cause) => releaseFailure('list App Store versions', cause)));
    const matchingVersion = storeVersions.find(
      (storeVersion) => storeVersion.versionString === releaseInput.versionString,
    );
    if (matchingVersion !== undefined) {
      const releasePhase = nextReleaseAction(matchingVersion.appStoreState);
      if (releasePhase === 'live') {
        return yield* Effect.fail(
          releaseFailure(
            'select App Store version',
            matchingVersion,
            `Version ${releaseInput.versionString} is already on the App Store (${matchingVersion.appStoreState}). Bump the version in app.json, build, then release again.`,
          ),
        );
      }
      if (['submitted', 'pending-release'].includes(releasePhase)) {
        return {
          versionId: matchingVersion.id,
          versionString: matchingVersion.versionString,
          idempotentState: matchingVersion.appStoreState,
        };
      }
      return { versionId: matchingVersion.id, versionString: matchingVersion.versionString };
    }
    const editableVersion = storeVersions.find(
      (storeVersion) => nextReleaseAction(storeVersion.appStoreState) === 'editable',
    );
    if (editableVersion !== undefined) {
      yield* performReleaseAction(
        releaseContext,
        `retarget open version to ${releaseInput.versionString}`,
        () =>
          releaseContext.appleReleaseApi.updateAppStoreVersion(editableVersion.id, {
            versionString: releaseInput.versionString,
          }),
      );
      return { versionId: editableVersion.id, versionString: releaseInput.versionString };
    }
    const createInput: {
      versionString: string;
      platform: string;
      releaseType: string;
      earliestReleaseDate?: string;
    } = {
      versionString: releaseInput.versionString,
      platform: releaseInput.platform,
      releaseType: releaseInput.releaseType,
    };
    if (releaseInput.earliestReleaseDate !== undefined) {
      createInput.earliestReleaseDate = releaseInput.earliestReleaseDate;
    }
    const createdVersion = yield* performReleaseAction(
      releaseContext,
      `create App Store version ${releaseInput.versionString}`,
      () => releaseContext.appleReleaseApi.createAppStoreVersion(appId, createInput),
    );
    let versionId = DRY_RUN_ID;
    if (createdVersion.actionValue !== undefined) versionId = createdVersion.actionValue.id;
    return {
      versionId,
      versionString: releaseInput.versionString,
    };
  });

/** Write each locale's release notes, creating the localization or updating its `whatsNew`. */
const applyReleaseNotes = (
  releaseContext: ReleaseContext,
  versionId: string,
  whatsNew: Record<string, string>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const localeEntries = Object.entries(whatsNew);
    if (localeEntries.length === 0) return;
    if (versionId === DRY_RUN_ID) {
      releaseContext.actions.push({
        description: `set release notes for ${localeEntries.length} locale(s)`,
        status: 'planned',
      });
      return;
    }
    const existingLocalizations = yield* releaseContext.appleReleaseApi
      .listAppStoreVersionLocalizations(versionId)
      .pipe(Effect.catchAll(() => Effect.succeed([])));
    yield* Effect.forEach(
      localeEntries,
      ([locale, releaseNotes]) => {
        const existingLocalization = existingLocalizations.find(
          (localization) => localization.locale === locale,
        );
        if (existingLocalization !== undefined) {
          return performReleaseAction(releaseContext, `set release notes [${locale}]`, () =>
            releaseContext.appleReleaseApi.updateAppStoreVersionLocalization(
              existingLocalization.id,
              releaseNotes,
            ),
          );
        }
        return performReleaseAction(releaseContext, `set release notes [${locale}]`, () =>
          releaseContext.appleReleaseApi.createAppStoreVersionLocalization(versionId, {
            locale,
            whatsNew: releaseNotes,
          }),
        );
      },
      { concurrency: 1, discard: true },
    );
  });

/** Align the version's phased-release schedule with the requested opt-in (create or remove). */
const applyPhasedRelease = (
  releaseContext: ReleaseContext,
  versionId: string,
  phasedReleaseRequested: boolean,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (versionId === DRY_RUN_ID) {
      if (phasedReleaseRequested) {
        releaseContext.actions.push({ description: 'enable phased release', status: 'planned' });
      }
      return;
    }
    const existingPhasedRelease = yield* releaseContext.appleReleaseApi
      .getPhasedRelease(versionId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (phasedReleaseRequested && existingPhasedRelease === null) {
      yield* performReleaseAction(releaseContext, 'enable phased release', () =>
        releaseContext.appleReleaseApi.createPhasedRelease(versionId),
      );
      return;
    }
    if (!phasedReleaseRequested && existingPhasedRelease !== null) {
      yield* performReleaseAction(
        releaseContext,
        'disable phased release (immediate 100% rollout)',
        () => releaseContext.appleReleaseApi.deletePhasedRelease(existingPhasedRelease.id),
      );
    }
  });

/** Reuse an addable (`READY_FOR_REVIEW`) review submission or open one, add the version, and submit. */
const submitForReview = (
  releaseContext: ReleaseContext,
  appId: string,
  versionId: string,
  platform: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reviewSubmissions = yield* releaseContext.appleReleaseApi
      .listReviewSubmissions(appId, platform)
      .pipe(Effect.catchAll(() => Effect.succeed([])));
    const openSubmission = reviewSubmissions.find(
      (submission) => submission.state === 'READY_FOR_REVIEW',
    );
    let submissionId: string;
    if (openSubmission !== undefined) {
      submissionId = openSubmission.id;
    } else {
      const createdSubmission = yield* performReleaseAction(
        releaseContext,
        'open review submission',
        () => releaseContext.appleReleaseApi.createReviewSubmission(appId, platform),
      );
      submissionId = DRY_RUN_ID;
      if (createdSubmission.actionValue !== undefined) {
        submissionId = createdSubmission.actionValue.id;
      }
    }
    const addVersion = () =>
      releaseContext.appleReleaseApi.addReviewSubmissionItem(submissionId, versionId).pipe(
        Effect.catchAll((cause) => {
          const failureText = errorMessage(cause);
          if (/already|duplicat|exist/i.test(failureText)) return Effect.void;
          return Effect.fail(cause);
        }),
      );
    yield* performReleaseAction(releaseContext, 'add version to review submission', addVersion);
    yield* performReleaseAction(releaseContext, 'submit for App Store review', () =>
      releaseContext.appleReleaseApi.submitReviewSubmission(submissionId),
    );
  });

/** Live read of where an app's current release stands - backs `launch status` and the watch loop. */
export type ReleaseStatus = {
  bundleId: string;
  versionString: string | null;
  appStoreState: string | null;
  buildNumber: string | null;
  buildProcessingState: string | null;
  phasedReleaseState: string | null;
  verdict: ReleaseVerdict;
};

/**
 * Read the most relevant version (in-flight over live) plus build processing and phased-release
 * state, and classify a verdict. Fails when the app record is missing.
 */
export const readReleaseStatus = (
  appleReleaseApi: AscReleaseApi,
  bundleId: string,
  platform: string,
): Effect.Effect<ReleaseStatus, AppStoreReleaseFailure> =>
  Effect.gen(function* () {
    const appId = yield* appleReleaseApi
      .getAppId(bundleId)
      .pipe(Effect.mapError((cause) => releaseFailure('find App Store app', cause)));
    if (appId === null) {
      return yield* Effect.fail(
        releaseFailure(
          'find App Store app',
          bundleId,
          appRecordMissingMessage(bundleId, 'launch status'),
        ),
      );
    }
    const storeVersions = yield* appleReleaseApi
      .listAppStoreVersions(appId, platform)
      .pipe(Effect.mapError((cause) => releaseFailure('list App Store versions', cause)));
    const currentVersion = pickCurrentVersion(storeVersions);
    if (currentVersion === null) {
      return {
        bundleId,
        versionString: null,
        appStoreState: null,
        buildNumber: null,
        buildProcessingState: null,
        phasedReleaseState: null,
        verdict: classifyVerdict(''),
      };
    }
    const [phasedRelease, storeBuilds] = yield* Effect.all(
      [appleReleaseApi.getPhasedRelease(currentVersion.id), appleReleaseApi.listBuilds(appId, 1)],
      { concurrency: 2 },
    ).pipe(Effect.mapError((cause) => releaseFailure('read App Store release status', cause)));
    let latestBuild: BuildResource | null = null;
    if (storeBuilds[0] !== undefined) latestBuild = storeBuilds[0];
    let buildNumber: string | null = null;
    let buildProcessingState: string | null = null;
    if (latestBuild !== null) {
      buildNumber = latestBuild.version;
      buildProcessingState = latestBuild.processingState;
    }
    let phasedReleaseState: string | null = null;
    if (phasedRelease !== null) {
      phasedReleaseState = phasedRelease.phasedReleaseState;
    }
    return {
      bundleId,
      versionString: currentVersion.versionString,
      appStoreState: currentVersion.appStoreState,
      buildNumber,
      buildProcessingState,
      phasedReleaseState,
      verdict: classifyVerdict(currentVersion.appStoreState),
    };
  });

/** Version a developer cares about now: in-flight (editable/submitted/pending) over live. */
export const pickCurrentVersion = (
  storeVersions: AppStoreVersionResource[],
): AppStoreVersionResource | null => {
  const inFlightVersion = storeVersions.find(
    (storeVersion) => nextReleaseAction(storeVersion.appStoreState) !== 'live',
  );
  if (inFlightVersion !== undefined) return inFlightVersion;
  const latestVersion = storeVersions[0];
  if (latestVersion === undefined) return null;
  return latestVersion;
};

/** Options for {@link waitForValidBuild}: injectable sleep keeps the poll loop unit-testable. */
export type WaitOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Effect.Effect<void>;
  onTick?: (state: string) => void;
};

/**
 * Poll a freshly uploaded build until processing reaches `VALID`. Fails on `INVALID` or timeout.
 * Returns the chosen build so the caller can hand it to {@link releaseApp}.
 */
export const waitForValidBuild = (
  appleReleaseApi: AscReleaseApi,
  appId: string,
  buildNumber: number,
  options: WaitOptions = {},
): Effect.Effect<BuildResource, AppStoreReleaseFailure> =>
  Effect.gen(function* () {
    let intervalMs = 30_000;
    if (options.intervalMs !== undefined) intervalMs = options.intervalMs;
    let timeoutMs = 30 * 60_000;
    if (options.timeoutMs !== undefined) timeoutMs = options.timeoutMs;
    let sleepBetweenPolls = (milliseconds: number): Effect.Effect<void> =>
      Effect.sleep(milliseconds);
    if (options.sleep !== undefined) sleepBetweenPolls = options.sleep;
    let waited = 0;
    for (;;) {
      const storeBuild = yield* appleReleaseApi
        .findBuildByVersion(appId, buildNumber)
        .pipe(Effect.mapError((cause) => releaseFailure('read App Store build', cause)));
      let processingState = 'PROCESSING';
      if (storeBuild !== null) {
        const reportedState = storeBuild.processingState;
        if (reportedState !== undefined && reportedState !== null) {
          processingState = reportedState;
        }
      }
      if (options.onTick !== undefined) {
        options.onTick(processingState);
      }
      if (storeBuild !== null && processingState === 'VALID') return storeBuild;
      if (processingState === 'INVALID') {
        return yield* Effect.fail(
          releaseFailure(
            'wait for App Store build',
            storeBuild,
            `Build ${buildNumber} failed App Store Connect processing (INVALID) - check the email Apple sent.`,
          ),
        );
      }
      if (waited >= timeoutMs) {
        return yield* Effect.fail(
          releaseFailure(
            'wait for App Store build',
            storeBuild,
            `Build ${buildNumber} is still ${processingState} after ${Math.round(timeoutMs / 60_000)} min. Re-run \`launch release ios --build ${buildNumber}\` once \`launch status\` shows it VALID.`,
          ),
        );
      }
      yield* sleepBetweenPolls(intervalMs);
      waited += intervalMs;
    }
  });
