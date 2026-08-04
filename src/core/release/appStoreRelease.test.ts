import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { AppStoreVersionResource, BuildResource } from '../types/appleCatalog.js';
import {
  classifyVerdict,
  IOS_PLATFORM,
  nextReleaseAction,
  pickCurrentVersion,
  releaseApp,
  waitForValidBuild,
  type AscReleaseApi,
  type ReleaseInput,
} from './appStoreRelease.js';

/** A fully-stubbed {@link AscReleaseApi}. Reads default to "an empty app"; writes resolve to a created resource. */
const makeApi = (overrides: Partial<AscReleaseApi> = {}): AscReleaseApi => {
  const base: AscReleaseApi = {
    getAppId: vi.fn(() => Effect.succeed('app1')),
    getLatestMarketingVersion: vi.fn(() => Effect.succeed(null)),
    listBuilds: vi.fn(() => Effect.succeed([])),
    findBuild: vi.fn(() => Effect.succeed({ id: 'b-1', usesNonExemptEncryption: null })),
    findBuildByVersion: vi.fn(() => Effect.succeed(null)),
    setBuildUsesNonExemptEncryption: vi.fn(() => Effect.void),
    listAppStoreVersions: vi.fn(() => Effect.succeed([])),
    createAppStoreVersion: vi.fn().mockImplementation(
      (
        _appId: string,
        input: {
          versionString: string;
        },
      ) =>
        Effect.succeed({
          id: 'v-new',
          versionString: input.versionString,
          appStoreState: 'PREPARE_FOR_SUBMISSION',
        }),
    ),
    updateAppStoreVersion: vi.fn(() => Effect.void),
    selectBuildForVersion: vi.fn(() => Effect.void),
    listAppStoreVersionLocalizations: vi.fn(() => Effect.succeed([])),
    createAppStoreVersionLocalization: vi
      .fn()
      .mockReturnValue(Effect.succeed({ id: 'loc-new', locale: 'en-US' })),
    updateAppStoreVersionLocalization: vi.fn(() => Effect.void),
    getPhasedRelease: vi.fn(() => Effect.succeed(null)),
    createPhasedRelease: vi.fn(() =>
      Effect.succeed({ id: 'ph-new', phasedReleaseState: 'ACTIVE' }),
    ),
    deletePhasedRelease: vi.fn(() => Effect.void),
    listReviewSubmissions: vi.fn(() => Effect.succeed([])),
    createReviewSubmission: vi.fn(() => Effect.succeed({ id: 'rs1', state: 'READY_FOR_REVIEW' })),
    addReviewSubmissionItem: vi.fn(() => Effect.void),
    submitReviewSubmission: vi.fn(() => Effect.void),
    getReviewSubmission: vi.fn(() => Effect.succeed({ id: 'rs1', state: 'WAITING_FOR_REVIEW' })),
    createAppStoreVersionReleaseRequest: vi.fn(() => Effect.void),
  };
  return { ...base, ...overrides };
};

const runRelease = (api: AscReleaseApi, releaseInput: ReleaseInput) =>
  Effect.runPromise(releaseApp(api, releaseInput));
