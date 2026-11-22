import { appRecordMissingMessage } from '../services/stores/apple-store-client.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import type {
  AppStoreVersionResource,
  BuildResource,
  ReviewSubmissionResource,
} from '../types/apple-catalog.ts';
import type { ReleaseType } from '../types/store-surface.ts';

const BUILD_AND_RELEASE_STEP = 'run `launch-store build ios`, then release that build.';

/**
 * Exact App Store Connect surface the release walk needs. Declared here so the state machine is
 * fakeable and documents the client's release methods in one place; AppStoreConnectClient satisfies
 * it structurally.
 */
export type AscReleaseApi = {
  getAppId(bundleId: string): Promise<string | null>;
  /** Used by release command / release-train; kept on the surface for structural client typing. */
  getLatestMarketingVersion(bundleId: string): Promise<string | null>;
  listBuilds(appId: string, limit?: number): Promise<BuildResource[]>;
  findBuild(
    bundleId: string,
    buildNumber: number,
  ): Promise<{ id: string; usesNonExemptEncryption: boolean | null } | null>;
  findBuildByVersion(
    appId: string,
    buildNumber: number,
    marketingVersion?: string,
  ): Promise<BuildResource | null>;
  setBuildUsesNonExemptEncryption(buildId: string, usesNonExemptEncryption: boolean): Promise<void>;
  listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]>;
  createAppStoreVersion(
    appId: string,
    createInput: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource>;
  updateAppStoreVersion(
    versionId: string,
    versionUpdate: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
      copyright?: string;
    },
  ): Promise<void>;
  selectBuildForVersion(versionId: string, buildId: string): Promise<void>;
  listAppStoreVersionLocalizations(
    versionId: string,
  ): Promise<ReadonlyArray<{ id: string; locale: string; whatsNew?: string }>>;
  createAppStoreVersionLocalization(
    versionId: string,
    localizationInput: { locale: string; whatsNew: string },
  ): Promise<unknown>;
  updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void>;
  getPhasedRelease(versionId: string): Promise<{ id: string; phasedReleaseState: string } | null>;
  createPhasedRelease(versionId: string): Promise<unknown>;
  deletePhasedRelease(phasedReleaseId: string): Promise<void>;
  listReviewSubmissions(appId: string, platform: string): Promise<ReviewSubmissionResource[]>;
  createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource>;
  addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void>;
  submitReviewSubmission(submissionId: string): Promise<void>;
  getReviewSubmission(submissionId: string): Promise<ReviewSubmissionResource>;
  /** Used by release-train go-live; kept on the surface for structural client typing. */
  createAppStoreVersionReleaseRequest(versionId: string): Promise<void>;
};

