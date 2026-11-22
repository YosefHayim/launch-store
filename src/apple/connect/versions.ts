import type {
  AppStoreReviewDetailResource,
  AppStoreVersionLocalizationResource,
  AppStoreVersionResource,
  ListingLocalization,
  PhasedReleaseResource,
  ReviewSubmissionResource,
} from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import type { ResourceList, VersionStates, ResourceSingle, AppStoreVersionPage } from './shared.ts';
import {
  EDITABLE_VERSION_STATES,
  LIVE_STATES,
  VERSION_LISTING_FIELDS,
  findVersionId,
  pickListingFields,
  EDITABLE_METADATA_STATES,
  toVersionResource,
  toPhasedRelease,
} from './shared.ts';

export class ConnectVersions {
  constructor(private readonly client: AscHost) {}

  async getEditableVersionId(appId: string): Promise<string | null> {
    const versions = await this.listVersionStates(appId);
    return findVersionId(versions, EDITABLE_VERSION_STATES);
  }

  async getCurrentVersionId(appId: string): Promise<string | null> {
    const versions = await this.listVersionStates(appId);
    const editableVersionId = findVersionId(versions, EDITABLE_VERSION_STATES);
    if (editableVersionId != null) return editableVersionId;
    return findVersionId(versions, LIVE_STATES);
  }

  async listVersionStates(appId: string): Promise<ResourceList<VersionStates>['data']> {
    const { data: versions } = await this.client.request<ResourceList<VersionStates>>(
      'GET',
      `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=appStoreState&limit=20`,
    );
    return versions;
  }

