// Reads and writes an App Clip and its default experience on App Store Connect.

import type {
  AppClipActionValue,
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
} from '../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import type { MutableDeep } from '../types/mutable.ts';
import type { ResourceSingle, AppClipExperiencePage } from './shared.ts';
import type { components } from '../apple-api-types.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectAppClips {
  constructor(private readonly client: AscHost) {}

  /**
   * List your app’s associated App Clips.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appclips
   */
  async listAppClips(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipResource[]> {
    const appleResources = await this.client.requestAll<{
      bundleId?: string;
    }>(applyAppleListQuery(`/apps/${appId}/appClips`, listQuery, APPLE_PAGE_LIMIT));

    function copyAppClip(clip: {
      id: string;
      attributes: { bundleId?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const appClip: AppClipResource = { id: clip.id };

      if (clip.attributes.bundleId != null)
        Object.assign(appClip, { bundleId: clip.attributes.bundleId });

      return appClip;
    }

    return appleResources.map(copyAppClip);
  }

  async listAppClipDefaultExperiences(
    appClipId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipDefaultExperienceResource[]> {
    const all: AppClipDefaultExperienceResource[] = [];
    let next: string | undefined =
      `/appClips/${appClipId}/appClipDefaultExperiences` +
      applyAppleListQuery('', listQuery, APPLE_PAGE_LIMIT, {
        include: 'releaseWithAppStoreVersion',
        'fields[appClipDefaultExperiences]': 'action,releaseWithAppStoreVersion',
      });

    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: AppClipExperiencePage = await this.client.request<AppClipExperiencePage>(
        'GET',
        next,
      );

      for (const experience of page.data) {
        const defaultExperience: AppClipDefaultExperienceResource = { id: experience.id };

        if (experience.attributes?.action != null)
          Object.assign(defaultExperience, { action: experience.attributes.action });

        const versionId = experience.relationships?.releaseWithAppStoreVersion?.data?.id;

        if (versionId != null) Object.assign(defaultExperience, { versionId });

        all.push(defaultExperience);
      }

      next = page.links?.next;
    }

    return all;
  }

  /**
   * Configure a new default App Clip experience.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipdefaultexperiences
   */
  async createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{
    id: string;
  }> {
    const experienceData: components['schemas']['AppClipDefaultExperienceCreateRequest']['data'] = {
      type: 'appClipDefaultExperiences',
      relationships: {
        appClip: { data: { type: 'appClips', id: appClipId } },
        releaseWithAppStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    };

    if (action != null) Object.assign(experienceData, { attributes: { action } });

    const requestDocument: components['schemas']['AppClipDefaultExperienceCreateRequest'] = {
      data: experienceData,
    };
    const { data: appleResources } = await this.client.request<
      ResourceSingle<{
        action?: string;
      }>
    >('POST', '/appClipDefaultExperiences', requestDocument);

    return { id: appleResources.id };
  }

  /**
   * Update a default App Clip experience.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiences-_id_
   */
  async updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void> {
    const requestDocument: components['schemas']['AppClipDefaultExperienceUpdateRequest'] = {
      data: { type: 'appClipDefaultExperiences', id: experienceId, attributes: { action } },
    };

    await this.client.request<unknown>(
      'PATCH',
      `/appClipDefaultExperiences/${experienceId}`,
      requestDocument,
    );
  }

  /**
   * Get localized metadata that appears on the App Clip card for a specific default App Clip
   * experience.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appclipdefaultexperiences-_id_-appclipdefaultexperiencelocalizations
   */
  async listAppClipDefaultExperienceLocalizations(
    experienceId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<AppClipLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      subtitle?: string;
    }>(
      applyAppleListQuery(
        `/appClipDefaultExperiences/${experienceId}/appClipDefaultExperienceLocalizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    function copyAppClipLocalization(localization: {
      id: string;
      attributes: { locale?: string; subtitle?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let locale = localization.attributes.locale;

      if (locale == null) locale = '';

      const localizedExperience: MutableDeep<AppClipLocalizationResource> = {
        id: localization.id,
        locale,
      };

      if (localization.attributes.subtitle != null)
        localizedExperience.subtitle = localization.attributes.subtitle;

      return localizedExperience;
    }

    return appleResources.map(copyAppClipLocalization);
  }

  /**
   * Provide localized metadata that appears on the App Clip card of a default App Clip experience.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appclipdefaultexperiencelocalizations
   */
  async createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void> {
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

    await this.client.request<unknown>(
      'POST',
      '/appClipDefaultExperienceLocalizations',
      requestDocument,
    );
  }

  /**
   * Update localized metadata for a specific default App Clip experience.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appclipdefaultexperiencelocalizations-_id_
   */
  async updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Promise<void> {
    const requestDocument: components['schemas']['AppClipDefaultExperienceLocalizationUpdateRequest'] =
      {
        data: {
          type: 'appClipDefaultExperienceLocalizations',
          id: localizationId,
          attributes: { subtitle },
        },
      };

    await this.client.request<unknown>(
      'PATCH',
      `/appClipDefaultExperienceLocalizations/${localizationId}`,
      requestDocument,
    );
  }
}
