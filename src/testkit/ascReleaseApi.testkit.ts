import { Effect } from 'effect';
import { vi } from 'vitest';
import type { AscReleaseApi } from '../core/release/appStoreRelease.js';

export const LIVE_VERSION = {
  id: 'v-live',
  versionString: '1.1.0',
  appStoreState: 'READY_FOR_SALE',
};

/** Fully-stubbed AscReleaseApi. Reads default to an app with one live version; writes resolve to a created resource. */
export const makeReleaseApiFake = (methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi => {
  const baseApi: AscReleaseApi = {
    getAppId: vi.fn(() => Effect.succeed('app1')),
    getLatestMarketingVersion: vi.fn(() => Effect.succeed(null)),
    listBuilds: vi.fn(() => Effect.succeed([])),
    findBuild: vi.fn(() => Effect.succeed({ id: 'b-1', usesNonExemptEncryption: null })),
    findBuildByVersion: vi.fn(() => Effect.succeed(null)),
    setBuildUsesNonExemptEncryption: vi.fn(() => Effect.void),
    listAppStoreVersions: vi.fn(() => Effect.succeed([LIVE_VERSION])),
    createAppStoreVersion: vi.fn().mockImplementation(
      (
        _appId: string,
        createInput: {
          versionString: string;
        },
      ) =>
        Effect.succeed({
          id: 'v-new',
          versionString: createInput.versionString,
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
  return { ...baseApi, ...methodOverrides };
};
