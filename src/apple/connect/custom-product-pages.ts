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
    function flatMapCustomPage(customPage: {
      id: string;
      attributes: { name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const pageName = customPage.attributes.name;
      if (pageName == null) return [];
      return [{ id: customPage.id, name: pageName }];
    }

    return appleResources.flatMap(flatMapCustomPage);
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
    function mapVersion(version: {
      id: string;
      attributes: { state?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let state = version.attributes.state;
      if (state == null) state = '';
      return { id: version.id, state };
    }

    return appleResources.map(mapVersion);
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
    function flatMapLocalization(localization: {
      id: string;
      attributes: { locale?: string; promotionalText?: string | null };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const locale = localization.attributes.locale;
      if (locale == null) return [];
      const customPageLocalization: CustomProductPageLocalizationResource = {
        id: localization.id,
        locale,
      };
      if (typeof localization.attributes.promotionalText == 'string')
        Object.assign(customPageLocalization, {
          promotionalText: localization.attributes.promotionalText,
        });
      return [customPageLocalization];
    }

    return appleResources.flatMap(flatMapLocalization);
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
