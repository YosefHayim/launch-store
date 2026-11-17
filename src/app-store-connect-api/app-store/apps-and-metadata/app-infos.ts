// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-metadata
import type {
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AppInfoResource,
  ListingLocalization,
} from '@core/types/appleCatalog.js';
import {
  EDITABLE_METADATA_STATES,
  type ResourceList,
  type AppStoreConnectRequests,
} from '@/app-store-connect-api/api-client.js';

/** App-info states in which the app-level listing (name/subtitle/privacy URL) is still editable. */
const EDITABLE_APPINFO_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
]);

/** States of the live App Store record: `READY_FOR_DISTRIBUTION`, or `READY_FOR_SALE` and `PREORDER_READY_FOR_SALE` in the older `appStoreState`. */
const LIVE_STATES = new Set<string>([
  'READY_FOR_DISTRIBUTION',
  'READY_FOR_SALE',
  'PREORDER_READY_FOR_SALE',
]);

/** ASC `appInfoLocalizations` attribute keys Launch manages (app-level - persists across versions). */
const APP_INFO_LISTING_FIELDS = ['name', 'subtitle', 'privacyPolicyUrl'] as const;

type AppInfoStates = {
  state?: string;
  appStoreState?: string;
};

/** The id of the first appInfo in one of `states`, reading `state` and falling back to `appStoreState`. */
const findAppInfoId = (
  appInfos: ResourceList<AppInfoStates>['data'],
  states: ReadonlySet<string>,
): string | null => {
  const appInformation = appInfos.find((candidate) => {
    let state = candidate.attributes.state;
    if (state === undefined) state = candidate.attributes.appStoreState;
    return state !== undefined && states.has(state);
  });
  if (appInformation === undefined) return null;
  return appInformation.id;
};

/**
 * Pick the given keys out of a localization's raw attributes, keeping only present, non-empty strings.
 * Apple returns empty fields as `null` or `""`; both are dropped so a diff treats "unset" uniformly.
 */
const pickListingFields = (
  attributes: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const fieldValue = attributes[key];
    if (typeof fieldValue === 'string' && fieldValue.length > 0) fields[key] = fieldValue;
  }
  return fields;
};

export const makeAppInfosApi = (api: AppStoreConnectRequests) => {
  /** List the app's `appInfo` records with their states. */
  const listAppInfoStates = async (appId: string): Promise<ResourceList<AppInfoStates>['data']> => {
    const { data: appInfos } = await api.request<ResourceList<AppInfoStates>>(
      'GET',
      `/apps/${appId}/appInfos?fields[appInfos]=state,appStoreState&limit=20`,
    );
    return appInfos;
  };

  /**
   * Resolve the app's current **editable** `appInfo` (the container for app-level listing copy - name,
   * subtitle, privacy URL - that persists across versions), or null when none is in an editable state.
   * A live app keeps a read-only `READY_FOR_DISTRIBUTION` appInfo we must never PATCH.
   */
  const getEditableAppInfoId = async (appId: string): Promise<string | null> => {
    const appInfos = await listAppInfoStates(appId);
    return findAppInfoId(appInfos, EDITABLE_APPINFO_STATES);
  };

  /**
   * Resolve the `appInfo` whose app-level listing copy is current: the editable one while a change is
   * pending, else the live one. Read-only callers use it, so a live app with no pending change still reads.
   */
  const getCurrentAppInfoId = async (appId: string): Promise<string | null> => {
    const appInfos = await listAppInfoStates(appId);
    const editableAppInfoId = findAppInfoId(appInfos, EDITABLE_APPINFO_STATES);
    if (editableAppInfoId !== null) return editableAppInfoId;
    return findAppInfoId(appInfos, LIVE_STATES);
  };

  /** List the app-level listing localizations (name/subtitle/privacy URL) under an `appInfo`. */
  const listAppInfoLocalizations = async (appInfoId: string): Promise<ListingLocalization[]> => {
    const appleResources = await api.requestAll<Record<string, unknown>>(
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
  };

  /**
   * Each locale's account-deletion URL under an `appInfo`, read from the dedicated `privacyChoicesUrl`
   * attribute (the field App Store Connect surfaces under "App Privacy -> Account Deletion"). Apple requires
   * it for any app that lets users create an account, so the readiness layer checks its presence. Returned
   * per locale, the empty string where the locale leaves it unset - separate from {@link listAppInfoLocalizations}
   * so the listing-sync field set (name/subtitle/privacy policy) stays untouched.
   */
  const listAccountDeletionUrls = async (
    appInfoId: string,
  ): Promise<
    {
      locale: string;
      url: string;
    }[]
  > => {
    const appleResources = await api.requestAll<{
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
  };

  /** Create a missing app-level listing locale. `fields` must include `name` (Apple requires it). */
  const createAppInfoLocalization = async (
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> => {
    await api.createResource('/appInfoLocalizations', {
      type: 'appInfoLocalizations',
      attributes: { locale, ...fields },
      relationships: { appInfo: { data: { type: 'appInfos', id: appInfoId } } },
    });
  };

  /** Patch changed fields on an existing app-level listing locale (locale itself is immutable). */
  const updateAppInfoLocalization = async (
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> => {
    await api.updateResource(`/appInfoLocalizations/${localizationId}`, {
      type: 'appInfoLocalizations',
      id: localizationId,
      attributes: fields,
    });
  };

  /**
   * Resolve the app's editable App Info - the record that owns App Store categories and the age-rating
   * declaration - with its current category ids. Apps can have a live + an editable App Info; we prefer
   * one in an editable {@link EDITABLE_METADATA_STATES editable state} and fall back to the first.
   * `include=primaryCategory,secondaryCategory` forces Apple to populate the relationship linkage so we
   * can read the current category ids without a second round-trip. Returns null when the app has none.
   */
  const getAppInfo = async (appId: string): Promise<AppInfoResource | null> => {
    const { data: appleResources } = await api.request<{
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
  };

  /**
   * Set an App Info's primary/secondary App Store categories. Categories are JSON:API *relationships*
   * (type `appCategories`, id e.g. `PRODUCTIVITY`), not attributes; only the keys passed are sent, so
   * the reconciler can change one without clearing the other.
   */
  const updateAppInfoCategories = async (
    appInfoId: string,
    categories: {
      primaryCategoryId?: string;
      secondaryCategoryId?: string | null;
    },
  ): Promise<void> => {
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
    await api.request<unknown>('PATCH', `/appInfos/${appInfoId}`, {
      data: { type: 'appInfos', id: appInfoId, relationships },
    });
  };

  /** Read an App Info's age-rating declaration (its current answers), or null when none exists yet. */
  const getAgeRatingDeclaration = async (
    appInfoId: string,
  ): Promise<AgeRatingDeclarationResource | null> => {
    return api.getOptional(async () => {
      const { data: appleResources } = await api.request<{
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
  };

  /** Update an age-rating declaration with the given answers (only the supplied keys are changed). */
  const updateAgeRatingDeclaration = async (
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ): Promise<void> => {
    await api.updateResource(`/ageRatingDeclarations/${declarationId}`, {
      type: 'ageRatingDeclarations',
      id: declarationId,
      attributes,
    });
  };

  return {
    getEditableAppInfoId,
    getCurrentAppInfoId,
    listAppInfoStates,
    listAppInfoLocalizations,
    listAccountDeletionUrls,
    createAppInfoLocalization,
    updateAppInfoLocalization,
    getAppInfo,
    updateAppInfoCategories,
    getAgeRatingDeclaration,
    updateAgeRatingDeclaration,
  };
};
