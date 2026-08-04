import { Data, Effect } from 'effect';
import type {
  AppStoreVersionResource,
  BuildResource,
  ReviewSubmissionResource,
} from '../types/appleCatalog.js';
import type { ReleaseType } from '../types/storeSurface.js';
/**
 * The exact slice of {@link AppStoreConnectClient} the release flow depends on. Declaring it here keeps
 * the state machine testable with a fake and documents the client's release surface in one place;
 * `AppStoreConnectClient` satisfies it structurally.
 */
export type AscReleaseApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  getLatestMarketingVersion(bundleId: string): Effect.Effect<string | null, unknown>;
  listBuilds(appId: string, limit?: number): Effect.Effect<BuildResource[], unknown>;
  findBuild(
    bundleId: string,
    buildNumber: number,
  ): Effect.Effect<
    {
      id: string;
      usesNonExemptEncryption: boolean | null;
    } | null,
    unknown
  >;
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
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Effect.Effect<AppStoreVersionResource, unknown>;
  updateAppStoreVersion(
    versionId: string,
    input: {
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
    input: {
      locale: string;
      whatsNew: string;
    },
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
  if (message === undefined && cause instanceof Error) message = cause.message;
  if (message === undefined) message = String(cause);
  return makeAppStoreReleaseFailure({ operation, message, cause });
};
/** The Apple platform value an App Store version is filtered/created under. iOS is all v1 covers. */
export const IOS_PLATFORM = 'IOS';
/**
 * What a version's `appStoreState` permits right now - the transition table at the heart of
 * idempotent-resume.
 * - `editable`: can attach a build, set notes, and submit (fresh, or a rejected version reopened).
 * - `submitted`: already in Apple's queue (or processing) - re-running is a no-op until it resolves.
 * - `pending-release`: approved, awaiting go-live (manual press or a schedule) - the submit flow is done.
 * - `live`: this exact version is already public - you must bump to release again.
 * - `blocked`: an unknown/removed state we won't mutate.
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
/** A terminal-or-transient read of where a submitted version stands, for `launch status` and the watch loop. */
export type ReleaseVerdict = {
  label: string;
  state: 'released' | 'pending-release' | 'in-review' | 'preparing' | 'rejected' | 'unknown';
  done: boolean;
  exitCode: number;
};
/** Map a version's `appStoreState` to a {@link ReleaseVerdict} (the `--watch` / exit-code contract). Pure. */
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
/** Everything {@link releaseApp} needs for one submission, resolved by the command from config + flags. */
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
/** Where one release step ended up: planned (dry-run), or applied / skipped / failed after a real run. */
export type ReleaseActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';
/** One step of the release walk - recorded for the `--dry-run` plan and the post-run summary. */
export type ReleaseAction = {
  description: string;
  status: ReleaseActionStatus;
  error?: string;
  note?: string;
};
/** The outcome of a release run: the version it acted on and the ordered steps it performed. */
export type ReleaseReport = {
  bundleId: string;
  versionId: string;
  versionString: string;
  appStoreState: string;
  submitted: boolean;
  alreadyInReview: boolean;
  actions: ReleaseAction[];
};
/** The actionable message when an app has no ASC record (which Apple has no API to create). */
export const appRecordMissingMessage = (
  bundleId: string,
  command = 'launch release ios',
): string => {
  return (
    `No App Store Connect app record for ${bundleId}. Apple has no API to create one - create the app ` +
    `once at https://appstoreconnect.com/apps. A brand-new app also needs its screenshots, age rating, ` +
    `privacy details, and signed Paid/Free Apps agreement set there once. Then re-run \`${command}\`.`
  );
};
/** Placeholder id for a version that would only be created in a dry-run (its create closure never runs). */
const DRY_RUN_ID = '(dry-run)';
/** Mutable per-run context threaded through the release walk. */
type ReleaseContext = {
  api: AscReleaseApi;
  actions: ReleaseAction[];
  dryRun: boolean;
};
/**
 * Record a step and, unless this is a dry-run, perform it. A thrown error is captured on the action
 * (status `failed`) rather than propagated, so the walk keeps going and the summary reports every
 * failure. Returns the terminal status plus the run's value (e.g. a created resource), `undefined` on a
 * dry-run or failure - callers fall back to {@link DRY_RUN_ID} for the id of a not-yet-created version.
 */
const performReleaseAction = <ActionValue>(
  releaseContext: ReleaseContext,
  description: string,
  runAction: () => Effect.Effect<ActionValue, unknown>,
): Effect.Effect<{
  status: ReleaseActionStatus;
  actionValue?: ActionValue;
}> => {
  const action: ReleaseAction = { description, status: 'planned' };
  releaseContext.actions.push(action);
  if (releaseContext.dryRun) return Effect.succeed({ status: 'planned' });
  return runAction().pipe(
    Effect.match({
      onSuccess: (actionValue) => {
        action.status = 'applied';
        return { status: 'applied' as const, actionValue };
      },
      onFailure: (cause) => {
        action.status = 'failed';
        if (cause instanceof Error) action.error = cause.message;
        else action.error = String(cause);
        return { status: 'failed' as const };
      },
    }),
  );
};
/**
 * Drive one App Store version to "submitted for review", idempotently. Resolves (reuses, retargets, or
 * creates) the editable version, attaches the chosen build, declares export compliance, writes release
 * notes, sets the release type / phased rollout, then submits via Apple's review-submission model. With
 * `input.dryRun` it records what each step WOULD do and performs no writes. Throws only on a precondition
 * the user must fix (no app record, the build isn't `VALID`/expired, the version is already live); every
 * other step is captured per-action (see {@link act}), so one failure never aborts the rest.
 */
export const releaseApp = (
  api: AscReleaseApi,
  input: ReleaseInput,
): Effect.Effect<ReleaseReport, AppStoreReleaseFailure> =>
  Effect.gen(function* () {
    const releaseContext: ReleaseContext = { api, actions: [], dryRun: input.dryRun };
    const appId = yield* api
      .getAppId(input.bundleId)
      .pipe(Effect.mapError((cause) => releaseFailure('find App Store app', cause)));
    if (appId === null) {
      return yield* Effect.fail(
        releaseFailure(
          'find App Store app',
          input.bundleId,
          appRecordMissingMessage(input.bundleId),
        ),
      );
    }
    const storeBuild = input.build;
    if (storeBuild !== null && storeBuild.processingState !== 'VALID') {
      let processingState = storeBuild.processingState;
      if (processingState === null) processingState = 'still processing';
      return yield* Effect.fail(
        releaseFailure(
          'validate App Store build',
          storeBuild,
          `Build ${storeBuild.version} is ${processingState} on App Store Connect - wait for it to finish (\`launch status\`), then re-run.`,
        ),
      );
    }
    if (storeBuild?.expired) {
      return yield* Effect.fail(
        releaseFailure(
          'validate App Store build',
          storeBuild,
          `Build ${storeBuild.version} has expired on App Store Connect - upload a fresh build first.`,
        ),
      );
    }
    const selectedVersion = yield* selectReleaseVersion(releaseContext, appId, input);
    if (selectedVersion.idempotentState !== undefined) {
      releaseContext.actions.push({
        description: `version ${selectedVersion.versionString} already ${selectedVersion.idempotentState} - nothing to submit`,
        status: 'skipped',
      });
      return {
        bundleId: input.bundleId,
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
        bundleId: input.bundleId,
        versionId,
        versionString: input.versionString,
        appStoreState: 'PREPARE_FOR_SUBMISSION',
        submitted: false,
        alreadyInReview: false,
        actions: releaseContext.actions,
      };
    }
    if (storeBuild !== null) {
      yield* performReleaseAction(releaseContext, `attach build ${storeBuild.version}`, () =>
        api.selectBuildForVersion(versionId, storeBuild.id),
      );
      yield* applyExportCompliance(
        releaseContext,
        input.bundleId,
        storeBuild,
        input.usesNonExemptEncryption,
      );
    }
    yield* applyReleaseNotes(releaseContext, versionId, input.whatsNew);
    let releaseTypeDescription = `set release type ${input.releaseType}`;
    const versionUpdate: { releaseType: string; earliestReleaseDate?: string } = {
      releaseType: input.releaseType,
    };
    if (input.earliestReleaseDate !== undefined) {
      releaseTypeDescription += ` @ ${input.earliestReleaseDate}`;
      versionUpdate.earliestReleaseDate = input.earliestReleaseDate;
    }
    yield* performReleaseAction(releaseContext, releaseTypeDescription, () =>
      api.updateAppStoreVersion(versionId, versionUpdate),
    );
    yield* applyPhasedRelease(releaseContext, versionId, input.phasedRelease);
    yield* submitForReview(releaseContext, appId, versionId, input.platform);
    return {
      bundleId: input.bundleId,
      versionId,
      versionString: selectedVersion.versionString,
      appStoreState: 'WAITING_FOR_REVIEW',
      submitted: !input.dryRun,
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
      const currentBuild = yield* releaseContext.api
        .findBuild(bundleId, buildNumber)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
      if (currentBuild?.usesNonExemptEncryption === usesNonExemptEncryption) {
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
    yield* releaseContext.api
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
            let message = String(cause);
            if (cause instanceof Error) message = cause.message;
            releaseContext.actions.push({ description, status: 'failed', error: message });
          },
        }),
      );
  });