const VALID_BUILD: BuildResource = {
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
};
const input = (overrides: Partial<ReleaseInput> = {}): ReleaseInput => {
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
    ...overrides,
  };
};
describe('nextReleaseAction - the appStoreState transition table', () => {
  it('classifies each lifecycle state into the action it permits', () => {
    expect(nextReleaseAction('PREPARE_FOR_SUBMISSION')).toBe('editable');
    expect(nextReleaseAction('DEVELOPER_REJECTED')).toBe('editable');
    expect(nextReleaseAction('REJECTED')).toBe('editable');
    expect(nextReleaseAction('WAITING_FOR_REVIEW')).toBe('submitted');
    expect(nextReleaseAction('IN_REVIEW')).toBe('submitted');
    expect(nextReleaseAction('PENDING_DEVELOPER_RELEASE')).toBe('pending-release');
    expect(nextReleaseAction('READY_FOR_SALE')).toBe('live');
    expect(nextReleaseAction('SOME_FUTURE_STATE')).toBe('blocked');
  });
});
describe('classifyVerdict - the --watch / exit-code contract', () => {
  it('maps states to verdicts with the documented exit codes', () => {
    expect(classifyVerdict('READY_FOR_SALE')).toMatchObject({
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
  });
});
describe('releaseApp - submit an update over the API', () => {
  it('creates the version, attaches the build, declares compliance, writes notes, and submits', async () => {
    const api = makeApi();
    const report = await runRelease(api, input());
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
  });
  it("updates an existing localization's notes instead of creating a duplicate", async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockReturnValue(
          Effect.succeed([
            { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
          ]),
        ),
      listAppStoreVersionLocalizations: vi
        .fn()
        .mockReturnValue(Effect.succeed([{ id: 'loc-1', locale: 'en-US', whatsNew: 'old' }])),
    });
    await runRelease(api, input());
    expect(api.updateAppStoreVersionLocalization).toHaveBeenCalledWith('loc-1', 'Bug fixes.');
    expect(api.createAppStoreVersionLocalization).not.toHaveBeenCalled();
  });
  it('retargets the open editable version when its version string differs (one editable allowed at a time)', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockReturnValue(
          Effect.succeed([
            { id: 'v5', versionString: '1.1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
          ]),
        ),
    });
    await runRelease(api, input({ versionString: '1.2.0' }));
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith('v5', { versionString: '1.2.0' });
    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
  });
  it('is an idempotent no-op when the version is already in review', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockReturnValue(
          Effect.succeed([
            { id: 'v9', versionString: '1.2.0', appStoreState: 'WAITING_FOR_REVIEW' },
          ]),
        ),
    });
    const report = await runRelease(api, input());
    expect(report).toMatchObject({
      submitted: false,
      alreadyInReview: true,
      appStoreState: 'WAITING_FOR_REVIEW',
    });
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
  });
  it('skips export-compliance writes when the build already has the desired answer', async () => {
    const api = makeApi({
      findBuild: vi.fn(() => Effect.succeed({ id: 'b-1', usesNonExemptEncryption: false })),
    });
    const report = await runRelease(api, input());
    expect(api.setBuildUsesNonExemptEncryption).not.toHaveBeenCalled();
    expect(report.actions).toContainEqual(
      expect.objectContaining({
        description: 'declare export compliance (usesNonExemptEncryption=false)',
        status: 'skipped',
        note: 'already answered on this build',
      }),
    );
  });
  it('treats Apple 409 "already set" export-compliance as skipped success', async () => {
    const alreadySetError = Object.assign(
      new Error('PATCH /builds/b-1 failed (409): You cannot update when the value is already set.'),
      { status: 409 },
    );
    const api = makeApi({
      // Pre-check misses (null), then the PATCH races into Apple's already-set 409.
      findBuild: vi.fn(() => Effect.succeed({ id: 'b-1', usesNonExemptEncryption: null })),
      setBuildUsesNonExemptEncryption: vi.fn(() => Effect.fail(alreadySetError)),
    });
    const report = await runRelease(api, input());
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
  });
  it('enables a phased release when opted in', async () => {
    const api = makeApi();
    await runRelease(api, input({ phasedRelease: true }));
    expect(api.createPhasedRelease).toHaveBeenCalledWith('v-new');
  });
  it('errors when the exact version is already live (you must bump)', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockReturnValue(
          Effect.succeed([{ id: 'v1', versionString: '1.2.0', appStoreState: 'READY_FOR_SALE' }]),
        ),
    });
    await expect(runRelease(api, input())).rejects.toThrow(/already on the App Store/);
  });
  it('errors with the portal checklist when the app has no App Store Connect record', async () => {
    const api = makeApi({ getAppId: vi.fn(() => Effect.succeed(null)) });
    await expect(runRelease(api, input())).rejects.toThrow(
      /No App Store Connect app record.*Apple has no API/s,
    );
  });
  it("refuses a build that hasn't finished processing", async () => {
    const api = makeApi();
    const processing: BuildResource = {
      id: 'b-2',
      version: '43',
      processingState: 'PROCESSING',
      expired: false,
    };
    await expect(runRelease(api, input({ build: processing }))).rejects.toThrow(
      /still processing|PROCESSING/,
    );
    expect(api.selectBuildForVersion).not.toHaveBeenCalled();
  });
  it('plans every step in a dry-run without performing any write', async () => {
    const api = makeApi();
    const report = await runRelease(api, input({ dryRun: true }));
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
    expect(report.actions.every((action) => action.status === 'planned')).toBe(true);
    expect(report.actions.map((action) => action.description)).toContain(
      'create App Store version 1.2.0',
    );
  });
  it('captures a failed step and keeps going (one failure no longer aborts the rest)', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockReturnValue(
          Effect.succeed([
            { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
          ]),
        ),
      selectBuildForVersion: vi.fn(() => Effect.fail(new Error('build attach boom'))),
    });
    const report = await runRelease(api, input());
    const attach = report.actions.find((action) => action.description.startsWith('attach build'));
    expect(attach).toMatchObject({ status: 'failed', error: expect.stringContaining('boom') });
    // The walk continued past the failure all the way to submit.
    expect(api.submitReviewSubmission).toHaveBeenCalled();
  });
});
describe('pickCurrentVersion', () => {
  it('prefers an in-flight version over a live one', () => {
    const versions: AppStoreVersionResource[] = [
      { id: 'v1', versionString: '1.0.0', appStoreState: 'READY_FOR_SALE' },
      { id: 'v2', versionString: '1.1.0', appStoreState: 'IN_REVIEW' },
    ];
    expect(pickCurrentVersion(versions)?.id).toBe('v2');
  });
  it('returns null for an app with no versions', () => {
    expect(pickCurrentVersion([])).toBeNull();
  });
});
describe('waitForValidBuild', () => {
  const noSleep = (): Effect.Effect<void> => Effect.void;
  it('returns the build once it reaches VALID', async () => {
    const api = makeApi({ findBuildByVersion: vi.fn(() => Effect.succeed(VALID_BUILD)) });
    await expect(
      Effect.runPromise(waitForValidBuild(api, 'app1', 42, { sleep: noSleep })),
    ).resolves.toEqual(VALID_BUILD);
  });
  it('polls until VALID, sleeping between attempts', async () => {
    const findBuildByVersion = vi
      .fn()
      .mockReturnValueOnce(
        Effect.succeed({
          id: 'b',
          version: '42',
          processingState: 'PROCESSING',
          expired: false,
        }),
      )
      .mockReturnValueOnce(Effect.succeed(VALID_BUILD));
    const api = makeApi({ findBuildByVersion });
    const sleepBetweenPolls = vi.fn(() => Effect.void);
    const storeBuild = await Effect.runPromise(
      waitForValidBuild(api, 'app1', 42, { sleep: sleepBetweenPolls, intervalMs: 1 }),
    );
    expect(storeBuild).toEqual(VALID_BUILD);
    expect(sleepBetweenPolls).toHaveBeenCalledTimes(1);
  });
  it('throws on INVALID processing', async () => {
    const api = makeApi({
      findBuildByVersion: vi.fn().mockReturnValue(
        Effect.succeed({
          id: 'b',
          version: '42',
          processingState: 'INVALID',
          expired: false,
        }),
      ),
    });
    await expect(
      Effect.runPromise(waitForValidBuild(api, 'app1', 42, { sleep: noSleep })),
    ).rejects.toThrow(/INVALID/);
  });
  it('throws on timeout', async () => {
    const api = makeApi({
      findBuildByVersion: vi.fn(() =>
        Effect.succeed({
          id: 'b',
          version: '42',
          processingState: 'PROCESSING',
          expired: false,
        }),
      ),
    });
    await expect(
      Effect.runPromise(waitForValidBuild(api, 'app1', 42, { sleep: noSleep, timeoutMs: 0 })),
    ).rejects.toThrow(/still PROCESSING/);
  });
});
