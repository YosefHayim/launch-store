// Finds a price point and schedules a new app price on App Store Connect.

import type { AscHost } from './host.ts';
import type { PricePointResource } from '../types/apple-catalog.ts';
import { matchPricePoint } from './shared.ts';
import { APPLE_PAGE_LIMIT, applyAppleListQuery, type AppleListQuery } from './list-query.ts';

export class ConnectPricing {
  constructor(private readonly client: AscHost) {}

  /**
   * Get all the available price points for a specific app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-apppricepoints
   */
  async findAppPricePoint(
    appId: string,
    territory: string,
    customerPrice: number,
    listQuery: AppleListQuery | null = null,
  ): Promise<PricePointResource | null> {
    const uRIComponent = encodeURIComponent(territory);
    const points = await this.client.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      applyAppleListQuery(
        `/apps/${appId}/appPricePoints?filter[territory]=${uRIComponent}`,
        listQuery,
        APPLE_PAGE_LIMIT,
      ),
    );

    return matchPricePoint(points, territory, customerPrice);
  }

  async getCurrentAppPrice(
    appId: string,
    territory: string,
    listQuery: AppleListQuery | null = null,
  ): Promise<string | null> {
    const requestDocument = await this.client.getOptional<{
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
      this.client.request(
        'GET',
        applyAppleListQuery(
          `/apps/${appId}/appPriceSchedule/manualPrices`,
          listQuery,
          APPLE_PAGE_LIMIT,
          { include: 'appPricePoint' },
        ),
      ),
    );

    if (!requestDocument) return null;

    let includedPricePoints = requestDocument.included;

    if (includedPricePoints == null) includedPricePoints = [];

    function isAppPricePoint(entry: {
      type: string;
      id: string;
      attributes?: { customerPrice?: string; territory?: string };
    }) {
      return entry.type == 'appPricePoints';
    }

    function pairPricePoint(entry: {
      type: string;
      id: string;
      attributes?: { customerPrice?: string; territory?: string };
    }) {
      return [entry.id, entry.attributes] as const;
    }

    const pointsById = new Map(includedPricePoints.filter(isAppPricePoint).map(pairPricePoint));

    for (const price of requestDocument.data) {
      if (price.attributes?.startDate != null) continue;

      if (price.attributes?.endDate != null) continue;

      const pointId = price.relationships?.appPricePoint?.data?.id;

      if (pointId == null) continue;

      const point = pointsById.get(pointId);

      if (point?.territory == territory && point.customerPrice != null) return point.customerPrice;
    }

    return null;
  }

  /**
   * Create a scheduled price change for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-apppriceschedules
   */
  async createAppPriceSchedule(
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    // Apple's JSON:API inline creation requires the temp id wrapped as ${local-id} (a bare string 409s
    // "invalid format"); the same const feeds both the relationship and the included price so they match.
    const priceRef = '${launch-base-price}';

    await this.client.request<unknown>('POST', '/appPriceSchedules', {
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
  }
}
