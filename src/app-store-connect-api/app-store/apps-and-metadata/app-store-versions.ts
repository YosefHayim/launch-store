// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-metadata
import type {
  AppStoreVersionLocalizationResource,
  AppStoreVersionResource,
  ListingLocalization,
} from '@core/types/appleCatalog.js';
import {
  EDITABLE_METADATA_STATES,
  type ResourceList,
  type PagedList,
  type AppleResource,
  type AppStoreConnectRequests,
} from '@/app-store-connect-api/api-client.js';

/**
 * App Store version states in which listing metadata is still editable, so `launch sync` may write
 * localizations into that version. A live `READY_FOR_SALE` (or in-review) version is intentionally left
 * alone. See `getEditableVersionId`.
 */
const EDITABLE_VERSION_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'INVALID_BINARY',
]);

/** States of the live App Store record: `READY_FOR_DISTRIBUTION`, or `READY_FOR_SALE` and `PREORDER_READY_FOR_SALE` in the older `appStoreState`. */
const LIVE_STATES = new Set<string>([
  'READY_FOR_DISTRIBUTION',
  'READY_FOR_SALE',
  'PREORDER_READY_FOR_SALE',
]);

/** ASC `appStoreVersionLocalizations` attribute keys Launch manages (version-level - per release). */
const VERSION_LISTING_FIELDS = [
  'description',
  'keywords',
  'whatsNew',
  'promotionalText',
  'supportUrl',
  'marketingUrl',
] as const;

type VersionStates = {
  appStoreState: string;
};

