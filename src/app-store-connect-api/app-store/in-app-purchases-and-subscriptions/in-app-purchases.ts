import type {
  InAppPurchaseResource,
  LocalizationResource,
  PricePointResource,
} from '@core/types/appleCatalog.js';
import {
  APP_STORE_CONNECT_ORIGIN,
  type AppStoreConnectRequests,
  type LocaleCopy,
} from '@/app-store-connect-api/api-client.js';
import { matchPricePoint } from '@/app-store-connect-api/app-store/pricing-and-availability.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/in-app-purchase
/** Apple's resource names for one product kind's localizations, which live on a version (spec 4.5.1). */
export interface VersionedLocalizationResources {
  versionsUrl: (parentId: string) => string;
  versionType: string;
  parentRelationship: string;
  parentType: string;
  localizationType: string;
}
/** One version of a product as Apple lists it. */
interface ProductVersion {
  id: string;
  attributes: { state?: string; version?: number };
}
/** The draft version, the only one Apple lets us edit; null when the product has none. */
const pickDraftVersion = (versions: ProductVersion[]): ProductVersion | null => {
  const draftVersion = versions.find(
    (version) => version.attributes.state === 'PREPARE_FOR_SUBMISSION',
  );
  if (draftVersion === undefined) return null;
  return draftVersion;
};
const versionNumber = (version: ProductVersion): number => {
  if (version.attributes.version === undefined) return 0;
  return version.attributes.version;
};
/** The highest-numbered version, which a read falls back to when the product has no draft. */
const pickNewestVersion = (versions: ProductVersion[]): ProductVersion | null => {
  const versionsNewestFirst = [...versions].sort(
    (firstVersion, secondVersion) => versionNumber(secondVersion) - versionNumber(firstVersion),
  );
  const [newestVersion] = versionsNewestFirst;

  const hasNoVersion = newestVersion == null;
  if (hasNoVersion) return null;
  return newestVersion;
};
const IN_APP_PURCHASE_VERSION_RESOURCES: VersionedLocalizationResources = {
  versionsUrl: (parentId) => `${APP_STORE_CONNECT_ORIGIN}/v2/inAppPurchases/${parentId}/versions`,
  versionType: 'inAppPurchaseVersions',
  parentRelationship: 'inAppPurchase',
  parentType: 'inAppPurchases',
  localizationType: 'inAppPurchaseLocalizations',
};
export const makeVersionedLocalizations = (api: AppStoreConnectRequests) => {
  /** Shared GET -> {@link LocalizationResource}[] for any product/subscription/group localization collection. */
  const localizationsFrom = async (path: string): Promise<LocalizationResource[]> => {
    const appleResources = await api.requestAll<{
      locale?: string;
      name?: string;
      description?: string | null;
    }>(path);
    return appleResources.flatMap((localization) => {
      const locale = localization.attributes.locale;
      if (locale === undefined) return [];
      const localizationName = localization.attributes.name;
      if (localizationName === undefined) return [];
      const localizedProduct: LocalizationResource = {
        id: localization.id,
        locale,
        name: localizationName,
      };
      if (typeof localization.attributes.description === 'string')
        Object.assign(localizedProduct, { description: localization.attributes.description });
      return [localizedProduct];
    });
  };
  /** GET every version of a product, in any state. */
  const listProductVersions = async (
    resources: VersionedLocalizationResources,
    parentId: string,
  ): Promise<ProductVersion[]> => {
    return api.requestAll<{ state?: string; version?: number }>(
      `${resources.versionsUrl(parentId)}?limit=200`,
    );
  };
  /** GET one version's localizations. */
  const localizationsOnVersion = async (
    resources: VersionedLocalizationResources,
    versionId: string,
  ): Promise<LocalizationResource[]> => {
    return localizationsFrom(`/${resources.versionType}/${versionId}/localizations?limit=200`);
  };
  /** The draft version's id, creating a draft first when the product has none. */
  const findOrCreateDraftVersionId = async (
    resources: VersionedLocalizationResources,
    parentId: string,
  ): Promise<string> => {
    const versions = await listProductVersions(resources, parentId);
    const draftVersion = pickDraftVersion(versions);

    const hasDraftVersion = draftVersion != null;
    if (hasDraftVersion) return draftVersion.id;

    const createdVersion = await api.createResource(`/${resources.versionType}`, {
      type: resources.versionType,
      relationships: {
        [resources.parentRelationship]: { data: { type: resources.parentType, id: parentId } },
      },
    });
    return createdVersion.id;
  };
  /** List the localizations a product shows: its draft's, else its newest version's, else none. */
  const listShownLocalizations = async (
    resources: VersionedLocalizationResources,
    parentId: string,
  ): Promise<LocalizationResource[]> => {
    const versions = await listProductVersions(resources, parentId);
    const draftVersion = pickDraftVersion(versions);
    const newestVersion = pickNewestVersion(versions);

    if (draftVersion !== null) return localizationsOnVersion(resources, draftVersion.id);
    if (newestVersion !== null) return localizationsOnVersion(resources, newestVersion.id);
    return [];
  };
  /** POST one locale's copy onto a version. */
  const postLocalization = async (
    resources: VersionedLocalizationResources,
    versionId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> => {
    const localizationAttributes: { locale: string; name: string; description?: string } = {
      locale: copy.locale,
      name: copy.name,
    };
    const description = copy.description;
    const hasDescription = description != null;
    if (hasDescription) localizationAttributes.description = description;
    const appleResources = await api.createResource<{
      locale?: string;
      name?: string;
      description?: string | null;
    }>(api.v2(`/${resources.localizationType}`), {
      type: resources.localizationType,
      attributes: localizationAttributes,
      relationships: {
        version: { data: { type: resources.versionType, id: versionId } },
      },
    });

    let savedLocale = copy.locale;
    if (appleResources.attributes.locale !== undefined && appleResources.attributes.locale !== null)
      savedLocale = appleResources.attributes.locale;
    let savedName = copy.name;
    if (appleResources.attributes.name !== undefined && appleResources.attributes.name !== null)
      savedName = appleResources.attributes.name;
    const localizedProduct: LocalizationResource = {
      id: appleResources.id,
      locale: savedLocale,
      name: savedName,
    };

    const hasSavedDescription = typeof appleResources.attributes.description === 'string';
    if (hasSavedDescription)
      Object.assign(localizedProduct, { description: appleResources.attributes.description });
    return localizedProduct;
  };
  /** Create one locale on the draft version, creating the draft first when there is none. */
  const createLocalization = async (
    resources: VersionedLocalizationResources,
    parentId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> => {
    const draftVersionId = await findOrCreateDraftVersionId(resources, parentId);
    return postLocalization(resources, draftVersionId, copy);
  };
  return { listShownLocalizations, createLocalization };
};

export const makeInAppPurchasesApi = (api: AppStoreConnectRequests) => {
  /** List an app's in-app purchases (the `inAppPurchasesV2` collection), across all pages. */
  const { listShownLocalizations, createLocalization } = makeVersionedLocalizations(api);
  const listInAppPurchases = async (appId: string): Promise<InAppPurchaseResource[]> => {
    const appleResources = await api.requestAll<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
      state?: string;
    }>(
      `/apps/${appId}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,name,inAppPurchaseType,state`,
    );
    return appleResources.map((purchase) => {
      let productId = purchase.attributes.productId;
      if (productId === undefined) productId = '';
      let purchaseName = purchase.attributes.name;
      if (purchaseName === undefined) purchaseName = '';
      let purchaseType = purchase.attributes.inAppPurchaseType;
      if (purchaseType === undefined) purchaseType = '';
      const inAppPurchase: InAppPurchaseResource = {
        id: purchase.id,
        productId,
        name: purchaseName,
        inAppPurchaseType: purchaseType,
      };
      if (purchase.attributes.state !== undefined)
        Object.assign(inAppPurchase, { state: purchase.attributes.state });
      return inAppPurchase;
    });
  };
  /** Create an in-app purchase. Note the `/v2` path - IAP creation is one of Apple's few v2 endpoints. */
  const createInAppPurchase = async (
    appId: string,
    input: {
      productId: string;
      name: string;
      inAppPurchaseType: string;
    },
  ): Promise<InAppPurchaseResource> => {
    const appleResources = await api.createResource<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
    }>(api.v2('/inAppPurchases'), {
      type: 'inAppPurchases',
      attributes: {
        productId: input.productId,
        name: input.name,
        inAppPurchaseType: input.inAppPurchaseType,
      },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    let productId = appleResources.attributes.productId;
    if (productId === undefined) productId = input.productId;
    let purchaseName = appleResources.attributes.name;
    if (purchaseName === undefined) purchaseName = input.name;
    let purchaseType = appleResources.attributes.inAppPurchaseType;
    if (purchaseType === undefined) purchaseType = input.inAppPurchaseType;
    return {
      id: appleResources.id,
      productId,
      name: purchaseName,
      inAppPurchaseType: purchaseType,
    };
  };
  /** List the localizations an in-app purchase shows: its draft's, else its newest version's. */
  const listInAppPurchaseLocalizations = async (iapId: string): Promise<LocalizationResource[]> => {
    return listShownLocalizations(IN_APP_PURCHASE_VERSION_RESOURCES, iapId);
  };
  /** Create one locale's display copy for an in-app purchase on its draft version. */
  const createInAppPurchaseLocalization = async (
    iapId: string,
    copy: LocaleCopy,
  ): Promise<LocalizationResource> => {
    return createLocalization(IN_APP_PURCHASE_VERSION_RESOURCES, iapId, copy);
  };
  /** Whether an in-app purchase already has a price schedule (so the reconciler skips re-pricing it). */
  const inAppPurchaseHasPrice = async (iapId: string): Promise<boolean> => {
    // No schedule yet reads as a 404 on some accounts - {@link getOptional} maps that to "unpriced".
    const schedule = await api.getOptional(() =>
      // Same v2 relationship path as the localizations read - the bare /v1 inAppPurchasesV2/{id} form 404s.
      api.request<{
        data: {
          id: string;
        } | null;
      }>('GET', api.v2(`/inAppPurchases/${iapId}/iapPriceSchedule`)),
    );
    return schedule?.data != null;
  };
  /** Find the IAP price point in `territory` whose customer price equals `customerPrice`, or null. */
  const findInAppPurchasePricePoint = async (
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> => {
    const points = await api.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      api.v2(
        `/inAppPurchases/${iapId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
      ),
    );
    return matchPricePoint(points, territory, customerPrice);
  };
  /**
   * Set an IAP's price by creating a price schedule anchored on a base territory's price point. The
   * relationship references a client-supplied temp id that the `included` price resource carries -
   * the JSON:API pattern Apple requires here - and a `baseTerritory` is mandatory (omitting it returns
   * Apple's `BASE_TERRITORY_INTERVAL_REQUIRED` 409).
   */
  const createInAppPurchasePriceSchedule = async (
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> => {
    // Apple's JSON:API inline creation requires the temp id wrapped as ${local-id} (a bare string 409s
    // "invalid format"); the same const feeds both the relationship and the included price so they match.
    const priceRef = '${launch-base-price}';
    await api.request<unknown>('POST', '/inAppPurchasePriceSchedules', {
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'inAppPurchasePrices', id: priceRef }] },
        },
      },
      included: [
        {
          type: 'inAppPurchasePrices',
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
            inAppPurchasePricePoint: {
              data: { type: 'inAppPurchasePricePoints', id: pricePointId },
            },
          },
        },
      ],
    });
  };
  return {
    listInAppPurchases,
    createInAppPurchase,
    listInAppPurchaseLocalizations,
    createInAppPurchaseLocalization,
    inAppPurchaseHasPrice,
    findInAppPurchasePricePoint,
    createInAppPurchasePriceSchedule,
  };
};
