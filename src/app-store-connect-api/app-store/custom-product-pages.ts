import type {
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/custom-product-pages-and-localizations
export const makeCustomProductPagesApi = (api: AppStoreConnectRequests) => {
  /** List an app's custom product pages (alternate listings), matched by name. */
  const listCustomProductPages = async (appId: string): Promise<CustomProductPageResource[]> => {
    const appleResources = await api.requestAll<{
      name?: string;
    }>(`/apps/${appId}/appCustomProductPages?limit=200&fields[appCustomProductPages]=name`);
    return appleResources.flatMap((customPage) => {
      const pageName = customPage.attributes.name;
      if (pageName === undefined) return [];
      return [{ id: customPage.id, name: pageName }];
    });
  };
  /** Create a custom product page by name; Apple seeds it with an editable version cloned from the default listing. */
  const createCustomProductPage = async (
    appId: string,
    name: string,
  ): Promise<CustomProductPageResource> => {
    const appleResources = await api.createResource<Record<string, never>>(
      '/appCustomProductPages',
      {
        type: 'appCustomProductPages',
        attributes: { name },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    );
    return { id: appleResources.id, name };
  };
  /** List a custom product page's versions, so the reconciler can pick the editable one to localize. */
  const listCustomProductPageVersions = async (
    pageId: string,
  ): Promise<CustomProductPageVersionResource[]> => {
    const appleResources = await api.requestAll<{
      state?: string;
    }>(
      `/appCustomProductPages/${pageId}/appCustomProductPageVersions?limit=200&fields[appCustomProductPageVersions]=state`,
    );
    return appleResources.map((version) => {
      let state = version.attributes.state;
      if (state === undefined) state = '';
      return { id: version.id, state };
    });
  };
  /** List a custom product page version's per-locale copy (Launch reads/writes `promotionalText`). */
  const listCustomProductPageLocalizations = async (
    versionId: string,
  ): Promise<CustomProductPageLocalizationResource[]> => {
    const appleResources = await api.requestAll<{
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
  };
  /** Create one locale's custom-product-page localization with its promotional text. */
  const createCustomProductPageLocalization = async (
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void> => {
    await api.createResource('/appCustomProductPageLocalizations', {
      type: 'appCustomProductPageLocalizations',
      attributes: { locale, promotionalText },
      relationships: {
        appCustomProductPageVersion: {
          data: { type: 'appCustomProductPageVersions', id: versionId },
        },
      },
    });
  };
  /** Update one custom-product-page localization's promotional text. */
  const updateCustomProductPageLocalization = async (
    localizationId: string,
    promotionalText: string,
  ): Promise<void> => {
    await api.updateResource(`/appCustomProductPageLocalizations/${localizationId}`, {
      type: 'appCustomProductPageLocalizations',
      id: localizationId,
      attributes: { promotionalText },
    });
  };

  return {
    listCustomProductPages,
    createCustomProductPage,
    listCustomProductPageVersions,
    listCustomProductPageLocalizations,
    createCustomProductPageLocalization,
    updateCustomProductPageLocalization,
  };
};