/** The id of the first App Store version in one of `states`. */
const findVersionId = (
  versions: ResourceList<VersionStates>['data'],
  states: ReadonlySet<string>,
): string | null => {
  const version = versions.find((candidate) => states.has(candidate.attributes.appStoreState));
  if (version === undefined) return null;
  return version.id;
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

type BuildPageIncluded = {
  type: string;
  id: string;
  attributes?: {
    version?: string;
    processingState?: string;
  };
};

type AppStoreVersionPage = PagedList<{
  versionString?: string;
  appStoreState?: string;
  releaseType?: string;
}> & {
  included?: BuildPageIncluded[];
};

/** Map a raw version row onto an {@link AppStoreVersionResource}, keeping a known versionString fallback. */
const toVersionResource = (
  entry: AppleResource<{
    versionString?: string;
    appStoreState?: string;
    releaseType?: string;
  }>,
  fallbackVersion = '',
  includedBuilds: readonly BuildPageIncluded[] = [],
): AppStoreVersionResource => {
  let versionString = entry.attributes.versionString;
  if (versionString === undefined) versionString = fallbackVersion;
  let appStoreState = entry.attributes.appStoreState;
  if (appStoreState === undefined) appStoreState = '';
  const releaseType = entry.attributes.releaseType;
  const attachedBuildId = entry.relationships?.build?.data?.id;
  const isBuildAttached = attachedBuildId !== undefined;
  const attachedBuild = includedBuilds.find(
    (includedBuild) => includedBuild.type === 'builds' && includedBuild.id === attachedBuildId,
  );
  const attachedBuildNumber = attachedBuild?.attributes?.version;
  const attachedBuildProcessingState = attachedBuild?.attributes?.processingState;
  const version: AppStoreVersionResource = {
    id: entry.id,
    versionString,
    appStoreState,
    ...(releaseType !== undefined && { releaseType }),
    ...(isBuildAttached && { attachedBuildId }),
    ...(attachedBuildNumber !== undefined && { attachedBuildNumber }),
    ...(attachedBuildProcessingState !== undefined && { attachedBuildProcessingState }),
  };
  return version;
};

export const makeAppStoreVersionsApi = (api: AppStoreConnectRequests) => {
  /** List the app's App Store versions with their states. */
  const listVersionStates = async (appId: string): Promise<ResourceList<VersionStates>['data']> => {
    const { data: versions } = await api.request<ResourceList<VersionStates>>(
      'GET',
      `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=appStoreState&limit=20`,
    );
    return versions;
  };

  /**
   * Resolve the app's current **editable** App Store version (the one whose listing copy - description,
   * keywords, what's new, ... - can still be changed), or null when only a live/in-review version exists.
   */
  const getEditableVersionId = async (appId: string): Promise<string | null> => {
    const versions = await listVersionStates(appId);
    return findVersionId(versions, EDITABLE_VERSION_STATES);
  };

  /**
   * Resolve the App Store version whose listing copy is current: the editable one while a release is being
   * prepared, else the live `READY_FOR_SALE` one. Read-only callers use it, so a live app still reads.
   */
  const getCurrentVersionId = async (appId: string): Promise<string | null> => {
    const versions = await listVersionStates(appId);
    const editableVersionId = findVersionId(versions, EDITABLE_VERSION_STATES);
    if (editableVersionId !== null) return editableVersionId;
    return findVersionId(versions, LIVE_STATES);
  };

  /** List the version-level listing localizations (description/keywords/whatsNew/...) under a version. */
  const listVersionLocalizations = async (versionId: string): Promise<ListingLocalization[]> => {
    const appleResources = await api.requestAll<Record<string, unknown>>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`,
    );
    return appleResources.map((localization) => {
      const localeAttribute = localization.attributes['locale'];
      let locale = '';
      if (typeof localeAttribute === 'string') locale = localeAttribute;
      return {
        id: localization.id,
        locale,
        fields: pickListingFields(localization.attributes, VERSION_LISTING_FIELDS),
      };
    });
  };

  /** Create a missing version-level listing locale (Apple requires only `locale`). */
  const createVersionLocalization = async (
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> => {
    await api.createResource('/appStoreVersionLocalizations', {
      type: 'appStoreVersionLocalizations',
      attributes: { locale, ...fields },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  };

  /** Patch changed fields on an existing version-level listing locale (locale itself is immutable). */
  const updateVersionLocalization = async (
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> => {
    await api.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: fields,
    });
  };

  /**
   * Find the app's editable App Store version for a platform (the one whose App Review details can still
   * be changed), or null when none is in an {@link EDITABLE_METADATA_STATES editable state}. `copyright`
   * is empty while unset - Apple won't add such a version to a review submission.
   */
  const findEditableAppStoreVersion = async (
    appId: string,
    platform: string,
  ): Promise<{
    id: string;
    copyright: string;
  } | null> => {
    const appleResources = await api.requestAll<{
      appVersionState?: string;
      appStoreState?: string;
      copyright?: string | null;
    }>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=50&fields[appStoreVersions]=appVersionState,appStoreState,copyright`,
    );
    const editable = appleResources.find((version) => {
      let versionState = version.attributes.appVersionState;
      if (versionState === undefined) versionState = version.attributes.appStoreState;
      if (versionState === undefined) return false;
      return EDITABLE_METADATA_STATES.has(versionState);
    });
    if (editable === undefined) return null;
    let copyright = editable.attributes.copyright;
    if (typeof copyright !== 'string') copyright = '';
    return { id: editable.id, copyright };
  };

  const listAppStoreVersions = async (
    appId: string,
    platform: string,
  ): Promise<AppStoreVersionResource[]> => {
    const versionPages = await api.requestPages<AppStoreVersionPage>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=200&fields[appStoreVersions]=versionString,appStoreState,releaseType,build&include=build&fields[builds]=version,processingState`,
    );
    return versionPages.flatMap(({ data: entries, included = [] }) =>
      entries.map((versionEntry) => toVersionResource(versionEntry, '', included)),
    );
  };

  /** Create a new App Store version for a marketing version string on a platform. */
  const createAppStoreVersion = async (
    appId: string,
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource> => {
    const attributes: Record<string, string> = {
      platform: input.platform,
      versionString: input.versionString,
    };
    if (input.releaseType) attributes['releaseType'] = input.releaseType;
    if (input.earliestReleaseDate) attributes['earliestReleaseDate'] = input.earliestReleaseDate;
    const appleResources = await api.createResource<{
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
  };

  /** Update an editable version's release type / scheduled date / version string. */
  const updateAppStoreVersion = async (
    versionId: string,
    input: {
      releaseType?: string;
      earliestReleaseDate?: string;
      versionString?: string;
      copyright?: string;
    },
  ): Promise<void> => {
    const attributes: Record<string, string> = {};
    if (input.releaseType) attributes['releaseType'] = input.releaseType;
    if (input.earliestReleaseDate) attributes['earliestReleaseDate'] = input.earliestReleaseDate;
    if (input.versionString) attributes['versionString'] = input.versionString;
    if (input.copyright) attributes['copyright'] = input.copyright;
    await api.updateResource(`/appStoreVersions/${versionId}`, {
      type: 'appStoreVersions',
      id: versionId,
      attributes,
    });
  };

  /** List a version's per-locale copy (Launch reads only `whatsNew`). */
  const listAppStoreVersionLocalizations = async (
    versionId: string,
  ): Promise<AppStoreVersionLocalizationResource[]> => {
    const appleResources = await api.requestAll<{
      locale?: string;
      whatsNew?: string;
    }>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200&fields[appStoreVersionLocalizations]=locale,whatsNew`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      const versionLocalization: AppStoreVersionLocalizationResource = {
        id: localization.id,
        locale,
      };
      if (localization.attributes.whatsNew !== undefined)
        Object.assign(versionLocalization, { whatsNew: localization.attributes.whatsNew });
      return [versionLocalization];
    });
  };

  /** Create one locale's version copy with its release notes. */
  const createAppStoreVersionLocalization = async (
    versionId: string,
    input: {
      locale: string;
      whatsNew: string;
    },
  ): Promise<AppStoreVersionLocalizationResource> => {
    const appleResources = await api.createResource<{
      locale?: string;
      whatsNew?: string;
    }>('/appStoreVersionLocalizations', {
      type: 'appStoreVersionLocalizations',
      attributes: { locale: input.locale, whatsNew: input.whatsNew },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    let locale = appleResources.attributes.locale;
    if (locale === undefined) locale = input.locale;
    const versionLocalization: AppStoreVersionLocalizationResource = {
      id: appleResources.id,
      locale,
    };
    if (appleResources.attributes.whatsNew !== undefined)
      Object.assign(versionLocalization, { whatsNew: appleResources.attributes.whatsNew });
    return versionLocalization;
  };

  /** Update one locale's release notes (`whatsNew`). */
  const updateAppStoreVersionLocalization = async (
    localizationId: string,
    whatsNew: string,
  ): Promise<void> => {
    await api.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  };

  return {
    getEditableVersionId,
    getCurrentVersionId,
    listVersionStates,
    listVersionLocalizations,
    createVersionLocalization,
    updateVersionLocalization,
    findEditableAppStoreVersion,
    listAppStoreVersions,
    createAppStoreVersion,
    updateAppStoreVersion,
    listAppStoreVersionLocalizations,
    createAppStoreVersionLocalization,
    updateAppStoreVersionLocalization,
  };
};
