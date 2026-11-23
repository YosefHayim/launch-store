import { describe, expect, it, vi } from 'vitest';
import type { AppStoreVersionResource, BuildResource } from '../types/apple-catalog.ts';
import {
  classifyVerdict,
  IOS_PLATFORM,
  nextReleaseAction,
  pickCurrentVersion,
  readReleaseStatus,
  releaseApp,
  waitForValidBuild,
  type AscReleaseApi,
  type ReleaseInput,
} from './app-store-release.ts';

const LIVE_VERSION = {
  id: 'v-live',
  versionString: '1.1.0',
  appStoreState: 'READY_FOR_SALE',
};

function makeReleaseApiFake(methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  const baseApi: AscReleaseApi = {
    getAppId: vi.fn(function readAppId() {
      return Promise.resolve('app1');
    }),
    getLatestMarketingVersion: vi.fn(function readMarketingVersion() {
      return Promise.resolve(null);
    }),
    listBuilds: vi.fn(function readBuilds() {
      return Promise.resolve([]);
    }),
    findBuild: vi.fn(function readBuild() {
      return Promise.resolve({ id: 'b-1', usesNonExemptEncryption: null });
    }),
    findBuildByVersion: vi.fn(function readBuildByVersion() {
      return Promise.resolve(null);
    }),
    setBuildUsesNonExemptEncryption: vi.fn(function setEncryption() {
      return Promise.resolve();
    }),
    listAppStoreVersions: vi.fn(function readVersions() {
      return Promise.resolve([LIVE_VERSION]);
    }),
    createAppStoreVersion: vi.fn(function createVersion(
      _appId: string,
      createInput: { versionString: string },
    ) {
      return Promise.resolve({
        id: 'v-new',
        versionString: createInput.versionString,
        appStoreState: 'PREPARE_FOR_SUBMISSION',
      });
    }),
    updateAppStoreVersion: vi.fn(function updateVersion() {
      return Promise.resolve();
    }),
    selectBuildForVersion: vi.fn(function selectBuild() {
      return Promise.resolve();
    }),
    listAppStoreVersionLocalizations: vi.fn(function readLocalizations() {
      return Promise.resolve([]);
    }),
    createAppStoreVersionLocalization: vi.fn(function createLocalization() {
      return Promise.resolve({ id: 'loc-new', locale: 'en-US' });
    }),
    updateAppStoreVersionLocalization: vi.fn(function updateLocalization() {
      return Promise.resolve();
    }),
    getPhasedRelease: vi.fn(function readPhasedRelease() {
      return Promise.resolve(null);
    }),
    createPhasedRelease: vi.fn(function createPhasedRelease() {
      return Promise.resolve({ id: 'ph-new', phasedReleaseState: 'ACTIVE' });
    }),
    deletePhasedRelease: vi.fn(function deletePhasedRelease() {
      return Promise.resolve();
    }),
    listReviewSubmissions: vi.fn(function readReviewSubmissions() {
      return Promise.resolve([]);
    }),
    createReviewSubmission: vi.fn(function createReviewSubmission() {
      return Promise.resolve({ id: 'rs1', state: 'READY_FOR_REVIEW' });
    }),
    addReviewSubmissionItem: vi.fn(function addReviewItem() {
      return Promise.resolve();
    }),
    submitReviewSubmission: vi.fn(function submitReview() {
      return Promise.resolve();
    }),
    getReviewSubmission: vi.fn(function readReviewSubmission() {
      return Promise.resolve({ id: 'rs1', state: 'WAITING_FOR_REVIEW' });
    }),
    createAppStoreVersionReleaseRequest: vi.fn(function releaseVersion() {
      return Promise.resolve();
    }),
  };
  return { ...baseApi, ...methodOverrides };
}

function runRelease(appleReleaseApi: AscReleaseApi, releaseInput: ReleaseInput) {
  return releaseApp(appleReleaseApi, releaseInput);
}

const VALID_BUILD: BuildResource = {
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
};

function releaseInput(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
  return {
    bundleId: 'com.acme.app',
    platform: IOS_PLATFORM,
    versionString: '1.2.0',
    releaseType: 'AFTER_APPROVAL',
    phasedRelease: false,
    usesNonExemptEncryption: false,
    whatsNew: { 'en-US': 'Bug fixes.' },
    build: VALID_BUILD,
    dryRun: false,
    attachOnly: false,
    ...overrides,
  };
}
function describeNextReleaseActionTheAppStorePieceTransitionTable() {
  function classifiesEachLifecyclePieceIntoTheActionItPermits() {
    expect(nextReleaseAction('PREPARE_FOR_SUBMISSION')).toBe('editable');
    expect(nextReleaseAction('DEVELOPER_REJECTED')).toBe('editable');
    expect(nextReleaseAction('REJECTED')).toBe('editable');
    expect(nextReleaseAction('WAITING_FOR_REVIEW')).toBe('submitted');
    expect(nextReleaseAction('IN_REVIEW')).toBe('submitted');
    expect(nextReleaseAction('PENDING_DEVELOPER_RELEASE')).toBe('pending-release');
    expect(nextReleaseAction('READY_FOR_SALE')).toBe('live');
    expect(nextReleaseAction('SOME_FUTURE_STATE')).toBe('blocked');
  }

  it(
    'classifies each lifecycle state into the action it permits',
    classifiesEachLifecyclePieceIntoTheActionItPermits,
  );
}