type AppStoreReleaseFailure = Readonly<{
  readonly _tag: 'AppStoreReleaseFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

function makeAppStoreReleaseFailure(fields: {
  operation: string;
  message: string;
  cause: unknown;
}): AppStoreReleaseFailure {
  return {
    _tag: 'AppStoreReleaseFailure',
    operation: fields.operation,
    message: fields.message,
    cause: fields.cause,
  };
}

function releaseFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AppStoreReleaseFailure {
  let message = explicitMessage;

  if (message == null) {
    message = errorMessage(cause);
  }

  const isMessageEmpty = message.length == 0;

  if (isMessageEmpty) {
    message = `${operation} failed.`;
  }

  return makeAppStoreReleaseFailure({ operation, message, cause });
}

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
type ReleasePhase = 'editable' | 'submitted' | 'pending-release' | 'live' | 'blocked';

/** Classify a version's `appStoreState` into the action the release flow may take. Pure. */
export function nextReleaseAction(appStoreState: string): ReleasePhase {
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
}

function isLiveVersion(storeVersion: Readonly<{ appStoreState: string }>): boolean {
  return nextReleaseAction(storeVersion.appStoreState) == 'live';
}

/** Whether any of the app's versions has ever gone live - false while the app is on its first version. */
export function hasReleasedVersion(
  storeVersions: ReadonlyArray<Readonly<{ appStoreState: string }>>,
): boolean {
  return storeVersions.some(isLiveVersion);
}

/** Terminal-or-transient read of where a submitted version stands (`launch-store status` / watch). */
export type ReleaseVerdict = {
  label: string;
  state: 'released' | 'pending-release' | 'in-review' | 'preparing' | 'rejected' | 'unknown';
  done: boolean;
  exitCode: number;
};

/** Map a version's `appStoreState` to a {@link ReleaseVerdict} (`--watch` / exit-code contract). Pure. */
export function classifyVerdict(appStoreState: string): ReleaseVerdict {
  switch (appStoreState) {
    case 'READY_FOR_SALE':
    case 'READY_FOR_DISTRIBUTION':
      return { label: 'Live on the App Store', state: 'released', done: true, exitCode: 0 };
    case 'PENDING_DEVELOPER_RELEASE':
      return {
        label: 'Approved - awaiting your release (`launch-store status`, or the portal)',
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
      const isLabelEmpty = label.length == 0;

      if (isLabelEmpty) {
        label = 'no App Store version yet';
      }

      return {
        label,
        state: 'unknown',
        done: true,
        exitCode: 1,
      };
    }
  }
}

/** Everything {@link releaseApp} needs for one submission (config + flags resolved by the command). */
export type ReleaseInput = {
  bundleId: string;
  platform: string;
  versionString: string;
  releaseType: ReleaseType;
  earliestReleaseDate?: string;
  copyright?: string;
  phasedRelease: boolean;
  usesNonExemptEncryption: boolean;
  whatsNew: Record<string, string>;
  build: BuildResource | null;
  dryRun: boolean;
  /** Attach the build to the editable version and stop before review submission. */
  attachOnly: boolean;
};

/** Where one release step ended: planned (dry-run), or applied / skipped / failed after a real run. */
type ReleaseActionStatus = 'planned' | 'applied' | 'skipped' | 'failed';

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
  /** False for attach-only runs, which stop before review, and for dry runs. */
  submitted: boolean;
  alreadyInReview: boolean;
  actions: ReleaseAction[];
};

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
  appStoreState: string;
  attachedBuildId?: string | undefined;
  appReleasedBefore: boolean;
  idempotentState?: string;
}>;

type PerformedReleaseAction<ActionValue> = {
  status: ReleaseActionStatus;
  actionValue?: ActionValue;
};

/**
 * Record a step and, unless dry-run, perform it. Failures are captured on the action (status
 * `failed`) rather than propagated so the walk keeps going and the summary reports every failure.
 */
async function performReleaseAction<ActionValue>(
  releaseContext: ReleaseContext,
  description: string,
  runAction: () => Promise<ActionValue>,
): Promise<PerformedReleaseAction<ActionValue>> {
  const releaseAction: ReleaseAction = { description, status: 'planned' };
  releaseContext.actions.push(releaseAction);

  if (releaseContext.dryRun) {
    return { status: 'planned' };
  }

  try {
    const actionValue = await runAction();
    releaseAction.status = 'applied';
    return { status: 'applied', actionValue };
  } catch (cause) {
    releaseAction.status = 'failed';
    releaseAction.error = errorMessage(cause);
    return { status: 'failed' };
  }
}

function requireValidStoreBuild(storeBuild: BuildResource): void {
  const isValid = storeBuild.processingState == 'VALID';

  if (isValid == false) {
    let processingState = storeBuild.processingState;
    const isStateMissing = processingState == null;

    if (isStateMissing) {
      processingState = 'still processing';
    }

    throw releaseFailure(
      'validate App Store build',
      storeBuild,
      `Build ${storeBuild.version} is ${processingState} on App Store Connect - wait for it to finish (\`launch-store status\`), then re-run.`,
    );
  }

  if (storeBuild.expired) {
    throw releaseFailure(
      'validate App Store build',
      storeBuild,
      `Build ${storeBuild.version} has expired on App Store Connect - upload a fresh build first.`,
    );
  }
}

function isLiveMarketingVersion(
  buildMarketingVersion: string,
  storeVersion: AppStoreVersionResource,
): boolean {
  const isSameVersion = storeVersion.versionString == buildMarketingVersion;

  if (isSameVersion == false) {
    return false;
  }

  return nextReleaseAction(storeVersion.appStoreState) == 'live';
}

function findLiveMarketingVersion(
  marketingVersion: string,
  storeVersions: ReadonlyArray<AppStoreVersionResource>,
): AppStoreVersionResource | undefined {
  function matchesLiveMarketingVersion(storeVersion: AppStoreVersionResource): boolean {
    return isLiveMarketingVersion(marketingVersion, storeVersion);
  }

  return storeVersions.find(matchesLiveMarketingVersion);
}

