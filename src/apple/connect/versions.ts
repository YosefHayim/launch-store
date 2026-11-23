import type {
  AppStoreReviewDetailResource,
  AppStoreVersionLocalizationResource,
  AppStoreVersionResource,
  ListingLocalization,
  PhasedReleaseResource,
  ReviewSubmissionResource,
} from '@/types/apple-catalog.js';
import type { AscHost } from './host.ts';
import type { ResourceList, VersionStates, ResourceSingle, AppStoreVersionPage } from './shared.ts';
import {
  EDITABLE_VERSION_STATES,
  LIVE_STATES,
  VERSION_LISTING_FIELDS,
  findVersionId,
  pickListingFields,
  EDITABLE_METADATA_STATES,
  readVersionResource,
  readPhasedRelease,
} from './shared.ts';
import {
  APPLE_PAGE_LIMIT,
  applyAppleListQuery,
  applyAppleReadQuery,
  type AppleListQuery,
} from './list-query.ts';

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

  /**
   * Get a list of all App Store versions of an app across all platforms.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions
   */
  async listVersionStates(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ResourceList<VersionStates>['data']> {
    const { data: versions } = await this.client.request<ResourceList<VersionStates>>(
      'GET',
      applyAppleListQuery(`/apps/${appId}/appStoreVersions`, listQuery, APPLE_PAGE_LIMIT, {
        'fields[appStoreVersions]': 'appStoreState',
      }),
    );

    return versions;
  }

  /**
   * Get a list of localized, version-level information about an app, for all locales.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations
   */
  async listVersionLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ListingLocalization[]> {
    const appleResources = await this.client.requestAll<Record<string, unknown>>(
      applyAppleListQuery(
        `/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyVersionLocalization(localization: {
      id: string;
      attributes: Record<string, unknown>;
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const localeAttribute = localization.attributes['locale'];
      let locale = '';

      if (typeof localeAttribute == 'string') locale = localeAttribute;

      return {
        id: localization.id,
        locale,
        fields: pickListingFields(localization.attributes, VERSION_LISTING_FIELDS),
      };
    }

    return appleResources.map(copyVersionLocalization);
  }

  /**
   * Add localized version-level information for a new locale.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionlocalizations
   */
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

  /**
   * Modify localized version-level information for a particular language.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_
   */
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

  /**
   * Get a list of all App Store versions of an app across all platforms.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions
   */
  async findEditableAppStoreVersion(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<{
    id: string;
    copyright: string;
  } | null> {
    const appleResources = await this.client.requestAll<{
      appVersionState?: string;
      appStoreState?: string;
      copyright?: string | null;
    }>(
      applyAppleListQuery(
        `/apps/${appId}/appStoreVersions?filter[platform]=${platform}`,
        listQuery,
        APPLE_PAGE_LIMIT,
        {
          'fields[appStoreVersions]': 'appVersionState,appStoreState,copyright',
        },
      ),
    );

    function isEditableVersion(version: {
      id: string;
      attributes: { appVersionState?: string; appStoreState?: string; copyright?: string | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let versionState = version.attributes.appVersionState;

      if (versionState == null) versionState = version.attributes.appStoreState;

      if (versionState == null) return false;

      return EDITABLE_METADATA_STATES.has(versionState);
    }

    const editable = appleResources.find(isEditableVersion);

    if (editable == null) return null;

    let copyright = editable.attributes.copyright;

    if (typeof copyright != 'string') copyright = '';

    return { id: editable.id, copyright };
  }

  /**
   * Get the details you provide to App Review so they can test your app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstorereviewdetail
   */
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

  /**
   * Add App Store review details to an App Store version, including contact and demo account
   * information.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstorereviewdetails
   */
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

  /**
   * Update the App Store review details, including the contact information, demo account, and
   * notes.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstorereviewdetails-_id_
   */
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

  /**
   * Get a list of all App Store versions of an app across all platforms.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions
   */
  async listAppStoreVersions(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppStoreVersionResource[]> {
    const versionPages = await this.client.requestPages<AppStoreVersionPage>(
      applyAppleListQuery(
        `/apps/${appId}/appStoreVersions?filter[platform]=${platform}`,
        listQuery,
        APPLE_PAGE_LIMIT,
        {
          'fields[appStoreVersions]': 'versionString,appStoreState,releaseType,build',
          include: 'build',
          'fields[builds]': 'version,processingState',
        },
      ),
    );

    return versionPages.flatMap(({ data: entries, included = [] }) =>
      entries.map((versionEntry) => readVersionResource(versionEntry, '', included)),
    );
  }

  /**
   * Add a new App Store version or platform to an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversions
   */
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

    return readVersionResource(
      { id: appleResources.id, attributes: appleResources.attributes },
      input.versionString,
    );
  }

  /**
   * Update the App Store version for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_
   */
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

  /**
   * Change the build that is attached to a specific App Store version.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_-relationships-build
   */
  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    await this.client.request<unknown>(
      'PATCH',
      `/appStoreVersions/${versionId}/relationships/build`,
      {
        data: { type: 'builds', id: buildId },
      },
    );
  }

  /**
   * Get a list of localized, version-level information about an app, for all locales.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations
   */
  async listAppStoreVersionLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppStoreVersionLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      whatsNew?: string;
    }>(
      applyAppleListQuery(
        `/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
        { 'fields[appStoreVersionLocalizations]': 'locale,whatsNew' },
      ),
    );

    function readVersionLocalization(localization: {
      id: string;
      attributes: { locale?: string; whatsNew?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const locale = localization.attributes.locale;

      if (locale == null) return [];

      const versionLocalization: AppStoreVersionLocalizationResource = {
        id: localization.id,
        locale,
      };

      if (localization.attributes.whatsNew != null)
        Object.assign(versionLocalization, { whatsNew: localization.attributes.whatsNew });

      return [versionLocalization];
    }

    return appleResources.flatMap(readVersionLocalization);
  }

  /**
   * Add localized version-level information for a new locale.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionlocalizations
   */
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

  /**
   * Modify localized version-level information for a particular language.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_
   */
  async updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void> {
    await this.client.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  }

  /**
   * Read the phased release status and configuration for a version with phased release enabled.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionphasedrelease
   */
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

      return readPhasedRelease(appleResources);
    });
  }

  /**
   * Enable phased release for an App Store version.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionphasedreleases
   */
  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    const appleResources = await this.client.createResource<{
      phasedReleaseState?: string;
      currentDayNumber?: number;
    }>('/appStoreVersionPhasedReleases', {
      type: 'appStoreVersionPhasedReleases',
      attributes: { phasedReleaseState: 'ACTIVE' },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });

    return readPhasedRelease({ id: appleResources.id, attributes: appleResources.attributes });
  }

  /**
   * Pause or resume a phased release, or immediately release an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionphasedreleases-_id_
   */
  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    await this.client.updateResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
      type: 'appStoreVersionPhasedReleases',
      id: phasedReleaseId,
      attributes: { phasedReleaseState },
    });
  }

  /**
   * Cancel a planned phased release that has not been started.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/delete-v1-appstoreversionphasedreleases-_id_
   */
  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    await this.client.deleteResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`);
  }

  /**
   * Get a list of review submissions associated with a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-reviewsubmissions
   */
  async listReviewSubmissions(
    appId: string,
    platform: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewSubmissionResource[]> {
    const appleResources = await this.client.requestAll<{
      state?: string;
    }>(
      applyAppleListQuery(
        `/apps/${appId}/reviewSubmissions?filter[platform]=${platform}`,
        listQuery,
        APPLE_PAGE_LIMIT,
        { 'fields[reviewSubmissions]': 'state' },
      ),
    );

    function copyReviewSubmission(submission: {
      id: string;
      attributes: { state?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let state = submission.attributes.state;

      if (state == null) state = '';

      return { id: submission.id, state };
    }

    return appleResources.map(copyReviewSubmission);
  }

  /**
   * Create a review submission for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions
   */
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

  /**
   * Create a new review submission item.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems
   */
  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    await this.client.createResource('/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    });
  }

  /**
   * Create a new review submission item.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems
   */
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

  /**
   * Edit the details or contents of a review submission.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_
   */
  async submitReviewSubmission(submissionId: string): Promise<void> {
    await this.client.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    });
  }

  /**
   * Release an approved version of your app to the App Store.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionreleaserequests
   */
  async createAppStoreVersionReleaseRequest(versionId: string): Promise<void> {
    await this.client.createResource('/appStoreVersionReleaseRequests', {
      type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  }

  /**
   * Edit the details or contents of a review submission.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_
   */
  async cancelReviewSubmission(submissionId: string): Promise<void> {
    await this.client.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { canceled: true },
    });
  }

  /**
   * Read information about a specific review submisison.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions-_id_
   */
  async getReviewSubmission(
    submissionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ReviewSubmissionResource> {
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        state?: string;
      }>
    >(
      'GET',
      applyAppleReadQuery(`/reviewSubmissions/${submissionId}`, listQuery, {
        'fields[reviewSubmissions]': 'state',
      }),
    );
    let state = appleResources.attributes.state;

    if (state == null) state = '';

    return { id: appleResources.id, state };
  }
}