/**
 * Resolve the version to act on: reuse the one already at this version string (no-op if it's already
 * submitted/approved, error if it's already live), else retarget the open editable version, else create
 * a fresh one. Returns its id ({@link DRY_RUN_ID} when a create was only planned or failed) plus an
 * `idempotentState` set when the caller should stop (already submitted/approved).
 */
const selectReleaseVersion = (
  releaseContext: ReleaseContext,
  appId: string,
  input: ReleaseInput,
): Effect.Effect<
  {
    versionId: string;
    versionString: string;
    idempotentState?: string;
  },
  AppStoreReleaseFailure
> =>
  Effect.gen(function* () {
    const versions = yield* releaseContext.api
      .listAppStoreVersions(appId, input.platform)
      .pipe(Effect.mapError((cause) => releaseFailure('list App Store versions', cause)));
    const sameString = versions.find((version) => version.versionString === input.versionString);
    if (sameString !== undefined) {
      const phase = nextReleaseAction(sameString.appStoreState);
      if (phase === 'live') {
        return yield* Effect.fail(
          releaseFailure(
            'select App Store version',
            sameString,
            `Version ${input.versionString} is already on the App Store (${sameString.appStoreState}). Bump the version in app.json, build, then release again.`,
          ),
        );
      }
      if (phase === 'submitted') {
        return {
          versionId: sameString.id,
          versionString: sameString.versionString,
          idempotentState: sameString.appStoreState,
        };
      }
      if (phase === 'pending-release') {
        return {
          versionId: sameString.id,
          versionString: sameString.versionString,
          idempotentState: sameString.appStoreState,
        };
      }
      return { versionId: sameString.id, versionString: sameString.versionString };
    }
    const editable = versions.find(
      (version) => nextReleaseAction(version.appStoreState) === 'editable',
    );
    if (editable !== undefined) {
      yield* performReleaseAction(
        releaseContext,
        `retarget open version to ${input.versionString}`,
        () =>
          releaseContext.api.updateAppStoreVersion(editable.id, {
            versionString: input.versionString,
          }),
      );
      return { versionId: editable.id, versionString: input.versionString };
    }
    const createInput: {
      versionString: string;
      platform: string;
      releaseType: string;
      earliestReleaseDate?: string;
    } = {
      versionString: input.versionString,
      platform: input.platform,
      releaseType: input.releaseType,
    };
    if (input.earliestReleaseDate !== undefined) {
      createInput.earliestReleaseDate = input.earliestReleaseDate;
    }
    const createdVersion = yield* performReleaseAction(
      releaseContext,
      `create App Store version ${input.versionString}`,
      () => releaseContext.api.createAppStoreVersion(appId, createInput),
    );
    let versionId = DRY_RUN_ID;
    if (createdVersion.actionValue !== undefined) versionId = createdVersion.actionValue.id;
    return {
      versionId,
      versionString: input.versionString,
    };
  });
