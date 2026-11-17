import type {
  AppClipActionValue,
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
} from '@core/types/appleCatalog.js';
import type { components } from '@apple/generated/schema.js';
import type { MutableDeep } from '@core/types/mutable.js';
import type {
  AppStoreConnectRequests,
  ResourceSingle,
} from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-clips-and-app-clip-experiences
/**
 * One page of an App Clip's `appClipDefaultExperiences`, read with each row's `releaseWithAppStoreVersion`
 * relationship intact (which requestAll drops) - that linkage is how an
 * experience is matched to the editable App Store version being reconciled.
 */
type AppClipExperiencePage = {
  data: {
    id: string;
    attributes?: {
      action?: string;
    };
    relationships?: {
      releaseWithAppStoreVersion?: {
        data?: {
          id: string;
        } | null;
      };
    };
  }[];
  links?: {
    next?: string;
  };
};
export const makeAppClipsApi = (api: AppStoreConnectRequests) => {
  /**
   * List an app's App Clips (read-only - a clip is created by uploading a build with an App Clip target).
   * The reconciler matches a config entry to a clip by its own `bundleId`.
   */
  const listAppClips = async (appId: string): Promise<AppClipResource[]> => {
    const appleResources = await api.requestAll<{
      bundleId?: string;
    }>(`/apps/${appId}/appClips?limit=200`);
    return appleResources.map((clip) => {
      const appClip: AppClipResource = { id: clip.id };
      if (clip.attributes.bundleId !== undefined)
        Object.assign(appClip, { bundleId: clip.attributes.bundleId });
      return appClip;
    });
  };
  /**
   * List a clip's default experiences with each one's card `action` and the App Store version it releases
   * with - the version linkage lets the reconciler pick the experience for the version being prepared.
   */
  const listAppClipDefaultExperiences = async (
    appClipId: string,
  ): Promise<AppClipDefaultExperienceResource[]> => {
    const all: AppClipDefaultExperienceResource[] = [];
    let next: string | undefined =
      `/appClips/${appClipId}/appClipDefaultExperiences` +
      `?include=releaseWithAppStoreVersion&fields[appClipDefaultExperiences]=action,releaseWithAppStoreVersion&limit=200`;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: AppClipExperiencePage = await api.request<AppClipExperiencePage>('GET', next);
      for (const experience of page.data) {
        const defaultExperience: AppClipDefaultExperienceResource = { id: experience.id };
        if (experience.attributes?.action !== undefined)
          Object.assign(defaultExperience, { action: experience.attributes.action });
        const versionId = experience.relationships?.releaseWithAppStoreVersion?.data?.id;
        if (versionId !== undefined) Object.assign(defaultExperience, { versionId });
        all.push(defaultExperience);
      }
      next = page.links?.next;
    }
    return all;
  };
  /** Create a clip's default experience for an editable version, optionally setting the card action. */
  const createAppClipDefaultExperience = async (
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{
    id: string;
  }> => {
    const experienceData: components['schemas']['AppClipDefaultExperienceCreateRequest']['data'] = {
      type: 'appClipDefaultExperiences',
      relationships: {
        appClip: { data: { type: 'appClips', id: appClipId } },
        releaseWithAppStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    };
    if (action !== undefined) Object.assign(experienceData, { attributes: { action } });
    const requestDocument: components['schemas']['AppClipDefaultExperienceCreateRequest'] = {
      data: experienceData,
    };
    const { data: appleResources } = await api.request<
      ResourceSingle<{
        action?: string;
      }>
    >('POST', '/appClipDefaultExperiences', requestDocument);
    return { id: appleResources.id };
  };
  /** PATCH a default experience's card call-to-action (`OPEN` / `VIEW` / `PLAY`). */
  const updateAppClipDefaultExperienceAction = async (
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void> => {
    const requestDocument: components['schemas']['AppClipDefaultExperienceUpdateRequest'] = {
      data: { type: 'appClipDefaultExperiences', id: experienceId, attributes: { action } },
    };
    await api.request<unknown>(
      'PATCH',
      `/appClipDefaultExperiences/${experienceId}`,
      requestDocument,
    );
  };
  /** List a default experience's per-locale card localizations (locale + subtitle). */
  const listAppClipDefaultExperienceLocalizations = async (
    experienceId: string,
  ): Promise<AppClipLocalizationResource[]> => {
    const appleResources = await api.requestAll<{
      locale?: string;
      subtitle?: string;
    }>(
      `/appClipDefaultExperiences/${experienceId}/appClipDefaultExperienceLocalizations?limit=200`,
    );
    return appleResources.map((localization) => {
      let locale = localization.attributes.locale;
      if (locale === undefined) locale = '';
      const localizedExperience: MutableDeep<AppClipLocalizationResource> = {
        id: localization.id,
        locale,
      };
      if (localization.attributes.subtitle !== undefined)
        localizedExperience.subtitle = localization.attributes.subtitle;
      return localizedExperience;
    });
  };
  /** Create a card localization (locale + subtitle) under a default experience. */
  const createAppClipDefaultExperienceLocalization = async (
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void> => {
    const requestDocument: components['schemas']['AppClipDefaultExperienceLocalizationCreateRequest'] =
      {
        data: {
          type: 'appClipDefaultExperienceLocalizations',
          attributes: { locale, subtitle },
          relationships: {
            appClipDefaultExperience: {
              data: { type: 'appClipDefaultExperiences', id: experienceId },
            },
          },
        },
      };
    await api.request<unknown>('POST', '/appClipDefaultExperienceLocalizations', requestDocument);
  };
  /** PATCH a card localization's subtitle (the locale itself is immutable). */
  const updateAppClipDefaultExperienceLocalization = async (
    localizationId: string,
    subtitle: string,
  ): Promise<void> => {
    const requestDocument: components['schemas']['AppClipDefaultExperienceLocalizationUpdateRequest'] =
      {
        data: {
          type: 'appClipDefaultExperienceLocalizations',
          id: localizationId,
          attributes: { subtitle },
        },
      };
    await api.request<unknown>(
      'PATCH',
      `/appClipDefaultExperienceLocalizations/${localizationId}`,
      requestDocument,
    );
  };

  return {
    listAppClips,
    listAppClipDefaultExperiences,
    createAppClipDefaultExperience,
    updateAppClipDefaultExperienceAction,
    listAppClipDefaultExperienceLocalizations,
    createAppClipDefaultExperienceLocalization,
    updateAppClipDefaultExperienceLocalization,
  };
};
