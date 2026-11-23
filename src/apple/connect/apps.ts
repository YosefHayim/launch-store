import type {
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AppInfoResource,
  ListingLocalization,
} from '@/types/apple-catalog.js';
import type { AscHost } from './host.ts';
import type { ResourceList, AppInfoStates } from './shared.ts';
import {
  REQUIRED_AGREEMENTS_ERROR_CODE,
  EDITABLE_APPINFO_STATES,
  LIVE_STATES,
  APP_INFO_LISTING_FIELDS,
  AscRequestError,
  findAppInfoId,
  pickListingFields,
  EDITABLE_METADATA_STATES,
  summarizeAppleApp,
} from './shared.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectApps {
  constructor(private readonly client: AscHost) {}

  /**
   * Find and list apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps
   */
  async getAppId(bundleId: string): Promise<string | null> {
    const uRIComponent = encodeURIComponent(bundleId);
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        bundleId: string;
      }>
    >('GET', `/apps?filter[bundleId]=${uRIComponent}&limit=1`);
    const appResource = appleResources[0];

    if (appResource == null) return null;

    return appResource.id;
  }

  async getEditableAppInfoId(appId: string): Promise<string | null> {
    const appInfos = await this.listAppInfoStates(appId);
    return findAppInfoId(appInfos, EDITABLE_APPINFO_STATES);
  }

  async getCurrentAppInfoId(appId: string): Promise<string | null> {
    const appInfos = await this.listAppInfoStates(appId);
    const editableAppInfoId = findAppInfoId(appInfos, EDITABLE_APPINFO_STATES);

    if (editableAppInfoId != null) return editableAppInfoId;

    return findAppInfoId(appInfos, LIVE_STATES);
  }

  /**
   * Get information about an app that is currently live on App Store, or that goes live with the
   * next version.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos
   */
  async listAppInfoStates(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ResourceList<AppInfoStates>['data']> {
    const { data: appInfos } = await this.client.request<ResourceList<AppInfoStates>>(
      'GET',
      applyAppleListQuery(
        `/apps/${appId}/appInfos?fields[appInfos]=state,appStoreState`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    return appInfos;
  }

  /**
   * Get a list of localized, app-level information for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-appinfolocalizations
   */
  async listAppInfoLocalizations(
    appInfoId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<ListingLocalization[]> {
    const appleResources = await this.client.requestAll<Record<string, unknown>>(
      applyAppleListQuery(
        `/appInfos/${appInfoId}/appInfoLocalizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyAppInfoLocalization(localization: {
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
        fields: pickListingFields(localization.attributes, APP_INFO_LISTING_FIELDS),
      };
    }

    return appleResources.map(copyAppInfoLocalization);
  }

  /**
   * Get a list of localized, app-level information for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-appinfolocalizations
   */
  async listAccountDeletionUrls(
    appInfoId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<
    {
      locale: string;
      url: string;
    }[]
  > {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      privacyChoicesUrl?: string | null;
    }>(
      applyAppleListQuery(
        `/appInfos/${appInfoId}/appInfoLocalizations?fields[appInfoLocalizations]=locale,privacyChoicesUrl`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyAccountDeletionUrl(localization: {
      id: string;
      attributes: { locale?: string; privacyChoicesUrl?: string | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let locale = localization.attributes.locale;

      if (locale == null) locale = '';

      let accountDeletionUrl = localization.attributes.privacyChoicesUrl;

      if (typeof accountDeletionUrl != 'string') accountDeletionUrl = '';

      return { locale, url: accountDeletionUrl };
    }

    return appleResources.map(copyAccountDeletionUrl);
  }

  /**
   * Add app-level localized information for a new locale.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appinfolocalizations
   */
  async createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.client.createResource('/appInfoLocalizations', {
      type: 'appInfoLocalizations',
      attributes: { locale, ...fields },
      relationships: { appInfo: { data: { type: 'appInfos', id: appInfoId } } },
    });
  }

  /**
   * Modify localized app-level information for a particular language.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfolocalizations-_id_
   */
  async updateAppInfoLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.client.updateResource(`/appInfoLocalizations/${localizationId}`, {
      type: 'appInfoLocalizations',
      id: localizationId,
      attributes: fields,
    });
  }

  /**
   * Find and list bundle IDs that are registered to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids
   */
  async assertReady(): Promise<void> {
    await this.client.request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
  }

  /**
   * Find and list bundle IDs that are registered to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids
   */
  async checkRequiredAgreements(): Promise<boolean> {
    try {
      await this.client.request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
      return true;
    } catch (error) {
      function hasRequiredAgreementsCode(code: string) {
        return code.includes(REQUIRED_AGREEMENTS_ERROR_CODE);
      }

      if (
        error instanceof AscRequestError &&
        error.status == 403 &&
        error.codes.some(hasRequiredAgreementsCode)
      ) {
        return false;
      }

      throw error;
    }
  }

  /**
   * Find and list bundle IDs that are registered to your team.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-bundleids
   */
  async resolveTeamId(): Promise<string | null> {
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        seedId?: string;
      }>
    >('GET', '/bundleIds?limit=1&fields[bundleIds]=seedId');
    const bundleIdResource = appleResources[0];

    if (bundleIdResource == null) return null;

    const teamId = bundleIdResource.attributes.seedId;

    if (teamId == null) return null;

    return teamId;
  }

  /**
   * Find and list apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps
   */
  async listAppNames(listQuery: AppleListQuery | null = null): Promise<string[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
    }>(applyAppleListQuery('/apps?fields[apps]=name', listQuery, APPLE_PAGE_LIMIT));

    function readName(entry: {
      id: string;
      attributes: { name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      return entry.attributes.name;
    }

    function isPresentAppName(name: string | undefined): name is string {
      return Boolean(name);
    }

    return appleResources.map(readName).filter(isPresentAppName);
  }

  /**
   * Find and list apps in App Store Connect.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps
   */
  async listApps(
    listQuery: AppleListQuery | null = null,
  ): Promise<{ id: string; name: string; bundleId: string | null }[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      bundleId?: string;
    }>(applyAppleListQuery('/apps?fields[apps]=name,bundleId', listQuery, APPLE_PAGE_LIMIT));

    return appleResources.map(summarizeAppleApp);
  }

  /**
   * Get information about an app that is currently live on App Store, or that goes live with the
   * next version.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos
   */
  async getAppInfo(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppInfoResource | null> {
    const { data: appleResources } = await this.client.request<{
      data: {
        id: string;
        attributes?: {
          state?: string;
          appStoreState?: string;
        };
        relationships?: {
          primaryCategory?: {
            data?: {
              id: string;
            } | null;
          };
          secondaryCategory?: {
            data?: {
              id: string;
            } | null;
          };
        };
      }[];
    }>(
      'GET',
      applyAppleListQuery(
        `/apps/${appId}/appInfos?include=primaryCategory,secondaryCategory`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    if (appleResources.length == 0) return null;

    function readReadyAppInfo(appInformation: {
      id: string;
      attributes?: { state?: string; appStoreState?: string };
      relationships?: {
        primaryCategory?: { data?: { id: string } | null };
        secondaryCategory?: { data?: { id: string } | null };
      };
    }) {
      let appInformationState = appInformation.attributes?.state;

      if (appInformationState == null)
        appInformationState = appInformation.attributes?.appStoreState;

      if (appInformationState == null) return false;

      return EDITABLE_METADATA_STATES.has(appInformationState);
    }

    const editable = appleResources.find(readReadyAppInfo);
    let selectedAppInformation = editable;

    if (selectedAppInformation == null) selectedAppInformation = appleResources[0];

    if (selectedAppInformation == null) return null;

    let state = selectedAppInformation.attributes?.state;

    if (state == null) state = selectedAppInformation.attributes?.appStoreState;

    const primaryCategoryId = selectedAppInformation.relationships?.primaryCategory?.data?.id;
    const secondaryCategoryId = selectedAppInformation.relationships?.secondaryCategory?.data?.id;
    const appInformationResource: AppInfoResource = { id: selectedAppInformation.id };

    if (state != null) Object.assign(appInformationResource, { state });

    if (primaryCategoryId != null) Object.assign(appInformationResource, { primaryCategoryId });

    if (secondaryCategoryId != null) Object.assign(appInformationResource, { secondaryCategoryId });

    return appInformationResource;
  }

  /**
   * Update the App Store categories and sub-categories for your app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appinfos-_id_
   */
  async updateAppInfoCategories(
    appInfoId: string,
    categories: {
      primaryCategoryId?: string;
      secondaryCategoryId?: string | null;
    },
  ): Promise<void> {
    function secondaryCategoryRelationship(categoryId: string | null | undefined): {
      type: 'appCategories';
      id: string;
    } | null {
      const hasCategoryId = categoryId != null;

      if (hasCategoryId == false) {
        return null;
      }

      return { type: 'appCategories', id: categoryId };
    }

    const relationships: Record<
      string,
      {
        data: {
          type: 'appCategories';
          id: string;
        } | null;
      }
    > = {};

    if (categories.primaryCategoryId) {
      relationships['primaryCategory'] = {
        data: { type: 'appCategories', id: categories.primaryCategoryId },
      };
    }

    const secondaryCategoryId = categories.secondaryCategoryId;
    const secondaryCategoryIsOmitted = typeof secondaryCategoryId == 'undefined';

    if (secondaryCategoryIsOmitted == false) {
      relationships['secondaryCategory'] = {
        data: secondaryCategoryRelationship(secondaryCategoryId),
      };
    }

    await this.client.request<unknown>('PATCH', `/appInfos/${appInfoId}`, {
      data: { type: 'appInfos', id: appInfoId, relationships },
    });
  }

  /**
   * Get the age-rating declaration for an app info.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-ageratingdeclaration
   */
  async getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
          attributes?: Record<string, AgeRatingValue>;
        } | null;
      }>('GET', `/appInfos/${appInfoId}/ageRatingDeclaration`);

      if (appleResources == null) return null;

      let declarationAttributes = appleResources.attributes;

      if (declarationAttributes == null) declarationAttributes = {};

      return { id: appleResources.id, attributes: declarationAttributes };
    });
  }

  /**
   * Provide age-related information so the App Store can determine the age rating for your app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-ageratingdeclarations-_id_
   */
  async updateAgeRatingDeclaration(
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ): Promise<void> {
    await this.client.updateResource(`/ageRatingDeclarations/${declarationId}`, {
      type: 'ageRatingDeclarations',
      id: declarationId,
      attributes,
    });
  }
}