/** Write each locale's release notes, creating the localization or updating its `whatsNew`. */
const applyReleaseNotes = (
  releaseContext: ReleaseContext,
  versionId: string,
  whatsNew: Record<string, string>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const locales = Object.entries(whatsNew);
    if (locales.length === 0) return;
    if (versionId === DRY_RUN_ID) {
      releaseContext.actions.push({
        description: `set release notes for ${locales.length} locale(s)`,
        status: 'planned',
      });
      return;
    }
    const existingLocalizations = yield* releaseContext.api
      .listAppStoreVersionLocalizations(versionId)
      .pipe(Effect.catchAll(() => Effect.succeed([])));
    yield* Effect.forEach(
      locales,
      ([locale, releaseNotes]) => {
        const existingLocalization = existingLocalizations.find(
          (localization) => localization.locale === locale,
        );
        if (existingLocalization !== undefined) {
          return performReleaseAction(releaseContext, `set release notes [${locale}]`, () =>
            releaseContext.api.updateAppStoreVersionLocalization(
              existingLocalization.id,
              releaseNotes,
            ),
          );
        }
        return performReleaseAction(releaseContext, `set release notes [${locale}]`, () =>
          releaseContext.api.createAppStoreVersionLocalization(versionId, {
            locale,
            whatsNew: releaseNotes,
          }),
        );
      },
      { concurrency: 1, discard: true },
    );
  });
/** Bring the version's phased-release schedule in line with the requested opt-in (create or remove it). */
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
    const existingPhasedRelease = yield* releaseContext.api
      .getPhasedRelease(versionId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    if (phasedReleaseRequested && existingPhasedRelease === null) {
      yield* performReleaseAction(releaseContext, 'enable phased release', () =>
        releaseContext.api.createPhasedRelease(versionId),
      );
      return;
    }
    if (!phasedReleaseRequested && existingPhasedRelease !== null) {
      yield* performReleaseAction(
        releaseContext,
        'disable phased release (immediate 100% rollout)',
        () => releaseContext.api.deletePhasedRelease(existingPhasedRelease.id),
      );
    }
  });