describe(
  'nextReleaseAction - the appStoreState transition table',
  describeNextReleaseActionTheAppStorePieceTransitionTable,
);
function describeClassifyVerdictTheWatchExitCodeContract() {
  function mapsStatesToVerdictsWithTheDocumentedExitCodes() {
    const verdict = classifyVerdict('READY_FOR_SALE');
    expect(verdict).toMatchObject({
      state: 'released',
      done: true,
      exitCode: 0,
    });
    expect(classifyVerdict('PENDING_DEVELOPER_RELEASE')).toMatchObject({
      state: 'pending-release',
      done: true,
      exitCode: 0,
    });
    expect(classifyVerdict('IN_REVIEW')).toMatchObject({
      state: 'in-review',
      done: false,
      exitCode: 3,
    });
    expect(classifyVerdict('WAITING_FOR_REVIEW')).toMatchObject({ done: false, exitCode: 3 });
    expect(classifyVerdict('REJECTED')).toMatchObject({
      state: 'rejected',
      done: true,
      exitCode: 2,
    });
    expect(classifyVerdict('SOMETHING_ELSE')).toMatchObject({ state: 'unknown', exitCode: 1 });
  }

  it(
    'maps states to verdicts with the documented exit codes',
    mapsStatesToVerdictsWithTheDocumentedExitCodes,
  );
}

