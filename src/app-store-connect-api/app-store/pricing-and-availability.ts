import type { components } from '@apple/generated/schema.js';
import type { AppAvailabilityResource, PricePointResource } from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests } from '@/app-store-connect-api/api-client.js';
// Docs: https://developer.apple.com/documentation/appstoreconnectapi/app-availability
/**
 * One page of an app's `territoryAvailabilities`, read with each row's `territory` relationship intact
 * (which `requestAll` drops) - the territory resource id is the territory code
 * (`USA`, `GBR`) the availability applies to. Kept as a named interface so the paginating read isn't
 * self-referential (TS7022).
 */
type TerritoryAvailabilityRow = {
  id: string;
  attributes?: {
    available?: boolean;
  };
  relationships?: {
    territory?: {
      data?: {
        id: string;
      } | null;
    };
  };
};
/** One paginated response from an app availability's territory relationship. */
type TerritoryAvailabilityPage = {
  data: TerritoryAvailabilityRow[];
  links?: {
    next?: string;
  };
};
/** Maximum number of territory updates sent together, keeping large removals below Apple's rate limits. */
const TERRITORY_AVAILABILITY_UPDATE_CONCURRENCY = 8;
export type AscAvailabilityUpdateError = Error & {
  readonly _tag: 'AscAvailabilityUpdateError';
  readonly missingTerritories: readonly string[];
};
/** The requested store-availability set names a territory Apple did not return as updatable. */
const makeAscAvailabilityUpdateError = (
  message: string,
  missingTerritories: readonly string[],
): AscAvailabilityUpdateError =>
  Object.assign(new Error(message), {
    _tag: 'AscAvailabilityUpdateError' as const,
    name: 'AscAvailabilityUpdateError' as const,
    missingTerritories,
  });
/**
 * Find the price point whose `customerPrice` equals the desired amount in a territory. Apple returns
 * prices as decimal strings (`"9.99"`); we parse and compare numerically so `"9.99"` matches `9.99`.
 * Returns null when no rung matches - the reconciler turns that into an actionable "no price point for
 * $X" error rather than silently leaving the product unpriced.
 */
