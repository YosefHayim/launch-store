import { describe, expect, it, vi } from 'vitest';
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
import type { AppStoreVersionResource, BuildResource } from '../apple/ascClient.js';

/** A fully-stubbed {@link AscReleaseApi}. Reads default to "an empty app"; writes resolve to a created resource. */
function makeApi(overrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  const base: AscReleaseApi = {
    getAppId: vi.fn().mockResolvedValue('app1'),
    listBuilds: vi.fn().mockResolvedValue([]),
    findBuildByVersion: vi.fn().mockResolvedValue(null),
    setBuildUsesNonExemptEncryption: vi.fn().mockResolvedValue(undefined),
    listAppStoreVersions: vi.fn().mockResolvedValue([]),
    createAppStoreVersion: vi
      .fn()
      .mockImplementation((_appId: string, input: { versionString: string }) =>
        Promise.resolve({
          id: 'v-new',
          versionString: input.versionString,
          appStoreState: 'PREPARE_FOR_SUBMISSION',
        }),
      ),
    updateAppStoreVersion: vi.fn().mockResolvedValue(undefined),
    selectBuildForVersion: vi.fn().mockResolvedValue(undefined),
    listAppStoreVersionLocalizations: vi.fn().mockResolvedValue([]),
    createAppStoreVersionLocalization: vi
      .fn()
      .mockResolvedValue({ id: 'loc-new', locale: 'en-US' }),
    updateAppStoreVersionLocalization: vi.fn().mockResolvedValue(undefined),
    getPhasedRelease: vi.fn().mockResolvedValue(null),
    createPhasedRelease: vi.fn().mockResolvedValue({ id: 'ph-new', phasedReleaseState: 'ACTIVE' }),
    deletePhasedRelease: vi.fn().mockResolvedValue(undefined),
    listReviewSubmissions: vi.fn().mockResolvedValue([]),
    createReviewSubmission: vi.fn().mockResolvedValue({ id: 'rs1', state: 'READY_FOR_REVIEW' }),
    addReviewSubmissionItem: vi.fn().mockResolvedValue(undefined),
    submitReviewSubmission: vi.fn().mockResolvedValue(undefined),
    getReviewSubmission: vi.fn().mockResolvedValue({ id: 'rs1', state: 'WAITING_FOR_REVIEW' }),
    createAppStoreVersionReleaseRequest: vi.fn().mockResolvedValue(undefined),
  };
  return { ...base, ...overrides };
}

const VALID_BUILD: BuildResource = {
  id: 'b-1',
  version: '42',
  processingState: 'VALID',
  expired: false,
};

function input(overrides: Partial<ReleaseInput> = {}): ReleaseInput {
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
}

describe('nextReleaseAction — the appStoreState transition table', () => {
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

describe('classifyVerdict — the --watch / exit-code contract', () => {
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

describe('releaseApp — submit an update over the API', () => {
  it('creates the version, attaches the build, declares compliance, writes notes, and submits', async () => {
    const api = makeApi();
    const report = await releaseApp(api, input());

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
        .mockResolvedValue([
          { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
        ]),
      listAppStoreVersionLocalizations: vi
        .fn()
        .mockResolvedValue([{ id: 'loc-1', locale: 'en-US', whatsNew: 'old' }]),
    });
    await releaseApp(api, input());
    expect(api.updateAppStoreVersionLocalization).toHaveBeenCalledWith('loc-1', 'Bug fixes.');
    expect(api.createAppStoreVersionLocalization).not.toHaveBeenCalled();
  });

  it('retargets the open editable version when its version string differs (one editable allowed at a time)', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([
          { id: 'v5', versionString: '1.1.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
        ]),
    });
    await releaseApp(api, input({ versionString: '1.2.0' }));
    expect(api.updateAppStoreVersion).toHaveBeenCalledWith('v5', { versionString: '1.2.0' });
    expect(api.createAppStoreVersion).not.toHaveBeenCalled();
  });

  it('is an idempotent no-op when the version is already in review', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([
          { id: 'v9', versionString: '1.2.0', appStoreState: 'WAITING_FOR_REVIEW' },
        ]),
    });
    const report = await releaseApp(api, input());
    expect(report).toMatchObject({
      submitted: false,
      alreadyInReview: true,
      appStoreState: 'WAITING_FOR_REVIEW',
    });
    expect(api.submitReviewSubmission).not.toHaveBeenCalled();
  });

  it('enables a phased release when opted in', async () => {
    const api = makeApi();
    await releaseApp(api, input({ phasedRelease: true }));
    expect(api.createPhasedRelease).toHaveBeenCalledWith('v-new');
  });

  it('errors when the exact version is already live (you must bump)', async () => {
    const api = makeApi({
      listAppStoreVersions: vi
        .fn()
        .mockResolvedValue([{ id: 'v1', versionString: '1.2.0', appStoreState: 'READY_FOR_SALE' }]),
    });
    await expect(releaseApp(api, input())).rejects.toThrow(/already on the App Store/);
  });

  it('errors with the portal checklist when the app has no App Store Connect record', async () => {
    const api = makeApi({ getAppId: vi.fn().mockResolvedValue(null) });
    await expect(releaseApp(api, input())).rejects.toThrow(
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
    await expect(releaseApp(api, input({ build: processing }))).rejects.toThrow(
      /still processing|PROCESSING/,
    );
    expect(api.selectBuildForVersion).not.toHaveBeenCalled();
  });

  it('plans every step in a dry-run without performing any write', async () => {
    const api = makeApi();
    const report = await releaseApp(api, input({ dryRun: true }));

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
        .mockResolvedValue([
          { id: 'v5', versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
        ]),
      selectBuildForVersion: vi.fn().mockRejectedValue(new Error('build attach boom')),
    });
    const report = await releaseApp(api, input());

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
  const noSleep = (): Promise<void> => Promise.resolve();

  it('returns the build once it reaches VALID', async () => {
    const api = makeApi({ findBuildByVersion: vi.fn().mockResolvedValue(VALID_BUILD) });
    await expect(waitForValidBuild(api, 'app1', 42, { sleep: noSleep })).resolves.toEqual(
      VALID_BUILD,
    );
  });

  it('polls until VALID, sleeping between attempts', async () => {
    const findBuildByVersion = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'b',
        version: '42',
        processingState: 'PROCESSING',
        expired: false,
      })
      .mockResolvedValueOnce(VALID_BUILD);
    const api = makeApi({ findBuildByVersion });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const build = await waitForValidBuild(api, 'app1', 42, { sleep, intervalMs: 1 });
    expect(build).toEqual(VALID_BUILD);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('throws on INVALID processing', async () => {
    const api = makeApi({
      findBuildByVersion: vi
        .fn()
        .mockResolvedValue({ id: 'b', version: '42', processingState: 'INVALID', expired: false }),
    });
    await expect(waitForValidBuild(api, 'app1', 42, { sleep: noSleep })).rejects.toThrow(/INVALID/);
  });

  it('throws on timeout', async () => {
    const api = makeApi({
      findBuildByVersion: vi.fn().mockResolvedValue({
        id: 'b',
        version: '42',
        processingState: 'PROCESSING',
        expired: false,
      }),
    });
    await expect(
      waitForValidBuild(api, 'app1', 42, { sleep: noSleep, timeoutMs: 0 }),
    ).rejects.toThrow(/still PROCESSING/);
  });
});