/** Reuse an addable (`READY_FOR_REVIEW`) review submission or open one, add the version, and submit it. */
const submitForReview = (
  releaseContext: ReleaseContext,
  appId: string,
  versionId: string,
  platform: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const reviewSubmissions = yield* releaseContext.api
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
        () => releaseContext.api.createReviewSubmission(appId, platform),
      );
      submissionId = DRY_RUN_ID;
      if (createdSubmission.actionValue !== undefined) {
        submissionId = createdSubmission.actionValue.id;
      }
    }
    const addVersion = () =>
      releaseContext.api.addReviewSubmissionItem(submissionId, versionId).pipe(
        Effect.catchAll((cause) => {
          let message = String(cause);
          if (cause instanceof Error) message = cause.message;
          if (/already|duplicat|exist/i.test(message)) return Effect.void;
          return Effect.fail(cause);
        }),
      );
    yield* performReleaseAction(releaseContext, 'add version to review submission', addVersion);
    yield* performReleaseAction(releaseContext, 'submit for App Store review', () =>
      releaseContext.api.submitReviewSubmission(submissionId),
    );
  });
/** A live read of where an app's current release stands - backs `launch status` and the watch loop. */
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
 * Read the app's most relevant version (an in-flight one over a live one) plus its build processing and
 * phased-release state, and classify a verdict. Throws when the app record is missing.
 */
export const readReleaseStatus = (
  api: AscReleaseApi,
  bundleId: string,
  platform: string,
): Effect.Effect<ReleaseStatus, AppStoreReleaseFailure> =>
  Effect.gen(function* () {
    const appId = yield* api
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
    const versions = yield* api
      .listAppStoreVersions(appId, platform)
      .pipe(Effect.mapError((cause) => releaseFailure('list App Store versions', cause)));
    const version = pickCurrentVersion(versions);
    if (version === null) {
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
      [api.getPhasedRelease(version.id), api.listBuilds(appId, 1)],
      { concurrency: 2 },
    ).pipe(Effect.mapError((cause) => releaseFailure('read App Store release status', cause)));
    let latestBuild: BuildResource | null = null;
    if (storeBuilds[0] !== undefined) latestBuild = storeBuilds[0];
    let buildNumber: string | null = null;
    if (latestBuild?.version !== undefined) buildNumber = latestBuild.version;
    let buildProcessingState: string | null = null;
    if (latestBuild?.processingState !== undefined) {
      buildProcessingState = latestBuild.processingState;
    }
    let phasedReleaseState: string | null = null;
    if (phasedRelease?.phasedReleaseState !== undefined) {
      phasedReleaseState = phasedRelease.phasedReleaseState;
    }
    return {
      bundleId,
      versionString: version.versionString,
      appStoreState: version.appStoreState,
      buildNumber,
      buildProcessingState,
      phasedReleaseState,
      verdict: classifyVerdict(version.appStoreState),
    };
  });
/** The version a developer cares about now: an in-flight one (editable/submitted/pending) over the live one. */
export const pickCurrentVersion = (
  versions: AppStoreVersionResource[],
): AppStoreVersionResource | null => {
  const inFlight = versions.find((version) => nextReleaseAction(version.appStoreState) !== 'live');
  if (inFlight !== undefined) return inFlight;
  const latestVersion = versions[0];
  if (latestVersion === undefined) return null;
  return latestVersion;
};
/** Options for {@link waitForValidBuild}: an injectable sleep keeps the poll loop unit-testable. */
export type WaitOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Effect.Effect<void>;
  onTick?: (state: string) => void;
};
/**
 * Poll a freshly uploaded build until it finishes processing to `VALID`. Throws on `INVALID` (with
 * Apple's state) or when the timeout elapses. The chosen build (with its resource id) is returned so
 * the caller can hand it to {@link releaseApp}.
 */
export const waitForValidBuild = (
  api: AscReleaseApi,
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
      const storeBuild = yield* api
        .findBuildByVersion(appId, buildNumber)
        .pipe(Effect.mapError((cause) => releaseFailure('read App Store build', cause)));
      let state = 'PROCESSING';
      if (storeBuild?.processingState !== undefined && storeBuild.processingState !== null) {
        state = storeBuild.processingState;
      }
      options.onTick?.(state);
      if (storeBuild !== null && state === 'VALID') return storeBuild;
      if (state === 'INVALID') {
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
            `Build ${buildNumber} is still ${state} after ${Math.round(timeoutMs / 60_000)} min. Re-run \`launch release ios --build ${buildNumber}\` once \`launch status\` shows it VALID.`,
          ),
        );
      }
      yield* sleepBetweenPolls(intervalMs);
      waited += intervalMs;
    }
  });
