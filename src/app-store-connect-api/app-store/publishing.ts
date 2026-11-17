import type { PhasedReleaseResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-store-version-phased-releases
/** Map a raw phased-release row onto a PhasedReleaseResource. */
const toPhasedRelease = (entry: {
  id: string;
  attributes: {
    phasedReleaseState?: string;
    currentDayNumber?: number;
  };
}): PhasedReleaseResource => {
  let phasedReleaseState = entry.attributes.phasedReleaseState;
  if (phasedReleaseState === undefined) phasedReleaseState = '';
  const phasedRelease: PhasedReleaseResource = {
    id: entry.id,
    phasedReleaseState,
  };
  if (entry.attributes.currentDayNumber !== undefined)
    Object.assign(phasedRelease, { currentDayNumber: entry.attributes.currentDayNumber });
  return phasedRelease;
};
export const makePublishingApi = (api: AppStoreConnectRequests) => {
  /** A version's phased-release schedule, or null when none has been created yet (a fresh version). */
  const getPhasedRelease = async (versionId: string): Promise<PhasedReleaseResource | null> => {
    return api.getOptional(async () => {
      const { data: appleResources } = await api.request<{
        data: {
          id: string;
          attributes: {
            phasedReleaseState?: string;
            currentDayNumber?: number;
          };
        } | null;
      }>('GET', `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`);
      if (appleResources === null) return null;
      return toPhasedRelease(appleResources);
    });
  };
  /** Create a phased release on a version (starts `ACTIVE`; takes effect once the version goes live). */
  const createPhasedRelease = async (versionId: string): Promise<PhasedReleaseResource> => {
    const appleResources = await api.createResource<{
      phasedReleaseState?: string;
      currentDayNumber?: number;
    }>('/appStoreVersionPhasedReleases', {
      type: 'appStoreVersionPhasedReleases',
      attributes: { phasedReleaseState: 'ACTIVE' },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    return toPhasedRelease({ id: appleResources.id, attributes: appleResources.attributes });
  };
  /** Steer a phased release: `PAUSE`, `ACTIVE` (resume), or `COMPLETE` (finish the ramp now). */
  const updatePhasedRelease = async (
    phasedReleaseId: string,
    phasedReleaseState: string,
  ): Promise<void> => {
    await api.updateResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
      type: 'appStoreVersionPhasedReleases',
      id: phasedReleaseId,
      attributes: { phasedReleaseState },
    });
  };
  /** Remove a phased release (opt back into an immediate 100% rollout before go-live). */
  const deletePhasedRelease = async (phasedReleaseId: string): Promise<void> => {
    await api.deleteResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`);
  };
  /**
   * Fire the developer release for an approved version held at `PENDING_DEVELOPER_RELEASE` - the API form
   * of pressing "Release this version" in App Store Connect. Used by `launch release-train` to release a
   * held (`--hold`) version once its synchronized gate opens; a no-op-on-Apple's-side for a version that
   * isn't pending developer release (Apple rejects it, surfaced as an AscRequestError).
   */
  const createAppStoreVersionReleaseRequest = async (versionId: string): Promise<void> => {
    await api.createResource('/appStoreVersionReleaseRequests', {
      type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  };

  return {
    getPhasedRelease,
    createPhasedRelease,
    updatePhasedRelease,
    deletePhasedRelease,
    createAppStoreVersionReleaseRequest,
  };
};