describe(
  'classifyVerdict - the --watch / exit-code contract',
  describeClassifyVerdictTheWatchExitCodeContract,
);
function describeReleaseAppSubmitAnUpdateOverTheAPI() {
  async function createsTheVersionAttachesTheBuildDeclaresComplianceWritesNotesAndSubmits() {
    const api = makeReleaseApiFake();
    const report = await runRelease(api, releaseInput());
    expect(api.createAppStoreVersion).toHaveBeenCalledWith(
      'app1',
      expect.objectContaining({
        versionString: '1.2.0',
        platform: IOS_PLATFORM,
        releaseType: 'AFTER_APPROVAL',
      }),
    );
    expect(api.selectBuildForVersion).toHaveBeenCalledWith('v-new', 'b-1');
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith('b-1', false);
    expect(api.createAppStoreVersionLocalization).toHaveBeenCalledWith('v-new', {
      locale: 'en-US',
      whatsNew: 'Bug fixes.',
    });
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith('v-new', {
      releaseType: 'AFTER_APPROVAL',
    });
    expect(api.addReviewSubmissionItem).toHaveBeenCalledWith('rs1', 'v-new');
    expect(api.submitReviewSubmission).toHaveBeenCalledWith('rs1');
    expect(report).toMatchObject({
      submitted: true,
      alreadyInReview: false,
      appStoreState: 'WAITING_FOR_REVIEW',
    });
  }

  it(
    'creates the version, attaches the build, declares compliance, writes notes, and submits',
    createsTheVersionAttachesTheBuildDeclaresComplianceWritesNotesAndSubmits,
  );
  async function updatesAnExistingLocalizationSNotesInsteadOfCreatingADuplicate() {
    const fulfilled = Promise.resolve([
      { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
      LIVE_VERSION,
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
      listAppStoreVersionLocalizations: vi
        .fn()
        .mockReturnValue(Promise.resolve([{ id: 'loc-1', locale: 'en-US', whatsNew: 'old' }])),
    });
    await runRelease(api, releaseInput());
    expect(api.updateAppStoreVersionLocalization).toHaveBeenCalledWith('loc-1', 'Bug fixes.');
    expect(api.createAppStoreVersionLocalization).not.toHaveBeenCalled();
  }

  it(
    "updates an existing localization's notes instead of creating a duplicate",
    updatesAnExistingLocalizationSNotesInsteadOfCreatingADuplicate,
  );
  async function skipsReleaseNotesOnTheAppSFirstVersionAppleHasNoWhatSNewThere() {
    const fulfilled = Promise.resolve([
      { id: 'v1', versionString: '1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    const report = await runRelease(api, releaseInput({ versionString: '1.0' }));
    expect(api.listAppStoreVersionLocalizations).not.toHaveBeenCalled();
    expect(api.createAppStoreVersionLocalization).not.toHaveBeenCalled();
    expect(api.updateAppStoreVersionLocalization).not.toHaveBeenCalled();
    function findAction(action: {
      description: string;
      status: 'skipped' | 'planned' | 'applied' | 'failed';
      error?: string;
      note?: string;
    }) {
      return action.description.startsWith('set release notes');
    }

    const notesAction = report.actions.find(findAction);
    expect(notesAction).toMatchObject({
      status: 'skipped',
      note: expect.stringContaining('first version'),
    });
    expect(api.submitReviewSubmission).toHaveBeenCalledWith('rs1');
  }

  it(
    "skips release notes on the app's first version (Apple has no What's New there)",
    skipsReleaseNotesOnTheAppSFirstVersionAppleHasNoWhatSNewThere,
  );
  async function sendsReleaseCopyrightInTheVersionPATCHWithTheReleaseType() {
    const api = makeReleaseApiFake();
    const report = await runRelease(api, releaseInput({ copyright: '2026 Acme Inc.' }));
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith('v-new', {
      releaseType: 'AFTER_APPROVAL',
      copyright: '2026 Acme Inc.',
    });
    function readDescription(action: {
      description: string;
      status: 'skipped' | 'planned' | 'applied' | 'failed';
      error?: string;
      note?: string;
    }) {
      return action.description;
    }

    expect(report.actions.map(readDescription)).toContain(
      'set release type AFTER_APPROVAL, copyright "2026 Acme Inc."',
    );
  }

  it(
    'sends release.copyright in the version PATCH with the release type',
    sendsReleaseCopyrightInTheVersionPATCHWithTheReleaseType,
  );
  async function retargetsTheOpenEditableVersionWhenItsVersionStringDiffersOneEditableAllowedAtATime() {
    const fulfilled = Promise.resolve([
      { id: 'v5', versionString: '1.1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    await runRelease(api, releaseInput({ versionString: '1.2.0' }));
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith('v5', { versionString: '1.2.0' });
    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
  }

  it(
    'retargets the open editable version when its version string differs (one editable allowed at a time)',
    retargetsTheOpenEditableVersionWhenItsVersionStringDiffersOneEditableAllowedAtATime,
  );
  async function isAnIdempotentNoOpWhenTheVersionIsAlreadyInReview() {
    const fulfilled = Promise.resolve([
      { id: 'v9', versionString: '1.2.0', appStoreState: 'WAITING_FOR_REVIEW' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    const report = await runRelease(api, releaseInput());
    expect(report).toMatchObject({
      submitted: false,
      alreadyInReview: true,
      appStoreState: 'WAITING_FOR_REVIEW',
    });
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
  }

  it(
    'is an idempotent no-op when the version is already in review',
    isAnIdempotentNoOpWhenTheVersionIsAlreadyInReview,
  );
  async function skipsExportComplianceWritesWhenTheBuildAlreadyHasTheDesiredAnswer() {
    function mockCall() {
      return Promise.resolve({ id: 'b-1', usesNonExemptEncryption: false });
    }

    const api = makeReleaseApiFake({
      findBuild: vi.fn(mockCall),
    });
    const report = await runRelease(api, releaseInput());
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
    expect(report.actions).toContainEqual(
      expect.objectContaining({
        description: 'declare export compliance (usesNonExemptEncryption=false)',
        status: 'skipped',
        note: 'already answered on this build',
      }),
    );
  }

  it(
    'skips export-compliance writes when the build already has the desired answer',
    skipsExportComplianceWritesWhenTheBuildAlreadyHasTheDesiredAnswer,
  );
  async function treatsApple409AlreadySetExportComplianceAsSkippedSuccess() {
    const alreadySetError = Object.assign(
      new Error('PATCH /builds/b-1 failed (409): You cannot update when the value is already set.'),
      { status: 409 },
    );
    function mockCall2() {
      return Promise.resolve({ id: 'b-1', usesNonExemptEncryption: null });
    }

    function mockCall3() {
      return Promise.reject(alreadySetError);
    }

    const api = makeReleaseApiFake({
      // Pre-check misses (null), then the PATCH races into Apple's already-set 409.
      findBuild: vi.fn(mockCall2),
      setBuildUsesNonExemptEncryption: vi.fn(mockCall3),
    });
    const report = await runRelease(api, releaseInput());
    expect(api.setBuildUsesNonExemptEncryption).toHaveBeenCalledWith('b-1', false);
    expect(report.actions).toContainEqual(
      expect.objectContaining({
        description: 'declare export compliance (usesNonExemptEncryption=false)',
        status: 'skipped',
        note: 'already answered on this build',
      }),
    );
    // Other release steps still proceed (review submit is the terminal write).
    expect(api.submitReviewSubmission).toHaveBeenCalled();
  }

  it(
    'treats Apple 409 "already set" export-compliance as skipped success',
    treatsApple409AlreadySetExportComplianceAsSkippedSuccess,
  );
  async function enablesAPhasedReleaseWhenOptedIn() {
    const api = makeReleaseApiFake();
    await runRelease(api, releaseInput({ phasedRelease: true }));
    expect(api.createPhasedRelease).toHaveBeenCalledWith('v-new');
  }

  it('enables a phased release when opted in', enablesAPhasedReleaseWhenOptedIn);
  async function errorsWhenTheExactVersionIsAlreadyLiveYouMustBump() {
    const fulfilled = Promise.resolve([
      { id: 'v1', versionString: '1.2.0', appStoreState: 'READY_FOR_SALE' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    await expect(runRelease(api, releaseInput())).rejects.toMatchObject({
      message: expect.stringMatching(
        /already on the App Store \(READY_FOR_SALE\)\. Next step: set a new marketing version/,
      ),
    });
  }

  it(
    'errors when the exact version is already live (you must bump)',
    errorsWhenTheExactVersionIsAlreadyLiveYouMustBump,
  );
  async function refusesABuildWhoseMarketingVersionIsAlreadyLiveBeforeAnyAppStoreWrite() {
    const fulfilled = Promise.resolve([
      { id: 'v-live', versionString: '1.1.0', appStoreState: 'READY_FOR_SALE' },
      { id: 'v-next', versionString: '1.1.1', appStoreState: 'PREPARE_FOR_SUBMISSION' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    const liveBuild = { ...VALID_BUILD, version: '591', marketingVersion: '1.1.0' };

    const attempt = runRelease(api, releaseInput({ versionString: '1.2.0', build: liveBuild }));

    await expect(attempt).rejects.toMatchObject({
      message:
        'Build 591 (version 1.1.0) cannot join a new App Store version: App Store version 1.1.0 is already live. Next step: create a worktree from tag ios/1.1.0-591, set a new marketing version there, run `launch-store build ios`, then release that build.',
    });
    expect(api.updateAppStoreVersion).not.toHaveBeenCalled();
    expect(api.selectBuildForVersion).not.toHaveBeenCalled();
    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
  }

  it(
    'refuses a build whose marketing version is already live, before any App Store write',
    refusesABuildWhoseMarketingVersionIsAlreadyLiveBeforeAnyAppStoreWrite,
  );
  async function attachesABuildWhoseMarketingVersionIsNotLiveYetToItsEditableVersion() {
    const fulfilled = Promise.resolve([
      { id: 'v-live', versionString: '1.1.0', appStoreState: 'READY_FOR_SALE' },
      { id: 'v-next', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    const editableBuild = { ...VALID_BUILD, marketingVersion: '1.2.0' };

    await runRelease(api, releaseInput({ versionString: '1.2.0', build: editableBuild }));

    expect(api.selectBuildForVersion).toHaveBeenCalledWith('v-next', 'b-1');
  }

  it(
    'attaches a build whose marketing version is not live yet, to its editable version',
    attachesABuildWhoseMarketingVersionIsNotLiveYetToItsEditableVersion,
  );
  async function errorsWithoutChangingAnythingWhenTheExactVersionIsInAnUnknownPiece() {
    const fulfilled = Promise.resolve([
      { id: 'v1', versionString: '1.2.0', appStoreState: 'SOME_NEW_STATE' },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    await expect(runRelease(api, releaseInput())).rejects.toMatchObject({
      message: expect.stringMatching(/launch-store will not change/),
    });
    expect(api.updateAppStoreVersion).not.toHaveBeenCalled();
  }

  it(
    'errors without changing anything when the exact version is in an unknown state',
    errorsWithoutChangingAnythingWhenTheExactVersionIsInAnUnknownPiece,
  );
  async function errorsWithThePortalChecklistWhenTheAppHasNoAppStoreConnectPiece() {
    function mockCall4() {
      return Promise.resolve(null);
    }

    const api = makeReleaseApiFake({ getAppId: vi.fn(mockCall4) });
    await expect(runRelease(api, releaseInput())).rejects.toMatchObject({
      message: expect.stringMatching(/No App Store Connect app record.*Apple has no API/s),
    });
  }

  it(
    'errors with the portal checklist when the app has no App Store Connect record',
    errorsWithThePortalChecklistWhenTheAppHasNoAppStoreConnectPiece,
  );
  async function refusesABuildThatHasnTFinishedProcessing() {
    const api = makeReleaseApiFake();
    const processing: BuildResource = {
      id: 'b-2',
      version: '43',
      processingState: 'PROCESSING',
      expired: false,
    };
    await expect(runRelease(api, releaseInput({ build: processing }))).rejects.toMatchObject({
      message: expect.stringMatching(/still processing|PROCESSING/),
    });
    expect(api.selectBuildForVersion).not.toHaveBeenCalled();
  }

  it("refuses a build that hasn't finished processing", refusesABuildThatHasnTFinishedProcessing);
  async function plansEveryStepInADryRunWithoutPerformingAnyWrite() {
    const api = makeReleaseApiFake();
    const report = await runRelease(api, releaseInput({ dryRun: true }));
    for (const write of [
      api.createAppStoreVersion,
      api.selectBuildForVersion,
      api.setBuildUsesNonExemptEncryption,
      api.createAppStoreVersionLocalization,
      api.createReviewSubmission,
      api.addReviewSubmissionItem,
      api.submitReviewSubmission,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(report.submitted).toBe(false);
    expect(report.actions.length).toBeGreaterThan(0);
    function everyAction(action: {
      description: string;
      status: 'skipped' | 'planned' | 'applied' | 'failed';
      error?: string;
      note?: string;
    }) {
      return action.status == 'planned';
    }

    expect(report.actions.every(everyAction)).toBe(true);
    function readDescription2(action: {
      description: string;
      status: 'skipped' | 'planned' | 'applied' | 'failed';
      error?: string;
      note?: string;
    }) {
      return action.description;
    }

    expect(report.actions.map(readDescription2)).toContain('create App Store version 1.2.0');
  }

  it(
    'plans every step in a dry-run without performing any write',
    plansEveryStepInADryRunWithoutPerformingAnyWrite,
  );
  async function capturesAFailedStepAndKeepsGoingOneFailureNoLongerAbortsTheRest() {
    const fulfilled = Promise.resolve([
      { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
    ]);
    function mockCall5() {
      return Promise.reject(new Error('build attach boom'));
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
      selectBuildForVersion: vi.fn(mockCall5),
    });
    const report = await runRelease(api, releaseInput());
    function findAction2(action: {
      description: string;
      status: 'skipped' | 'planned' | 'applied' | 'failed';
      error?: string;
      note?: string;
    }) {
      return action.description.startsWith('attach build');
    }

    const attach = report.actions.find(findAction2);
    expect(attach).toMatchObject({ status: 'failed', error: expect.stringContaining('boom') });
    // The walk continued past the failure all the way to submit.
    expect(api.submitReviewSubmission).toHaveBeenCalled();
  }

  it(
    'captures a failed step and keeps going (one failure no longer aborts the rest)',
    capturesAFailedStepAndKeepsGoingOneFailureNoLongerAbortsTheRest,
  );
  async function isAnIdempotentNoOpWhenTheVersionIsPendingDeveloperRelease() {
    const fulfilled = Promise.resolve([
      {
        id: 'v9',
        versionString: '1.2.0',
        appStoreState: 'PENDING_DEVELOPER_RELEASE',
      },
    ]);
    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
    });
    const report = await runRelease(api, releaseInput());
    expect(report).toMatchObject({
      submitted: false,
      alreadyInReview: true,
      appStoreState: 'PENDING_DEVELOPER_RELEASE',
    });
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
  }

  it(
    'is an idempotent no-op when the version is pending developer release',
    isAnIdempotentNoOpWhenTheVersionIsPendingDeveloperRelease,
  );
  async function passesEarliestReleaseDateWhenCreatingAndUpdatingTheVersion() {
    const earliestReleaseDate = '2026-09-01T12:00:00.000Z';
    const api = makeReleaseApiFake();
    await runRelease(api, releaseInput({ earliestReleaseDate, releaseType: 'SCHEDULED' }));
    expect(api.createAppStoreVersion).toHaveBeenCalledWith(
      'app1',
      expect.objectContaining({
        versionString: '1.2.0',
        releaseType: 'SCHEDULED',
        earliestReleaseDate,
      }),
    );
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith(
      'v-new',
      expect.objectContaining({
        releaseType: 'SCHEDULED',
        earliestReleaseDate,
      }),
    );
  }

  it(
    'passes earliestReleaseDate when creating and updating the version',
    passesEarliestReleaseDateWhenCreatingAndUpdatingTheVersion,
  );
  async function disablesAnExistingPhasedReleaseWhenOptedOut() {
    const fulfilled = Promise.resolve([
      { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
    ]);
    function mockCall6() {
      return Promise.resolve({ id: 'ph-1', phasedReleaseState: 'ACTIVE' });
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn().mockReturnValue(fulfilled),
      getPhasedRelease: vi.fn(mockCall6),
    });
    await runRelease(api, releaseInput({ phasedRelease: false }));
    expect(api.deletePhasedRelease).toHaveBeenCalledWith('ph-1');
    expect(api.createPhasedRelease).not.toHaveBeenCalled();
  }

  it(
    'disables an existing phased release when opted out',
    disablesAnExistingPhasedReleaseWhenOptedOut,
  );
  async function refusesAnExpiredBuildBeforeAttachingIt() {
    const api = makeReleaseApiFake();
    const expiredBuild: BuildResource = {
      id: 'b-2',
      version: '43',
      processingState: 'VALID',
      expired: true,
    };
    await expect(runRelease(api, releaseInput({ build: expiredBuild }))).rejects.toMatchObject({
      message: expect.stringMatching(/expired/),
    });
    expect(api.selectBuildForVersion).not.toHaveBeenCalled();
  }

  it('refuses an expired build before attaching it', refusesAnExpiredBuildBeforeAttachingIt);
  async function reusesAnOpenREADYFORREVIEWSubmissionInsteadOfCreatingAnother() {
    function mockCall7() {
      return Promise.resolve([{ id: 'rs-open', state: 'READY_FOR_REVIEW' }]);
    }

    const api = makeReleaseApiFake({
      listReviewSubmissions: vi.fn(mockCall7),
    });
    await runRelease(api, releaseInput());
    expect(api.createReviewSubmission).not.toHaveBeenCalled();
    expect(api.addReviewSubmissionItem).toHaveBeenCalledWith('rs-open', 'v-new');
    expect(api.submitReviewSubmission).toHaveBeenCalledWith('rs-open');
  }

  it(
    'reuses an open READY_FOR_REVIEW submission instead of creating another',
    reusesAnOpenREADYFORREVIEWSubmissionInsteadOfCreatingAnother,
  );
}

describe('releaseApp - submit an update over the API', describeReleaseAppSubmitAnUpdateOverTheAPI);
function describeReleaseAppAttachOnlyNoReviewSubmission() {
  const EDITABLE_VERSION = {
    id: 'v-edit',
    versionString: '1.2.0',
    appStoreState: 'PREPARE_FOR_SUBMISSION',
  };
  async function attachesTheBuildToTheEditableVersionAndNeverSubmitsIt() {
    function mockCall8() {
      return Promise.resolve([LIVE_VERSION, EDITABLE_VERSION]);
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(mockCall8),
    });
    const report = await runRelease(api, releaseInput({ attachOnly: true }));
    expect(api.selectBuildForVersion).toHaveBeenCalledWith('v-edit', 'b-1');
    expect(api.createReviewSubmission).not.toHaveBeenCalled();
    expect(api.addReviewSubmissionItem).not.toHaveBeenCalled();
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      versionId: 'v-edit',
      appStoreState: 'PREPARE_FOR_SUBMISSION',
      submitted: false,
      alreadyInReview: false,
    });
  }

  it(
    'attaches the build to the editable version and never submits it',
    attachesTheBuildToTheEditableVersionAndNeverSubmitsIt,
  );
  async function sendsNoWriteWhenTheSameBuildIsAlreadyAttached() {
    function mockCall9() {
      return Promise.resolve([{ ...EDITABLE_VERSION, attachedBuildId: 'b-1' }]);
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(mockCall9),
    });
    const report = await runRelease(api, releaseInput({ attachOnly: true }));
    expect(api.selectBuildForVersion).not.toHaveBeenCalled();
    expect(api.updateAppStoreVersion).not.toHaveBeenCalled();
    expect(api.updateAppStoreVersionLocalization).not.toHaveBeenCalled();
    expect(report).toMatchObject({ submitted: false, alreadyInReview: false });
    expect(report.actions).toEqual([expect.objectContaining({ status: 'skipped' })]);
  }

  it(
    'sends no write when the same build is already attached',
    sendsNoWriteWhenTheSameBuildIsAlreadyAttached,
  );
  async function swapsAnAttachedBuildForTheNewOneWhileTheVersionIsEditable() {
    function mockCall10() {
      return Promise.resolve([{ ...EDITABLE_VERSION, attachedBuildId: 'b-old' }]);
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(mockCall10),
    });
    await runRelease(api, releaseInput({ attachOnly: true }));
    expect(api.selectBuildForVersion).toHaveBeenCalledWith('v-edit', 'b-1');
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
  }

  it(
    'swaps an attached build for the new one while the version is editable',
    swapsAnAttachedBuildForTheNewOneWhileTheVersionIsEditable,
  );
}

describe(
  'releaseApp - attach only (no review submission)',
  describeReleaseAppAttachOnlyNoReviewSubmission,
);
function describePickCurrentVersion() {
  function prefersAnInFlightVersionOverALiveOne() {
    const versions: AppStoreVersionResource[] = [
      { id: 'v1', versionString: '1.0.0', appStoreState: 'READY_FOR_SALE' },
      { id: 'v2', versionString: '1.1.0', appStoreState: 'IN_REVIEW' },
    ];
    const currentVersion = pickCurrentVersion(versions);
    expect(currentVersion?.id).toBe('v2');
  }

  it('prefers an in-flight version over a live one', prefersAnInFlightVersionOverALiveOne);
  function fallsBackToTheFirstLiveVersionWhenNothingIsInFlight() {
    const versions: AppStoreVersionResource[] = [
      { id: 'v1', versionString: '1.0.0', appStoreState: 'READY_FOR_SALE' },
    ];
    const currentVersion = pickCurrentVersion(versions);
    expect(currentVersion?.id).toBe('v1');
  }

  it(
    'falls back to the first live version when nothing is in flight',
    fallsBackToTheFirstLiveVersionWhenNothingIsInFlight,
  );
  function returnsNullForAnAppWithNoVersions() {
    const currentVersion = pickCurrentVersion([]);
    expect(currentVersion).toBeNull();
  }

  it('returns null for an app with no versions', returnsNullForAnAppWithNoVersions);
}

describe('pickCurrentVersion', describePickCurrentVersion);
function describeReadReleaseStatus() {
  async function classifiesTheCurrentVersionAndTheBuildAttachedToIt() {
    function mockCall11() {
      return Promise.resolve([
        {
          id: 'v2',
          versionString: '1.1.0',
          appStoreState: 'IN_REVIEW',
          attachedBuildNumber: '42',
          attachedBuildProcessingState: 'VALID',
        },
      ]);
    }

    function mockCall12() {
      return Promise.resolve({ id: 'ph-1', phasedReleaseState: 'ACTIVE' });
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(mockCall11),
      getPhasedRelease: vi.fn(mockCall12),
    });
    const releaseStatus = await readReleaseStatus(api, 'com.acme.app', IOS_PLATFORM);
    expect(releaseStatus).toMatchObject({
      bundleId: 'com.acme.app',
      versionString: '1.1.0',
      appStoreState: 'IN_REVIEW',
      buildNumber: '42',
      buildProcessingState: 'VALID',
      phasedReleaseState: 'ACTIVE',
      verdict: expect.objectContaining({ state: 'in-review', exitCode: 3 }),
    });
  }

  it(
    'classifies the current version and the build attached to it',
    classifiesTheCurrentVersionAndTheBuildAttachedToIt,
  );
  async function reportsNoBuildWhenTheCurrentVersionHasNoneAttached() {
    function mockCall13() {
      return Promise.resolve([
        { id: 'v2', versionString: '1.1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
      ]);
    }

    const api = makeReleaseApiFake({
      listAppStoreVersions: vi.fn(mockCall13),
    });
    const releaseStatus = await readReleaseStatus(api, 'com.acme.app', IOS_PLATFORM);
    expect(releaseStatus).toMatchObject({ versionString: '1.1.0', buildNumber: null });
  }

  it(
    'reports no build when the current version has none attached',
    reportsNoBuildWhenTheCurrentVersionHasNoneAttached,
  );
  async function returnsAnEmptyPreparingVerdictWhenTheAppHasNoVersionsYet() {
    function mockCall14() {
      return Promise.resolve([]);
    }

    const api = makeReleaseApiFake({ listAppStoreVersions: vi.fn(mockCall14) });
    const releaseStatus = await readReleaseStatus(api, 'com.acme.app', IOS_PLATFORM);
    expect(releaseStatus).toMatchObject({
      versionString: null,
      appStoreState: null,
      verdict: expect.objectContaining({ state: 'unknown', exitCode: 1 }),
    });
  }

  it(
    'returns an empty preparing verdict when the app has no versions yet',
    returnsAnEmptyPreparingVerdictWhenTheAppHasNoVersionsYet,
  );
}

describe('readReleaseStatus', describeReadReleaseStatus);
function describeWaitForValidBuild() {
  function noSleep(): Promise<void> {
    return Promise.resolve();
  }
  async function returnsTheBuildOnceItReachesVALID() {
    function mockCall15() {
      return Promise.resolve(VALID_BUILD);
    }

    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(mockCall15),
    });
    const buildProgram = waitForValidBuild(api, 'app1', 42, { sleep: noSleep });
    await expect(buildProgram).resolves.toEqual(VALID_BUILD);
  }

  it('returns the build once it reaches VALID', returnsTheBuildOnceItReachesVALID);
  async function pollsUntilVALIDSleepingBetweenAttempts() {
    const fulfilled = Promise.resolve({
      id: 'b',
      version: '42',
      processingState: 'PROCESSING',
      expired: false,
    });
    const findBuildByVersion = vi
      .fn()
      .mockReturnValueOnce(fulfilled)
      .mockReturnValueOnce(Promise.resolve(VALID_BUILD));
    const api = makeReleaseApiFake({ findBuildByVersion });
    function mockCall16() {
      return Promise.resolve();
    }

    const sleepBetweenPolls = vi.fn(mockCall16);
    const storeBuild = await waitForValidBuild(api, 'app1', 42, {
      sleep: sleepBetweenPolls,
      intervalMs: 1,
    });
    expect(storeBuild).toEqual(VALID_BUILD);
    expect(sleepBetweenPolls).toHaveBeenCalledTimes(1);
  }

  it('polls until VALID, sleeping between attempts', pollsUntilVALIDSleepingBetweenAttempts);
  async function throwsOnINVALIDProcessing() {
    const fulfilled = Promise.resolve({
      id: 'b',
      version: '42',
      processingState: 'INVALID',
      expired: false,
    });
    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn().mockReturnValue(fulfilled),
    });
    const buildProgram = waitForValidBuild(api, 'app1', 42, { sleep: noSleep });
    await expect(buildProgram).rejects.toMatchObject({
      message: expect.stringMatching(/INVALID/),
    });
  }

  it('throws on INVALID processing', throwsOnINVALIDProcessing);
  async function throwsOnFAILEDProcessing() {
    function mockCall17() {
      return Promise.resolve({ id: 'b', version: '42', processingState: 'FAILED', expired: false });
    }

    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(mockCall17),
    });
    const buildProgram = waitForValidBuild(api, 'app1', 42, { sleep: noSleep });
    await expect(buildProgram).rejects.toMatchObject({
      message: expect.stringMatching(/FAILED/),
    });
  }

  it('throws on FAILED processing', throwsOnFAILEDProcessing);
  async function throwsANotFoundMessageWhenTheBuildNeverAppearsBeforeTheTimeout() {
    function mockCall18() {
      return Promise.resolve(null);
    }

    const api = makeReleaseApiFake({ findBuildByVersion: vi.fn(mockCall18) });
    const buildProgram = waitForValidBuild(api, 'app1', 42, { sleep: noSleep, timeoutMs: 0 });
    await expect(buildProgram).rejects.toMatchObject({
      message: expect.stringMatching(/was not found on App Store Connect/),
    });
  }

  it(
    'throws a not-found message when the build never appears before the timeout',
    throwsANotFoundMessageWhenTheBuildNeverAppearsBeforeTheTimeout,
  );
  async function throwsOnTimeout() {
    function mockCall19() {
      return Promise.resolve({
        id: 'b',
        version: '42',
        processingState: 'PROCESSING',
        expired: false,
      });
    }

    const api = makeReleaseApiFake({
      findBuildByVersion: vi.fn(mockCall19),
    });
    const buildProgram = waitForValidBuild(api, 'app1', 42, { sleep: noSleep, timeoutMs: 0 });
    await expect(buildProgram).rejects.toMatchObject({
      message: expect.stringMatching(/still PROCESSING/),
    });
  }

  it('throws on timeout', throwsOnTimeout);
  async function waitsForTheBuildOfTheGivenMarketingVersionNotAnotherVersionWithTheSameNumber() {
    function mockCall20(_appId: string, _buildNumber: number, marketingVersion?: string) {
      return Promise.resolve(
        marketingVersion == '1.3.0'
          ? {
              id: 'b-130',
              version: '42',
              marketingVersion: '1.3.0',
              processingState: 'VALID',
              expired: false,
            }
          : {
              id: 'b-120',
              version: '42',
              marketingVersion: '1.2.0',
              processingState: 'FAILED',
              expired: false,
            },
      );
    }

    const findBuildByVersion = vi.fn(mockCall20);
    const api = makeReleaseApiFake({ findBuildByVersion });

    const storeBuild = await waitForValidBuild(api, 'app1', 42, {
      sleep: noSleep,
      marketingVersion: '1.3.0',
    });

    expect(findBuildByVersion).toHaveBeenCalledWith('app1', 42, '1.3.0');
    expect(storeBuild).toMatchObject({ id: 'b-130', processingState: 'VALID' });
  }

  it(
    'waits for the build of the given marketing version, not another version with the same number',
    waitsForTheBuildOfTheGivenMarketingVersionNotAnotherVersionWithTheSameNumber,
  );
}

describe('waitForValidBuild', describeWaitForValidBuild);
