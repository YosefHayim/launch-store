import type { AscHost } from './host.ts';
import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '@/types/apple-catalog.js';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectCustomProductPages {
  constructor(private readonly client: AscHost) {}

  /**
   * Get a list of all custom product pages for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appcustomproductpages
   */
  async listCustomProductPages(
    appId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageResource[]> {
    const appleResources = await this.client.requestAll<{
      name?: string;
    }>(
      applyAppleListQuery(`/apps/${appId}/appCustomProductPages`, listQuery, APPLE_PAGE_LIMIT, {
        'fields[appCustomProductPages]': 'name',
      }),
    );

    function readCustomProductPage(customPage: {
      id: string;
      attributes: { name?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const pageName = customPage.attributes.name;

      if (pageName == null) return [];

      return [{ id: customPage.id, name: pageName }];
    }

    return appleResources.flatMap(readCustomProductPage);
  }

  /**
   * Add a custom product page for your app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpages
   */
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

  /**
   * List the versions for a custom product page version.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpages-_id_-appcustomproductpageversions
   */
  async listCustomProductPageVersions(
    pageId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageVersionResource[]> {
    const appleResources = await this.client.requestAll<{
      state?: string;
    }>(
      applyAppleListQuery(
        `/appCustomProductPages/${pageId}/appCustomProductPageVersions`,
        listQuery,
        APPLE_PAGE_LIMIT,
        { 'fields[appCustomProductPageVersions]': 'state' },
      ),
    );

    function copyCustomPageVersion(version: {
      id: string;
      attributes: { state?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      let state = version.attributes.state;

      if (state == null) state = '';

      return { id: version.id, state };
    }

    return appleResources.map(copyCustomPageVersion);
  }

  /**
   * List all localizations for an app custom product page.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appcustomproductpageversions-_id_-appcustomproductpagelocalizations
   */
  async listCustomProductPageLocalizations(
    versionId: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<CustomProductPageLocalizationResource[]> {
    const appleResources = await this.client.requestAll<{
      locale?: string;
      promotionalText?: string | null;
    }>(
      applyAppleListQuery(
        `/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations`,
        listQuery,
        APPLE_PAGE_LIMIT,
        {
          'fields[appCustomProductPageLocalizations]': 'locale,promotionalText',
        },
      ),
    );

    function readCustomPageLocalization(localization: {
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

    return appleResources.flatMap(readCustomPageLocalization);
  }

  /**
   * Add a localization for your app custom product page.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appcustomproductpagelocalizations
   */
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

  /**
   * Update the promotional text for an app custom product page localization.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appcustomproductpagelocalizations-_id_
   */
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
