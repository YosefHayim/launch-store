import type {
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AppInfoResource,
  ListingLocalization,
} from '../../types/appleCatalog.ts';
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

export class ConnectApps {
  constructor(private readonly client: AscHost) {}

  async getAppId(bundleId: string): Promise<string | null> {
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        bundleId: string;
      }>
    >('GET', `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
    const appResource = appleResources[0];
    if (appResource === undefined) return null;
    return appResource.id;
  }

  async getEditableAppInfoId(appId: string): Promise<string | null> {
    const appInfos = await this.listAppInfoStates(appId);
    return findAppInfoId(appInfos, EDITABLE_APPINFO_STATES);
  }

  async getCurrentAppInfoId(appId: string): Promise<string | null> {
    const appInfos = await this.listAppInfoStates(appId);
    const editableAppInfoId = findAppInfoId(appInfos, EDITABLE_APPINFO_STATES);
    if (editableAppInfoId !== null) return editableAppInfoId;
    return findAppInfoId(appInfos, LIVE_STATES);
  }

  async listAppInfoStates(appId: string): Promise<ResourceList<AppInfoStates>['data']> {
    const { data: appInfos } = await this.client.request<ResourceList<AppInfoStates>>(
      'GET',
      `/apps/${appId}/appInfos?fields[appInfos]=state,appStoreState&limit=20`,
    );
    return appInfos;
  }

  async listAppInfoLocalizations(appInfoId: string): Promise<ListingLocalization[]> {
    const appleResources = await this.client.requestAll<Record<string, unknown>>(
      `/appInfos/${appInfoId}/appInfoLocalizations?limit=200`,
    );
    return appleResources.map((localization) => {
      const localeAttribute = localization.attributes['locale'];
      let locale = '';
      if (typeof localeAttribute === 'string') locale = localeAttribute;
      return {
        id: localization.id,
        locale,
        fields: pickListingFields(localization.attributes, APP_INFO_LISTING_FIELDS),
      };
    });
  }

  async listAccountDeletionUrls(appInfoId: string): Promise<
    {
      locale: string;
      url: string;
    }[]
  > {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      privacyChoicesUrl?: string | null;
    }>(
      `/appInfos/${appInfoId}/appInfoLocalizations?limit=200&fields[appInfoLocalizations]=locale,privacyChoicesUrl`,
    );
    return appleResources.map((localization) => {
      let locale = localization.attributes.locale;
      if (locale === undefined) locale = '';
      let accountDeletionUrl = localization.attributes.privacyChoicesUrl;
      if (typeof accountDeletionUrl !== 'string') accountDeletionUrl = '';
      return { locale, url: accountDeletionUrl };
    });
  }

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

  async assertReady(): Promise<void> {
    await this.client.request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
  }

  async checkRequiredAgreements(): Promise<boolean> {
    try {
      await this.client.request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
      return true;
    } catch (error) {
      if (
        error instanceof AscRequestError &&
        error.status === 403 &&
        error.codes.some((code) => code.includes(REQUIRED_AGREEMENTS_ERROR_CODE))
      ) {
        return false;
      }
      throw error;
    }
  }

  async resolveTeamId(): Promise<string | null> {
    const { data: appleResources } = await this.client.request<
      ResourceList<{
        seedId?: string;
      }>
    >('GET', '/bundleIds?limit=1&fields[bundleIds]=seedId');
    const bundleIdResource = appleResources[0];
    if (bundleIdResource === undefined) return null;
    const teamId = bundleIdResource.attributes.seedId;
    if (teamId === undefined) return null;
    return teamId;
  }

  async listAppNames(): Promise<string[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
    }>('/apps?fields[apps]=name&limit=200');
    return appleResources
      .map((entry) => entry.attributes.name)
      .filter((name): name is string => Boolean(name));
  }

  async listApps(): Promise<{ id: string; name: string; bundleId: string | null }[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
      bundleId?: string;
    }>('/apps?fields[apps]=name,bundleId&limit=200');
    return appleResources.map(summarizeAppleApp);
  }

  async getAppInfo(appId: string): Promise<AppInfoResource | null> {
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
    }>('GET', `/apps/${appId}/appInfos?include=primaryCategory,secondaryCategory&limit=200`);
    if (appleResources.length === 0) return null;
    const editable = appleResources.find((appInformation) => {
      let appInformationState = appInformation.attributes?.state;
      if (appInformationState === undefined)
        appInformationState = appInformation.attributes?.appStoreState;
      if (appInformationState === undefined) return false;
      return EDITABLE_METADATA_STATES.has(appInformationState);
    });
    let selectedAppInformation = editable;
    if (selectedAppInformation === undefined) selectedAppInformation = appleResources[0];
    if (selectedAppInformation === undefined) return null;
    let state = selectedAppInformation.attributes?.state;
    if (state === undefined) state = selectedAppInformation.attributes?.appStoreState;
    const primaryCategoryId = selectedAppInformation.relationships?.primaryCategory?.data?.id;
    const secondaryCategoryId = selectedAppInformation.relationships?.secondaryCategory?.data?.id;
    const appInformationResource: AppInfoResource = { id: selectedAppInformation.id };
    if (state !== undefined) Object.assign(appInformationResource, { state });
    if (primaryCategoryId !== undefined)
      Object.assign(appInformationResource, { primaryCategoryId });
    if (secondaryCategoryId !== undefined)
      Object.assign(appInformationResource, { secondaryCategoryId });
    return appInformationResource;
  }

  async updateAppInfoCategories(
    appInfoId: string,
    categories: {
      primaryCategoryId?: string;
      secondaryCategoryId?: string | null;
    },
  ): Promise<void> {
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
    if (categories.secondaryCategoryId !== undefined) {
      let secondaryCategory = null;
      if (categories.secondaryCategoryId !== null)
        secondaryCategory = { type: 'appCategories' as const, id: categories.secondaryCategoryId };
      relationships['secondaryCategory'] = {
        data: secondaryCategory,
      };
    }
    await this.client.request<unknown>('PATCH', `/appInfos/${appInfoId}`, {
      data: { type: 'appInfos', id: appInfoId, relationships },
    });
  }

  async getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
          attributes?: Record<string, AgeRatingValue>;
        } | null;
      }>('GET', `/appInfos/${appInfoId}/ageRatingDeclaration`);
      if (appleResources === null) return null;
      let declarationAttributes = appleResources.attributes;
      if (declarationAttributes === undefined) declarationAttributes = {};
      return { id: appleResources.id, attributes: declarationAttributes };
    });
  }

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