/** Apple refuses a build whose marketing version is already live, so stop before any write. */
function checkBuildCanJoinVersion(
  storeBuild: BuildResource,
  storeVersions: ReadonlyArray<AppStoreVersionResource>,
): void {
  const buildMarketingVersion = storeBuild.marketingVersion;
  const isBuildMarketingVersionUnknown = buildMarketingVersion == null;

  if (isBuildMarketingVersionUnknown) {
    return;
  }

  const liveVersion = findLiveMarketingVersion(buildMarketingVersion, storeVersions);
  const isNoLiveVersionFound = liveVersion == null;

  if (isNoLiveVersionFound) {
    return;
  }

  throw releaseFailure(
    'validate App Store build',
    storeBuild,
    `Build ${storeBuild.version} (version ${buildMarketingVersion}) cannot join a new App Store version: App Store version ${liveVersion.versionString} is already live. Next step: create a worktree from tag ios/${buildMarketingVersion}-${storeBuild.version}, set a new marketing version there, ${BUILD_AND_RELEASE_STEP}`,
  );
}

function isAlreadySubmitted(releasePhase: ReleasePhase): boolean {
  if (releasePhase == 'submitted') {
    return true;
  }

  return releasePhase == 'pending-release';
}

function wasSubmittedForReview(isAttachOnly: boolean, dryRun: boolean): boolean {
  if (isAttachOnly) {
    return false;
  }

  return dryRun == false;
}

function releaseStateAfterRun(isAttachOnly: boolean, currentState: string): string {
  if (isAttachOnly) {
    return currentState;
  }

  return 'WAITING_FOR_REVIEW';
}

/**
 * Drive one App Store version to "submitted for review", idempotently. Reuses, retargets, or creates
 * the editable version; attaches build; declares export compliance; writes notes; sets release type /
 * phased rollout; submits via Apple's review-submission model. With `releaseInput.attachOnly` it stops
 * before that submit, leaving the version editable. With `releaseInput.dryRun` records
 * planned steps and performs no writes. Fails only on preconditions the user must fix (no app record,
 * build not VALID/expired, build's marketing version already live, version already live); every other
 * step is captured per-action so one failure never aborts the rest.
 */