  async listVersionLocalizations(versionId: string): Promise<ListingLocalization[]> {
    const appleResources = await this.client.requestAll<Record<string, unknown>>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`,
    );
    return appleResources.map((localization) => {
      const localeAttribute = localization.attributes['locale'];
      let locale = '';
      if (typeof localeAttribute == 'string') locale = localeAttribute;
      return {
        id: localization.id,
        locale,
        fields: pickListingFields(localization.attributes, VERSION_LISTING_FIELDS),
      };
    });
  }

  async createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.client.createResource('/appStoreVersionLocalizations', {
      type: 'appStoreVersionLocalizations',
      attributes: { locale, ...fields },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  }

  async updateVersionLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.client.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: fields,
    });
  }

  async findEditableAppStoreVersion(
    appId: string,
    platform: string,
  ): Promise<{
    id: string;
    copyright: string;
  } | null> {
    const appleResources = await this.client.requestAll<{
      appVersionState?: string;
      appStoreState?: string;
      copyright?: string | null;
    }>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=50&fields[appStoreVersions]=appVersionState,appStoreState,copyright`,
    );
    const editable = appleResources.find((version) => {
      let versionState = version.attributes.appVersionState;
      if (versionState == null) versionState = version.attributes.appStoreState;
      if (versionState == null) return false;
      return EDITABLE_METADATA_STATES.has(versionState);
    });
    if (editable == null) return null;
    let copyright = editable.attributes.copyright;
    if (typeof copyright != 'string') copyright = '';
    return { id: editable.id, copyright };
  }

  async getAppStoreReviewDetail(versionId: string): Promise<AppStoreReviewDetailResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
          attributes?: Record<string, string | boolean>;
        } | null;
      }>('GET', `/appStoreVersions/${versionId}/appStoreReviewDetail`);
      if (appleResources == null) return null;
      let reviewAttributes = appleResources.attributes;
      if (reviewAttributes == null) reviewAttributes = {};
      return { id: appleResources.id, attributes: reviewAttributes };
    });
  }

  async createAppStoreReviewDetail(
    versionId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<{
    id: string;
  }> {
    const appleResources = await this.client.createResource('/appStoreReviewDetails', {
      type: 'appStoreReviewDetails',
      attributes,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    return { id: appleResources.id };
  }

  async updateAppStoreReviewDetail(
    detailId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<void> {
    await this.client.updateResource(`/appStoreReviewDetails/${detailId}`, {
      type: 'appStoreReviewDetails',
      id: detailId,
      attributes,
    });
  }

  async listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]> {
    const versionPages = await this.client.requestPages<AppStoreVersionPage>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=200&fields[appStoreVersions]=versionString,appStoreState,releaseType,build&include=build&fields[builds]=version,processingState`,
    );
    return versionPages.flatMap(({ data: entries, included = [] }) =>
      entries.map((versionEntry) => toVersionResource(versionEntry, '', included)),
    );
  }

  async createAppStoreVersion(
    appId: string,
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource> {
    const attributes: Record<string, string> = {
      platform: input.platform,
      versionString: input.versionString,
    };
    if (input.releaseType) attributes['releaseType'] = input.releaseType;
    if (input.earliestReleaseDate) attributes['earliestReleaseDate'] = input.earliestReleaseDate;
    const appleResources = await this.client.createResource<{
      versionString?: string;
      appStoreState?: string;
      releaseType?: string;
    }>('/appStoreVersions', {
      type: 'appStoreVersions',
      attributes,
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return toVersionResource(
      { id: appleResources.id, attributes: appleResources.attributes },
      input.versionString,
    );
  }

  async updateAppStoreVersion(
    versionId: string,
    input: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
      copyright?: string;
    },
  ): Promise<void> {
    const attributes: Record<string, string> = {};
    if (input.releaseType) attributes['releaseType'] = input.releaseType;
    if (input.earliestReleaseDate) attributes['earliestReleaseDate'] = input.earliestReleaseDate;
    if (input.versionString) attributes['versionString'] = input.versionString;
    if (input.copyright) attributes['copyright'] = input.copyright;
    await this.client.updateResource(`/appStoreVersions/${versionId}`, {
      type: 'appStoreVersions',
      id: versionId,
      attributes,
    });
  }

  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    await this.client.request<unknown>(
      'PATCH',
      `/appStoreVersions/${versionId}/relationships/build`,
      {
        data: { type: 'builds', id: buildId },
      },
    );
  }

  async listAppStoreVersionLocalizations(
    versionId: string,
  ): Promise<AppStoreVersionLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      whatsNew?: string;
    }>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200&fields[appStoreVersionLocalizations]=locale,whatsNew`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale == null) return [];
      const versionLocalization: AppStoreVersionLocalizationResource = {
        id: localization.id,
        locale,
      };
      if (localization.attributes.whatsNew != null)
        Object.assign(versionLocalization, { whatsNew: localization.attributes.whatsNew });
      return [versionLocalization];
    });
  }

  async createAppStoreVersionLocalization(
    versionId: string,
    input: {
      locale: string;
      whatsNew: string;
    },
  ): Promise<AppStoreVersionLocalizationResource> {
    const appleResources = await this.client.createResource<{
      locale?: string;
      whatsNew?: string;
    }>('/appStoreVersionLocalizations', {
      type: 'appStoreVersionLocalizations',
      attributes: { locale: input.locale, whatsNew: input.whatsNew },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    let locale = appleResources.attributes.locale;
    if (locale == null) locale = input.locale;
    const versionLocalization: AppStoreVersionLocalizationResource = {
      id: appleResources.id,
      locale,
    };
    if (appleResources.attributes.whatsNew != null)
      Object.assign(versionLocalization, { whatsNew: appleResources.attributes.whatsNew });
    return versionLocalization;
  }

  async updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void> {
    await this.client.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  }

  async getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
          attributes: {
            phasedReleaseState?: string;
            currentDayNumber?: number;
          };
        } | null;
      }>('GET', `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`);
      if (appleResources == null) return null;
      return toPhasedRelease(appleResources);
    });
  }

  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    const appleResources = await this.client.createResource<{
      phasedReleaseState?: string;
      currentDayNumber?: number;
    }>('/appStoreVersionPhasedReleases', {
      type: 'appStoreVersionPhasedReleases',
      attributes: { phasedReleaseState: 'ACTIVE' },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    return toPhasedRelease({ id: appleResources.id, attributes: appleResources.attributes });
  }

  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    await this.client.updateResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
      type: 'appStoreVersionPhasedReleases',
      id: phasedReleaseId,
      attributes: { phasedReleaseState },
    });
  }

  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    await this.client.deleteResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`);
  }

  async listReviewSubmissions(
    appId: string,
    platform: string,
  ): Promise<ReviewSubmissionResource[]> {
    const appleResources = await this.client.requestAll<{
      state?: string;
    }>(
      `/apps/${appId}/reviewSubmissions?filter[platform]=${platform}&limit=200&fields[reviewSubmissions]=state`,
    );
    return appleResources.map((submission) => {
      let state = submission.attributes.state;
      if (state == null) state = '';
      return { id: submission.id, state };
    });
  }

  async createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource> {
    const appleResources = await this.client.createResource<{
      state?: string;
    }>('/reviewSubmissions', {
      type: 'reviewSubmissions',
      attributes: { platform },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let state = appleResources.attributes.state;
    if (state == null) state = '';
    return { id: appleResources.id, state };
  }

  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    await this.client.createResource('/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    });
  }

  async addExperimentReviewSubmissionItem(
    submissionId: string,
    experimentId: string,
  ): Promise<void> {
    await this.client.createResource('/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersionExperimentV2: {
          data: { type: 'appStoreVersionExperiments', id: experimentId },
        },
      },
    });
  }

  async submitReviewSubmission(submissionId: string): Promise<void> {
    await this.client.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    });
  }

  async createAppStoreVersionReleaseRequest(versionId: string): Promise<void> {
    await this.client.createResource('/appStoreVersionReleaseRequests', {
      type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  }

  async cancelReviewSubmission(submissionId: string): Promise<void> {
    await this.client.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { canceled: true },
    });
  }

  async getReviewSubmission(submissionId: string): Promise<ReviewSubmissionResource> {
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        state?: string;
      }>
    >('GET', `/reviewSubmissions/${submissionId}?fields[reviewSubmissions]=state`);
    let state = appleResources.attributes.state;
    if (state == null) state = '';
    return { id: appleResources.id, state };
  }
}
