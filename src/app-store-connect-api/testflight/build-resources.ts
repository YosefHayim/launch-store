import type { BetaBuildLocalizationResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/beta-build-localizations
export const makeBuildResourcesApi = (api: AppStoreConnectRequests) => {
  /** List a build's TestFlight "What to Test" notes, one per locale (`betaBuildLocalizations`). */
  const listBetaBuildLocalizations = async (
    buildId: string,
  ): Promise<BetaBuildLocalizationResource[]> => {
    const appleResources = await api.requestAll<{
      locale?: string;
      whatsNew?: string | null;
    }>(
      `/builds/${buildId}/betaBuildLocalizations?limit=200&fields[betaBuildLocalizations]=locale,whatsNew`,
    );
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      const betaLocalization: BetaBuildLocalizationResource = { id: localization.id, locale };
      if (typeof localization.attributes.whatsNew === 'string')
        Object.assign(betaLocalization, { whatsNew: localization.attributes.whatsNew });
      return [betaLocalization];
    });
  };
  /** Create a build's "What to Test" note for one locale. */
  const createBetaBuildLocalization = async (
    buildId: string,
    locale: string,
    whatsNew: string,
  ): Promise<void> => {
    await api.createResource('/betaBuildLocalizations', {
      type: 'betaBuildLocalizations',
      attributes: { locale, whatsNew },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  };
  /** Update one locale's "What to Test" note. */
  const updateBetaBuildLocalization = async (
    localizationId: string,
    whatsNew: string,
  ): Promise<void> => {
    await api.updateResource(`/betaBuildLocalizations/${localizationId}`, {
      type: 'betaBuildLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  };

  return {
    listBetaBuildLocalizations,
    createBetaBuildLocalization,
    updateBetaBuildLocalization,
  };
};