export const matchPricePoint = (
  points: {
    id: string;
    attributes: {
      customerPrice?: string;
      territory?: string;
    };
  }[],
  territory: string,
  customerPrice: number,
): PricePointResource | null => {
  for (const point of points) {
    const price = point.attributes.customerPrice;
    if (price !== undefined && Number.parseFloat(price) === customerPrice) {
      let priceTerritory = point.attributes.territory;
      if (priceTerritory === undefined) priceTerritory = territory;
      return {
        id: point.id,
        customerPrice: price,
        territory: priceTerritory,
      };
    }
  }
  return null;
};
export const makePricingAndAvailabilityApi = (api: AppStoreConnectRequests) => {
  /**
   * Read every territory-availability row related to an existing app availability.
   *
   * @param availabilityId - Opaque `appAvailabilities` resource id.
   * @returns Every related row, retaining its opaque id, territory code relationship, and availability.
   */
  const listAppTerritoryAvailabilities = async (
    availabilityId: string,
  ): Promise<TerritoryAvailabilityRow[]> => {
    const territoryAvailabilities: TerritoryAvailabilityRow[] = [];
    // `include=territory` is required for Apple to populate each row's territory relationship
    // linkage. Sparse `fields[territoryAvailabilities]=available,territory` alone returns rows
    // without `relationships.territory.data`, which made live reads report zero storefronts while
    // every row was still available.
    let next: string | undefined =
      `${api.v2(`/appAvailabilities/${availabilityId}/territoryAvailabilities`)}?include=territory&limit=200`;
    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: TerritoryAvailabilityPage = await api.request('GET', next);
      territoryAvailabilities.push(...page.data);
      next = page.links?.next;
    }
    return territoryAvailabilities;
  };
  /**
   * Read an app's store availability - the `availableInNewTerritories` flag plus every territory code it's
   * for sale in - or null when the app has no availability set yet. Territory rows are paged through in full
   * with `include=territory` so each row's territory-code relationship is populated (Apple omits that
   * linkage without the include; {@link requestAll} would also drop relationships).
   */
  const getAppAvailability = async (appId: string): Promise<AppAvailabilityResource | null> => {
    const head = await api.getOptional<{
      data: {
        id: string;
        attributes?: {
          availableInNewTerritories?: boolean;
        };
      } | null;
    }>(() => api.request('GET', `/apps/${appId}/appAvailabilityV2`));
    if (!head?.data) return null;
    const territoryAvailabilities = await listAppTerritoryAvailabilities(head.data.id);
    const availableTerritories = territoryAvailabilities.flatMap((territoryAvailability) => {
      if (!territoryAvailability.attributes?.available) return [];
      const territoryCode = territoryAvailability.relationships?.territory?.data?.id;
      if (territoryCode === undefined) return [];
      return [territoryCode];
    });
    let availableInNewTerritories = head.data.attributes?.availableInNewTerritories;
    if (availableInNewTerritories === undefined) availableInNewTerritories = false;
    return {
      id: head.data.id,
      availableInNewTerritories,
      availableTerritories,
    };
  };
  /**
   * Create an app's one-and-only availability resource. Apple's v2 POST is create-only; callers must use
   * {@link updateAppAvailabilityTerritories} once a singleton exists.
   *
   * @param appId - Opaque App Store Connect app resource id.
   * @param input - Initial future-territory flag and complete set of available territory codes.
   * @returns A Promise that resolves after Apple creates the singleton.
   */
  const createAppAvailability = async (
    appId: string,
    input: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Promise<void> => {
    const included: (components['schemas']['TerritoryAvailabilityInlineCreate'] & {
      id: string;
    })[] = input.territories.map((code) => ({
      type: 'territoryAvailabilities',
      id: code,
      attributes: { available: true },
      relationships: { territory: { data: { type: 'territories', id: code } } },
    }));
    const requestDocument: components['schemas']['AppAvailabilityV2CreateRequest'] = {
      data: {
        type: 'appAvailabilities',
        attributes: { availableInNewTerritories: input.availableInNewTerritories },
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          territoryAvailabilities: {
            data: included.map((entry) => ({ type: 'territoryAvailabilities', id: entry.id })),
          },
        },
      },
      included,
    };
    await api.request<unknown>('POST', api.v2('/appAvailabilities'), requestDocument);
  };
  /**
   * Reconcile an existing app availability by PATCHing only territory rows whose `available` flag differs.
   * Apple exposes no update operation for the singleton's `availableInNewTerritories` attribute, so that
   * create-only flag is intentionally absent from this method.
   *
   * @param availabilityId - Opaque id returned by {@link getAppAvailability}.
   * @param territories - Complete desired set of Apple territory codes; an empty set disables every row.
   * @returns A Promise that resolves after every differing territory row is updated.
   */
  const updateAppAvailabilityTerritories = async (
    availabilityId: string,
    territories: readonly string[],
  ): Promise<void> => {
    const desired = new Set(territories);
    const territoryAvailabilities = await listAppTerritoryAvailabilities(availabilityId);
    const returnedCodes = new Set(
      territoryAvailabilities.flatMap((territoryAvailability) => {
        const territoryCode = territoryAvailability.relationships?.territory?.data?.id;
        if (territoryCode === undefined) return [];
        return [territoryCode];
      }),
    );
    const missingTerritories = [...desired].filter((code) => !returnedCodes.has(code)).sort();
    if (missingTerritories.length > 0) {
      throw makeAscAvailabilityUpdateError(
        `Apple did not return updatable availability rows for: ${missingTerritories.join(', ')}.`,
        missingTerritories,
      );
    }
    const changes = territoryAvailabilities.flatMap((territoryAvailability) => {
      const territoryCode = territoryAvailability.relationships?.territory?.data?.id;
      if (territoryCode === undefined) return [];
      const available = desired.has(territoryCode);
      if (territoryAvailability.attributes?.available === available) return [];
      return [{ id: territoryAvailability.id, available }];
    });
    for (
      let offset = 0;
      offset < changes.length;
      offset += TERRITORY_AVAILABILITY_UPDATE_CONCURRENCY
    ) {
      const batch = changes.slice(offset, offset + TERRITORY_AVAILABILITY_UPDATE_CONCURRENCY);
      // biome-ignore lint/performance/noAwaitInLoops: batches intentionally cap concurrent Apple PATCH requests to avoid rate-limit bursts.
      await Promise.all(
        batch.map(({ id, available }) => {
          const member: components['schemas']['TerritoryAvailabilityUpdateRequest']['data'] & {
            attributes: {
              available: boolean;
            };
          } = {
            type: 'territoryAvailabilities',
            id,
            attributes: { available },
          };
          return api.updateResource(`/territoryAvailabilities/${id}`, member);
        }),
      );
    }
  };
  /** Find the app price point in `territory` whose customer price equals `customerPrice`, or null. */
  const findAppPricePoint = async (
    appId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> => {
    const points = await api.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      `/apps/${appId}/appPricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  };
  /**
   * The app's currently-effective manual customer price for `territory`, or null when none is set there.
   * Reads the price schedule's manual prices with the linked price point sideloaded, so the reconciler
   * can skip re-pricing when the declared price already matches. (Prices Apple auto-generates for other
   * regions live under `automaticPrices`; the declared base price is always a manual one.)
   *
   * `manualPrices` returns past, current, AND future-scheduled intervals - the currently-effective one is
   * the open interval (`startDate` null/past and `endDate` null). We match only that, so a stale or a
   * not-yet-active scheduled price never masquerades as the current price. `limit=200` is ample: manual
   * prices are at most one per territory (<=175) plus a handful of scheduled changes.
   */
  const getCurrentAppPrice = async (appId: string, territory: string): Promise<string | null> => {
    const requestDocument = await api.getOptional<{
      data: {
        attributes?: {
          startDate?: string | null;
          endDate?: string | null;
        };
        relationships?: {
          appPricePoint?: {
            data?: {
              id: string;
            } | null;
          };
        };
      }[];
      included?: {
        type: string;
        id: string;
        attributes?: {
          customerPrice?: string;
          territory?: string;
        };
      }[];
    }>(() =>
      api.request(
        'GET',
        `/apps/${appId}/appPriceSchedule/manualPrices?include=appPricePoint&limit=200`,
      ),
    );
    if (!requestDocument) return null;
    let includedPricePoints = requestDocument.included;
    if (includedPricePoints === undefined) includedPricePoints = [];
    const pointsById = new Map(
      includedPricePoints
        .filter((entry) => entry.type === 'appPricePoints')
        .map((entry) => [entry.id, entry.attributes] as const),
    );
    for (const price of requestDocument.data) {
      if (price.attributes?.startDate != null) continue;
      if (price.attributes?.endDate != null) continue;
      const pointId = price.relationships?.appPricePoint?.data?.id;
      if (pointId === undefined) continue;
      const point = pointsById.get(pointId);
      if (point?.territory === territory && point.customerPrice !== undefined)
        return point.customerPrice;
    }
    return null;
  };
  /**
   * Set the app's price by creating a price schedule anchored on a base territory's price point - the
   * app-level twin of {@link createInAppPurchasePriceSchedule}, using the same JSON:API temp-id +
   * `included` pattern Apple requires, with the mandatory `baseTerritory` (omitting it returns a 409).
   */
  const createAppPriceSchedule = async (
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> => {
    // Apple's JSON:API inline creation requires the temp id wrapped as ${local-id} (a bare string 409s
    // "invalid format"); the same const feeds both the relationship and the included price so they match.
    const priceRef = '${launch-base-price}';
    await api.request<unknown>('POST', '/appPriceSchedules', {
      data: {
        type: 'appPriceSchedules',
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'appPrices', id: priceRef }] },
        },
      },
      included: [
        {
          type: 'appPrices',
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            app: { data: { type: 'apps', id: appId } },
            appPricePoint: { data: { type: 'appPricePoints', id: pricePointId } },
          },
        },
      ],
    });
  };
  return {
    getAppAvailability,
    createAppAvailability,
    updateAppAvailabilityTerritories,
    findAppPricePoint,
    getCurrentAppPrice,
    createAppPriceSchedule,
  };
};
