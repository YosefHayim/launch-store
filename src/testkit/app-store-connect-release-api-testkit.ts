import { vi } from 'vitest';
import type { AscReleaseApi } from '../release/app-store-release.ts';

export const LIVE_VERSION = {
  id: 'v-live',
  versionString: '1.1.0',
  appStoreState: 'READY_FOR_SALE',
};

function readAppId(): Promise<string> {
  return Promise.resolve('app1');
}

function readMarketingVersion(): Promise<null> {
  return Promise.resolve(null);
}

function readBuilds(): Promise<never[]> {
  return Promise.resolve([]);
}

function readBuild(): Promise<{ id: string; usesNonExemptEncryption: null }> {
  return Promise.resolve({ id: 'b-1', usesNonExemptEncryption: null });
}

function readBuildByVersion(): Promise<null> {
  return Promise.resolve(null);
}

function setEncryption(): Promise<void> {
  return Promise.resolve();
}

function readVersions(): Promise<(typeof LIVE_VERSION)[]> {
  return Promise.resolve([LIVE_VERSION]);
}

function createVersion(
  _appId: string,
  versionFields: {
    versionString: string;
    platform: string;
    releaseType?: string;
    earliestReleaseDate?: string;
  },
): Promise<{ id: string; versionString: string; appStoreState: string }> {
  return Promise.resolve({
    id: 'v-new',
    versionString: versionFields.versionString,
    appStoreState: 'PREPARE_FOR_SUBMISSION',
  });
}

function updateVersion(): Promise<void> {
  return Promise.resolve();
}

function selectBuild(): Promise<void> {
  return Promise.resolve();
}

function readLocalizations(): Promise<never[]> {
  return Promise.resolve([]);
}

function createLocalization(): Promise<{ id: string; locale: string }> {
  return Promise.resolve({ id: 'loc-new', locale: 'en-US' });
}

function updateLocalization(): Promise<void> {
  return Promise.resolve();
}

function readPhasedRelease(): Promise<null> {
  return Promise.resolve(null);
}

function createPhasedRelease(): Promise<{ id: string; phasedReleaseState: string }> {
  return Promise.resolve({ id: 'ph-new', phasedReleaseState: 'ACTIVE' });
}

function deletePhasedRelease(): Promise<void> {
  return Promise.resolve();
}

function readReviewSubmissions(): Promise<never[]> {
  return Promise.resolve([]);
}

function createReviewSubmission(): Promise<{ id: string; state: string }> {
  return Promise.resolve({ id: 'rs1', state: 'READY_FOR_REVIEW' });
}

function addReviewItem(): Promise<void> {
  return Promise.resolve();
}

function submitReview(): Promise<void> {
  return Promise.resolve();
}

function readReviewSubmission(): Promise<{ id: string; state: string }> {
  return Promise.resolve({ id: 'rs1', state: 'WAITING_FOR_REVIEW' });
}

function releaseVersion(): Promise<void> {
  return Promise.resolve();
}

/** Fully-stubbed AscReleaseApi. One live version by default; writes create a resource. */
export function makeReleaseApiFake(methodOverrides: Partial<AscReleaseApi> = {}): AscReleaseApi {
  const baseApi: AscReleaseApi = {
    getAppId: vi.fn(readAppId),
    getLatestMarketingVersion: vi.fn(readMarketingVersion),
    listBuilds: vi.fn(readBuilds),
    findBuild: vi.fn(readBuild),
    findBuildByVersion: vi.fn(readBuildByVersion),
    setBuildUsesNonExemptEncryption: vi.fn(setEncryption),
    listAppStoreVersions: vi.fn(readVersions),
    createAppStoreVersion: vi.fn(createVersion),
    updateAppStoreVersion: vi.fn(updateVersion),
    selectBuildForVersion: vi.fn(selectBuild),
    listAppStoreVersionLocalizations: vi.fn(readLocalizations),
    createAppStoreVersionLocalization: vi.fn(createLocalization),
    updateAppStoreVersionLocalization: vi.fn(updateLocalization),
    getPhasedRelease: vi.fn(readPhasedRelease),
    createPhasedRelease: vi.fn(createPhasedRelease),
    deletePhasedRelease: vi.fn(deletePhasedRelease),
    listReviewSubmissions: vi.fn(readReviewSubmissions),
    createReviewSubmission: vi.fn(createReviewSubmission),
    addReviewSubmissionItem: vi.fn(addReviewItem),
    submitReviewSubmission: vi.fn(submitReview),
    getReviewSubmission: vi.fn(readReviewSubmission),
    createAppStoreVersionReleaseRequest: vi.fn(releaseVersion),
  };

  return { ...baseApi, ...methodOverrides };
}