export async function releaseApp(
  appleReleaseApi: AscReleaseApi,
  releaseInput: ReleaseInput,
): Promise<ReleaseReport> {
  const releaseContext: ReleaseContext = {
    appleReleaseApi,
    actions: [],
    dryRun: releaseInput.dryRun,
  };
  let appId: string | null;

  try {
    appId = await appleReleaseApi.getAppId(releaseInput.bundleId);
  } catch (cause) {
    throw releaseFailure('find App Store app', cause);
  }

  const foundAppId = appId;
  const isAppMissing = foundAppId == null;

  if (isAppMissing) {
    const appMissingMessage = appRecordMissingMessage(releaseInput.bundleId);
    throw releaseFailure('find App Store app', releaseInput.bundleId, appMissingMessage);
  }

  const storeBuild = releaseInput.build;
  const hasStoreBuild = storeBuild != null;

  if (hasStoreBuild) {
    requireValidStoreBuild(storeBuild);
  }

  let storeVersions: AppStoreVersionResource[];

  try {
    storeVersions = await appleReleaseApi.listAppStoreVersions(foundAppId, releaseInput.platform);
  } catch (cause) {
    throw releaseFailure('list App Store versions', cause);
  }

  if (hasStoreBuild) {
    checkBuildCanJoinVersion(storeBuild, storeVersions);
  }

  const selectedVersion = await selectReleaseVersion(releaseContext, releaseInput, {
    appId: foundAppId,
    storeVersions,
  });
  const isAlreadyInReview = selectedVersion.idempotentState != null;

  if (isAlreadyInReview) {
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
  const isCreateMissing = versionId == DRY_RUN_ID;
  const isRealRun = releaseContext.dryRun == false;

  if (isRealRun) {
    if (isCreateMissing) {
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
  }

  const isAttachOnly = releaseInput.attachOnly;
  const isBuildAlreadyAttached = isAttachedBuild(hasStoreBuild, selectedVersion, storeBuild);
  const isAttachNoOp = isAttachOnly;

  if (isAttachNoOp) {
    if (isBuildAlreadyAttached) {
      releaseContext.actions.push({
        description: `build already attached to version ${selectedVersion.versionString} - nothing to change`,
        status: 'skipped',
      });
      return {
        bundleId: releaseInput.bundleId,
        versionId,
        versionString: selectedVersion.versionString,
        appStoreState: selectedVersion.appStoreState,
        submitted: false,
        alreadyInReview: false,
        actions: releaseContext.actions,
      };
    }
  }

  if (hasStoreBuild) {
    await performReleaseAction(
      releaseContext,
      `attach build ${storeBuild.version}`,
      function attachBuild() {
        return appleReleaseApi.selectBuildForVersion(versionId, storeBuild.id);
      },
    );
    await applyExportCompliance(
      releaseContext,
      releaseInput.bundleId,
      storeBuild,
      releaseInput.usesNonExemptEncryption,
    );
  }

  await applyReleaseNotes(
    releaseContext,
    versionId,
    releaseInput.whatsNew,
    selectedVersion.appReleasedBefore,
  );
  const versionUpdate = readVersionUpdate(releaseInput);
  await performReleaseAction(releaseContext, versionUpdate.description, function updateVersion() {
    return appleReleaseApi.updateAppStoreVersion(versionId, versionUpdate.versionUpdate);
  });
  await applyPhasedRelease(releaseContext, versionId, releaseInput.phasedRelease);

  if (isAttachOnly == false) {
    await submitForReview(releaseContext, foundAppId, versionId, releaseInput.platform);
  }

  return {
    bundleId: releaseInput.bundleId,
    versionId,
    versionString: selectedVersion.versionString,
    appStoreState: releaseStateAfterRun(isAttachOnly, selectedVersion.appStoreState),
    submitted: wasSubmittedForReview(isAttachOnly, releaseInput.dryRun),
    alreadyInReview: false,
    actions: releaseContext.actions,
  };
}

function isAttachedBuild(
  hasStoreBuild: boolean,
  selectedVersion: SelectedReleaseVersion,
  storeBuild: BuildResource | null,
): boolean {
  if (hasStoreBuild == false) {
    return false;
  }

  if (storeBuild == null) {
    return false;
  }

  return selectedVersion.attachedBuildId == storeBuild.id;
}

function readVersionUpdate(releaseInput: ReleaseInput): {
  description: string;
  versionUpdate: { releaseType: string; earliestReleaseDate?: string; copyright?: string };
} {
  let description = `set release type ${releaseInput.releaseType}`;
  const versionUpdate: { releaseType: string; earliestReleaseDate?: string; copyright?: string } = {
    releaseType: releaseInput.releaseType,
  };
  const earliestReleaseDate = releaseInput.earliestReleaseDate;

  if (earliestReleaseDate != null) {
    description += ` @ ${earliestReleaseDate}`;
    versionUpdate.earliestReleaseDate = earliestReleaseDate;
  }

  const copyright = releaseInput.copyright;

  if (copyright != null) {
    const hasCopyrightText = copyright.length > 0;

    if (hasCopyrightText) {
      description += `, copyright "${copyright}"`;
      versionUpdate.copyright = copyright;
    }
  }

  return { description, versionUpdate };
}

function hasConflictStatus(cause: object): boolean {
  const hasStatus = 'status' in cause;

  if (hasStatus == false) {
    return true;
  }

  const status = cause.status;
  return status == 409;
}

function isExportComplianceAlreadySetError(cause: unknown): boolean {
  const isError = cause instanceof Error;

  if (isError == false) {
    return false;
  }

  const message = cause.message.toLowerCase();
  const cannotUpdate = message.includes('cannot update when the value is already set');

  if (cannotUpdate) {
    return hasConflictStatus(cause);
  }

  const mentionsAlreadySet = message.includes('already set');

  if (mentionsAlreadySet == false) {
    return false;
  }

  const mentionsConflict = message.includes('409');

  if (mentionsConflict == false) {
    return false;
  }

  return hasConflictStatus(cause);
}

/** Declare export compliance only when App Store Connect has not already stored the desired answer. */
async function applyExportCompliance(
  releaseContext: ReleaseContext,
  bundleId: string,
  storeBuild: BuildResource,
  usesNonExemptEncryption: boolean,
): Promise<void> {
  const description = `declare export compliance (usesNonExemptEncryption=${String(usesNonExemptEncryption)})`;
  const buildNumber = Number.parseInt(storeBuild.version, 10);
  const isBuildNumber = Number.isNaN(buildNumber) == false;

  if (isBuildNumber) {
    let currentBuild: { id: string; usesNonExemptEncryption: boolean | null } | null = null;

    try {
      currentBuild = await releaseContext.appleReleaseApi.findBuild(bundleId, buildNumber);
    } catch {
      currentBuild = null;
    }

    if (currentBuild != null) {
      const isAlreadyAnswered = currentBuild.usesNonExemptEncryption == usesNonExemptEncryption;

      if (isAlreadyAnswered) {
        releaseContext.actions.push({
          description,
          status: 'skipped',
          note: 'already answered on this build',
        });
        return;
      }
    }
  }

  if (releaseContext.dryRun) {
    releaseContext.actions.push({ description, status: 'planned' });
    return;
  }

  try {
    await releaseContext.appleReleaseApi.setBuildUsesNonExemptEncryption(
      storeBuild.id,
      usesNonExemptEncryption,
    );
    releaseContext.actions.push({ description, status: 'applied' });
  } catch (cause) {
    const isAlreadySet = isExportComplianceAlreadySetError(cause);

    if (isAlreadySet) {
      releaseContext.actions.push({
        description,
        status: 'skipped',
        note: 'already answered on this build',
      });
      return;
    }

    const failureMessage = errorMessage(cause);
    releaseContext.actions.push({
      description,
      status: 'failed',
      error: failureMessage,
    });
  }
}

function matchingVersion(versionString: string, storeVersion: AppStoreVersionResource): boolean {
  return storeVersion.versionString == versionString;
}

function isEditableVersion(storeVersion: AppStoreVersionResource): boolean {
  return nextReleaseAction(storeVersion.appStoreState) == 'editable';
}

/**
 * Resolve the version to act on: reuse the one already at this version string (no-op if already
 * submitted/approved, error if live), else retarget the open editable version, else create a fresh
 * one. Returns its id ({@link DRY_RUN_ID} when create was only planned or failed) plus
 * `idempotentState` when the caller should stop (already submitted/approved).
 */
async function selectReleaseVersion(
  releaseContext: ReleaseContext,
  releaseInput: ReleaseInput,
  versionLookup: Readonly<{ appId: string; storeVersions: ReadonlyArray<AppStoreVersionResource> }>,
): Promise<SelectedReleaseVersion> {
  const appReleasedBefore = hasReleasedVersion(versionLookup.storeVersions);

  function hasMatchingVersion(storeVersion: AppStoreVersionResource): boolean {
    return matchingVersion(releaseInput.versionString, storeVersion);
  }

  const foundVersion = versionLookup.storeVersions.find(hasMatchingVersion);
  const hasFoundVersion = foundVersion != null;

  if (hasFoundVersion) {
    return reuseMatchingVersion(foundVersion, releaseInput, appReleasedBefore);
  }

  const editableVersion = versionLookup.storeVersions.find(isEditableVersion);
  const hasEditableVersion = editableVersion != null;

  if (hasEditableVersion) {
    await performReleaseAction(
      releaseContext,
      `retarget open version to ${releaseInput.versionString}`,
      function retargetVersion() {
        return releaseContext.appleReleaseApi.updateAppStoreVersion(editableVersion.id, {
          versionString: releaseInput.versionString,
        });
      },
    );
    return {
      versionId: editableVersion.id,
      versionString: releaseInput.versionString,
      appStoreState: editableVersion.appStoreState,
      attachedBuildId: editableVersion.attachedBuildId,
      appReleasedBefore,
    };
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
  const earliestReleaseDate = releaseInput.earliestReleaseDate;

  if (earliestReleaseDate != null) {
    createInput.earliestReleaseDate = earliestReleaseDate;
  }

  const createdVersion = await performReleaseAction(
    releaseContext,
    `create App Store version ${releaseInput.versionString}`,
    function createVersion() {
      return releaseContext.appleReleaseApi.createAppStoreVersion(versionLookup.appId, createInput);
    },
  );
  let versionId = DRY_RUN_ID;
  const createdResource = createdVersion.actionValue;

  if (createdResource != null) {
    versionId = createdResource.id;
  }

  return {
    versionId,
    versionString: releaseInput.versionString,
    appStoreState: 'PREPARE_FOR_SUBMISSION',
    appReleasedBefore,
  };
}

function reuseMatchingVersion(
  matchingStoreVersion: AppStoreVersionResource,
  releaseInput: ReleaseInput,
  appReleasedBefore: boolean,
): SelectedReleaseVersion {
  const releasePhase = nextReleaseAction(matchingStoreVersion.appStoreState);
  const isLive = releasePhase == 'live';

  if (isLive) {
    throw releaseFailure(
      'select App Store version',
      matchingStoreVersion,
      `Version ${releaseInput.versionString} is already on the App Store (${matchingStoreVersion.appStoreState}). Next step: set a new marketing version in app.json, ${BUILD_AND_RELEASE_STEP}`,
    );
  }

  const isBlocked = releasePhase == 'blocked';

  if (isBlocked) {
    throw releaseFailure(
      'select App Store version',
      matchingStoreVersion,
      `Version ${releaseInput.versionString} is in state ${matchingStoreVersion.appStoreState}, which launch-store will not change. Resolve it in App Store Connect, then release again.`,
    );
  }

  const selectedVersion: SelectedReleaseVersion = {
    versionId: matchingStoreVersion.id,
    versionString: matchingStoreVersion.versionString,
    appStoreState: matchingStoreVersion.appStoreState,
    attachedBuildId: matchingStoreVersion.attachedBuildId,
    appReleasedBefore,
  };
  const isIdempotent = isAlreadySubmitted(releasePhase);

  if (isIdempotent == false) {
    return selectedVersion;
  }

  return { ...selectedVersion, idempotentState: matchingStoreVersion.appStoreState };
}

type VersionLocalization = { id: string; locale: string; whatsNew?: string };

/**
 * Write each locale's release notes, creating the localization or updating its `whatsNew`. Skipped on
 * an app's first version: Apple refuses `whatsNew` there (409 "cannot be edited at this time").
 */
async function applyReleaseNotes(
  releaseContext: ReleaseContext,
  versionId: string,
  whatsNew: Record<string, string>,
  appReleasedBefore: boolean,
): Promise<void> {
  const localeEntries = Object.entries(whatsNew);
  const hasNoNotes = localeEntries.length == 0;

  if (hasNoNotes) {
    return;
  }

  const allNotesDescription = `set release notes for ${localeEntries.length} locale(s)`;

  if (appReleasedBefore == false) {
    releaseContext.actions.push({
      description: allNotesDescription,
      status: 'skipped',
      note: "first version - Apple shows What's New only on updates",
    });
    return;
  }

  const isVersionUncreated = versionId == DRY_RUN_ID;

  if (isVersionUncreated) {
    releaseContext.actions.push({ description: allNotesDescription, status: 'planned' });
    return;
  }

  let existingLocalizations: ReadonlyArray<VersionLocalization> = [];

  try {
    existingLocalizations =
      await releaseContext.appleReleaseApi.listAppStoreVersionLocalizations(versionId);
  } catch {
    existingLocalizations = [];
  }

  for (const [locale, releaseNotes] of localeEntries) {
    function hasLocale(localization: VersionLocalization): boolean {
      return localization.locale == locale;
    }

    const existingLocalization = existingLocalizations.find(hasLocale);

    if (existingLocalization != null) {
      await performReleaseAction(
        releaseContext,
        `set release notes [${locale}]`,
        function updateNotes() {
          return releaseContext.appleReleaseApi.updateAppStoreVersionLocalization(
            existingLocalization.id,
            releaseNotes,
          );
        },
      );
      continue;
    }

    await performReleaseAction(
      releaseContext,
      `set release notes [${locale}]`,
      function createNotes() {
        return releaseContext.appleReleaseApi.createAppStoreVersionLocalization(versionId, {
          locale,
          whatsNew: releaseNotes,
        });
      },
    );
  }
}

/** Align the version's phased-release schedule with the requested opt-in (create or remove). */
async function applyPhasedRelease(
  releaseContext: ReleaseContext,
  versionId: string,
  phasedReleaseRequested: boolean,
): Promise<void> {
  const isVersionUncreated = versionId == DRY_RUN_ID;

  if (isVersionUncreated) {
    if (phasedReleaseRequested) {
      releaseContext.actions.push({ description: 'enable phased release', status: 'planned' });
    }

    return;
  }

  let existingPhasedRelease: { id: string; phasedReleaseState: string } | null = null;

  try {
    existingPhasedRelease = await releaseContext.appleReleaseApi.getPhasedRelease(versionId);
  } catch {
    existingPhasedRelease = null;
  }

  const isPhasedReleaseMissing = existingPhasedRelease == null;

  if (phasedReleaseRequested) {
    if (isPhasedReleaseMissing) {
      await performReleaseAction(
        releaseContext,
        'enable phased release',
        function enablePhasedRelease() {
          return releaseContext.appleReleaseApi.createPhasedRelease(versionId);
        },
      );
      return;
    }
  }

  if (phasedReleaseRequested) {
    return;
  }

  if (existingPhasedRelease == null) {
    return;
  }

  const phasedReleaseId = existingPhasedRelease.id;
  await performReleaseAction(
    releaseContext,
    'disable phased release (immediate 100% rollout)',
    function disablePhasedRelease() {
      return releaseContext.appleReleaseApi.deletePhasedRelease(phasedReleaseId);
    },
  );
}

function isReadyForReview(submission: ReviewSubmissionResource): boolean {
  return submission.state == 'READY_FOR_REVIEW';
}

function isDuplicateReviewItem(cause: unknown): boolean {
  const failureText = errorMessage(cause);
  // Apple says the version is already on the submission.
  return /already|duplicat|exist/i.test(failureText);
}

/** Reuse an addable (`READY_FOR_REVIEW`) review submission or open one, add the version, and submit. */
async function submitForReview(
  releaseContext: ReleaseContext,
  appId: string,
  versionId: string,
  platform: string,
): Promise<void> {
  let reviewSubmissions: ReviewSubmissionResource[] = [];

  try {
    reviewSubmissions = await releaseContext.appleReleaseApi.listReviewSubmissions(appId, platform);
  } catch {
    reviewSubmissions = [];
  }

  const openSubmission = reviewSubmissions.find(isReadyForReview);
  let submissionId = DRY_RUN_ID;

  if (openSubmission != null) {
    submissionId = openSubmission.id;
  }

  if (openSubmission == null) {
    const createdSubmission = await performReleaseAction(
      releaseContext,
      'open review submission',
      function openReview() {
        return releaseContext.appleReleaseApi.createReviewSubmission(appId, platform);
      },
    );
    const createdResource = createdSubmission.actionValue;

    if (createdResource != null) {
      submissionId = createdResource.id;
    }
  }

  await performReleaseAction(
    releaseContext,
    'add version to review submission',
    function addVersion() {
      return addReviewItem(releaseContext.appleReleaseApi, submissionId, versionId);
    },
  );
  await performReleaseAction(
    releaseContext,
    'submit for App Store review',
    function submitReview() {
      return releaseContext.appleReleaseApi.submitReviewSubmission(submissionId);
    },
  );
}

async function addReviewItem(
  appleReleaseApi: AscReleaseApi,
  submissionId: string,
  versionId: string,
): Promise<void> {
  try {
    await appleReleaseApi.addReviewSubmissionItem(submissionId, versionId);
  } catch (cause) {
    const isAlreadyAdded = isDuplicateReviewItem(cause);

    if (isAlreadyAdded) {
      return;
    }

    throw cause;
  }
}

/** Live read of where an app's current release stands - backs `launch-store status` and the watch loop. */
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
export async function readReleaseStatus(
  appleReleaseApi: AscReleaseApi,
  bundleId: string,
  platform: string,
): Promise<ReleaseStatus> {
  const appId = await readAppStoreAppId(appleReleaseApi, bundleId);
  return readReleaseStatusForApp(appleReleaseApi, appId, bundleId, platform);
}

export async function readAppStoreAppId(
  appleReleaseApi: AscReleaseApi,
  bundleId: string,
): Promise<string> {
  let appId: string | null;

  try {
    appId = await appleReleaseApi.getAppId(bundleId);
  } catch (cause) {
    throw releaseFailure('find App Store app', cause);
  }

  const foundAppId = appId;
  const isThereNoAppRecord = foundAppId == null;

  if (isThereNoAppRecord) {
    const appMissingMessage = appRecordMissingMessage(bundleId, 'launch-store status');
    throw releaseFailure('find App Store app', bundleId, appMissingMessage);
  }

  return foundAppId;
}

export async function readReleaseStatusForApp(
  appleReleaseApi: AscReleaseApi,
  appId: string,
  bundleId: string,
  platform: string,
): Promise<ReleaseStatus> {
  let storeVersions: AppStoreVersionResource[];

  try {
    storeVersions = await appleReleaseApi.listAppStoreVersions(appId, platform);
  } catch (cause) {
    throw releaseFailure('list App Store versions', cause);
  }

  const currentVersion = pickCurrentVersion(storeVersions);
  const isThereNoCurrentVersion = currentVersion == null;

  if (isThereNoCurrentVersion) {
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

  let phasedRelease: { id: string; phasedReleaseState: string } | null;

  try {
    phasedRelease = await appleReleaseApi.getPhasedRelease(currentVersion.id);
  } catch (cause) {
    throw releaseFailure('read App Store release status', cause);
  }

  let buildNumber: string | null = null;
  const attachedBuildNumber = currentVersion.attachedBuildNumber;

  if (attachedBuildNumber != null) {
    buildNumber = attachedBuildNumber;
  }

  let buildProcessingState: string | null = null;
  const attachedBuildProcessingState = currentVersion.attachedBuildProcessingState;

  if (attachedBuildProcessingState != null) {
    buildProcessingState = attachedBuildProcessingState;
  }

  let phasedReleaseState: string | null = null;

  if (phasedRelease != null) {
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
}

function isInFlightVersion(storeVersion: AppStoreVersionResource): boolean {
  return nextReleaseAction(storeVersion.appStoreState) != 'live';
}

/** Version a developer cares about now: in-flight (editable/submitted/pending) over live. */
export function pickCurrentVersion(
  storeVersions: AppStoreVersionResource[],
): AppStoreVersionResource | null {
  const inFlightVersion = storeVersions.find(isInFlightVersion);

  if (inFlightVersion != null) {
    return inFlightVersion;
  }

  const latestVersion = storeVersions[0];

  if (latestVersion == null) {
    return null;
  }

  return latestVersion;
}

/** Options for {@link waitForValidBuild}: injectable sleep keeps the poll loop unit-testable. */
type WaitOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onTick?: (processingState: string) => Promise<void> | void;
  // Picks this version's build when another version reused the same build number.
  marketingVersion?: string;
};

function sleepMilliseconds(milliseconds: number): Promise<void> {
  return new Promise(function wakeAfterDelay(wakeUp) {
    setTimeout(wakeUp, milliseconds);
  });
}

function isRejectedProcessing(processingState: string): boolean {
  if (processingState == 'INVALID') {
    return true;
  }

  return processingState == 'FAILED';
}

/**
 * Poll a freshly uploaded build until processing reaches `VALID`. Fails on `INVALID`, `FAILED` or timeout.
 * Returns the chosen build so the caller can hand it to {@link releaseApp}.
 */
export async function waitForValidBuild(
  appleReleaseApi: AscReleaseApi,
  appId: string,
  buildNumber: number,
  options: WaitOptions = {},
): Promise<BuildResource> {
  let intervalMs = 15_000;

  if (options.intervalMs != null) {
    intervalMs = options.intervalMs;
  }

  const defaultTimeoutMs = 30 * 60_000;
  let timeoutMs = defaultTimeoutMs;

  if (options.timeoutMs != null) {
    timeoutMs = options.timeoutMs;
  }

  let sleepBetweenPolls = sleepMilliseconds;

  if (options.sleep != null) {
    sleepBetweenPolls = options.sleep;
  }

  let waited = 0;
  const timeoutMinutes = Math.round(timeoutMs / 60_000);

  for (;;) {
    let storeBuild: BuildResource | null;

    try {
      storeBuild = await appleReleaseApi.findBuildByVersion(
        appId,
        buildNumber,
        options.marketingVersion,
      );
    } catch (cause) {
      throw releaseFailure('read App Store build', cause);
    }

    let processingState = 'PROCESSING';

    if (storeBuild != null) {
      processingState = storeBuild.processingState;
    }

    const onTick = options.onTick;
    const isProgressReported = onTick != null;

    if (isProgressReported) {
      await onTick(processingState);
    }

    const isProcessingValid = processingState == 'VALID';

    if (storeBuild != null) {
      if (isProcessingValid) {
        return storeBuild;
      }
    }

    const isProcessingRejected = isRejectedProcessing(processingState);

    if (isProcessingRejected) {
      throw releaseFailure(
        'wait for App Store build',
        storeBuild,
        `Build ${buildNumber} failed App Store Connect processing (${processingState}) - check the email Apple sent.`,
      );
    }

    const isTimedOut = waited >= timeoutMs;
    const isBuildMissing = storeBuild == null;

    if (isTimedOut) {
      if (isBuildMissing) {
        throw releaseFailure(
          'wait for App Store build',
          storeBuild,
          `Build ${buildNumber} was not found on App Store Connect after ${timeoutMinutes} min - check that the upload finished.`,
        );
      }

      throw releaseFailure(
        'wait for App Store build',
        storeBuild,
        `Build ${buildNumber} is still ${processingState} after ${timeoutMinutes} min. Re-run \`launch-store release ios --build ${buildNumber}\` once \`launch-store status\` shows it VALID.`,
      );
    }

    await sleepBetweenPolls(intervalMs);
    waited += intervalMs;
  }
}
