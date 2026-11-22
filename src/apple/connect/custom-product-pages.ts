import type { AscHost } from './host.ts';
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '../../types/apple-catalog.ts';

export class ConnectCustomProductPages {
  constructor(private readonly client: AscHost) {}

  async listCustomProductPages(appId: string): Promise<CustomProductPageResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
    }>(`/apps/${appId}/appCustomProductPages?limit=200&fields[appCustomProductPages]=name`);
    return appleResources.flatMap((customPage) => {
      const pageName = customPage.attributes.name;
      if (pageName === undefined) return [];
      return [{ id: customPage.id, name: pageName }];
    });
  }

  async createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource> {
    const appleResources = await this.client.createResource<Record<string, never>>(
      '/appCustomProductPages',
      {
        type: 'appCustomProductPages',
        attributes: { name },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    );
    return { id: appleResources.id, name };
  }

  async listCustomProductPageVersions(pageId: string): Promise<CustomProductPageVersionResource[]> {
    const appleResources = await this.client.requestAll<{
      state?: string;
    }>(
      `/appCustomProductPages/${pageId}/appCustomProductPageVersions?limit=200&fields[appCustomProductPageVersions]=state`,
    );
    return appleResources.map((version) => {
      let state = version.attributes.state;
      if (state === undefined) state = '';
      return { id: version.id, state };
    });
  }

  async listCustomProductPageLocalizations(
    versionId: string,
  ): Promise<CustomProductPageLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      promotionalText?: string | null;
    }>(
      `/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations?limit=200&fields[appCustomProductPageLocalizations]=locale,promotionalText`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      const customPageLocalization: CustomProductPageLocalizationResource = {
        id: localization.id,
        locale,
      };
      if (typeof localization.attributes.promotionalText === 'string')
        Object.assign(customPageLocalization, {
          promotionalText: localization.attributes.promotionalText,
        });
      return [customPageLocalization];
    });
  }

  async createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void> {
    await this.client.createResource('/appCustomProductPageLocalizations', {
      type: 'appCustomProductPageLocalizations',
      attributes: { locale, promotionalText },
      relationships: {
        appCustomProductPageVersion: {
          data: { type: 'appCustomProductPageVersions', id: versionId },
        },
      },
    });
  }

  async updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<void> {
    await this.client.updateResource(`/appCustomProductPageLocalizations/${localizationId}`, {
      type: 'appCustomProductPageLocalizations',
      id: localizationId,
      attributes: { promotionalText },
    });
  }
}
