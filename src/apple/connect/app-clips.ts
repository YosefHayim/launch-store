import type {
  AppClipActionValue,
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
} from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import type { MutableDeep } from '../../types/mutable.ts';
import type { ResourceSingle, AppClipExperiencePage } from './shared.ts';
import type { components } from '../../apple-api-types.ts';

export class ConnectAppClips {
  constructor(private readonly client: AscHost) {}

  async listAppClips(appId: string): Promise<AppClipResource[]> {
    const appleResources = await this.client.requestAll<{
      bundleId?: string;
    }>(`/apps/${appId}/appClips?limit=200`);
    function mapClip(clip: {
      id: string;
      attributes: { bundleId?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const appClip: AppClipResource = { id: clip.id };
      if (clip.attributes.bundleId != null)
        Object.assign(appClip, { bundleId: clip.attributes.bundleId });
      return appClip;
    }

    return appleResources.map(mapClip);
  }

  async listAppClipDefaultExperiences(
    appClipId: string,
  ): Promise<AppClipDefaultExperienceResource[]> {
    const all: AppClipDefaultExperienceResource[] = [];
    let next: string | undefined =
      `/appClips/${appClipId}/appClipDefaultExperiences` +
      `?include=releaseWithAppStoreVersion&fields[appClipDefaultExperiences]=action,releaseWithAppStoreVersion&limit=200`;
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

  async listAppClipDefaultExperienceLocalizations(
    experienceId: string,
  ): Promise<AppClipLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      subtitle?: string;
    }>(
      `/appClipDefaultExperiences/${experienceId}/appClipDefaultExperienceLocalizations?limit=200`,
    );
    function mapLocalization(localization: {
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

    return appleResources.map(mapLocalization);
  }

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
