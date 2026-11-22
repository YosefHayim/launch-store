import type { AscHost } from './host.ts';
import type { PricePointResource } from '../../types/appleCatalog.ts';
import { matchPricePoint } from './shared.ts';

export class ConnectPricing {
  constructor(private readonly client: AscHost) {}

  async findAppPricePoint(
    appId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.client.requestAll<{
      customerPrice?: string;
      territory?: string;
    }>(
      `/apps/${appId}/appPricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  async getCurrentAppPrice(appId: string, territory: string): Promise<string | null> {
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
  }

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
