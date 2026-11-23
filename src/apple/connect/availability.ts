import type { AppAvailabilityResource } from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import type { TerritoryAvailabilityRow, TerritoryAvailabilityPage } from './shared.ts';
import type { components } from '../../apple-api-types.ts';
import { AscAvailabilityUpdateError, TERRITORY_AVAILABILITY_UPDATE_CONCURRENCY } from './shared.ts';

export class ConnectAvailability {
  constructor(private readonly client: AscHost) {}

  /**
   * List Availability for an App.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appavailabilityv2
   */
  async getAppAvailability(appId: string): Promise<AppAvailabilityResource | null> {
    const head = await this.client.getOptional<{
      data: {
        id: string;
        attributes?: {
          availableInNewTerritories?: boolean;
        };
      } | null;
    }>(() => this.client.request('GET', `/apps/${appId}/appAvailabilityV2`));

    if (!head?.data) return null;

    const territoryAvailabilities = await this.listAppTerritoryAvailabilities(head.data.id);

    function flatMapTerritoryAvailability(territoryAvailability: {
      id: string;
      attributes?: { available?: boolean };
      relationships?: { territory?: { data?: { id: string } | null } };
    }) {
      if (!territoryAvailability.attributes?.available) return [];

      const territoryCode = territoryAvailability.relationships?.territory?.data?.id;

      if (territoryCode == null) return [];

      return [territoryCode];
    }

    const availableTerritories = territoryAvailabilities.flatMap(flatMapTerritoryAvailability);
    let availableInNewTerritories = head.data.attributes?.availableInNewTerritories;

    if (availableInNewTerritories == null) availableInNewTerritories = false;

    return {
      id: head.data.id,
      availableInNewTerritories,
      availableTerritories,
    };
  }

  private async listAppTerritoryAvailabilities(
    availabilityId: string,
  ): Promise<TerritoryAvailabilityRow[]> {
    const territoryAvailabilities: TerritoryAvailabilityRow[] = [];
    // `include=territory` is required for Apple to populate each row's territory relationship
    // linkage. Sparse `fields[territoryAvailabilities]=available,territory` alone returns rows
    // without `relationships.territory.data`, which made live reads report zero storefronts while
    // every row was still available.
    let next: string | undefined =
      `${this.client.v2(`/appAvailabilities/${availabilityId}/territoryAvailabilities`)}?include=territory&limit=200`;

    while (next) {
      // biome-ignore lint/performance/noAwaitInLoops: cursor pagination - each page’s `next` link comes from the prior response, so the reads are inherently sequential
      const page: TerritoryAvailabilityPage = await this.client.request('GET', next);
      territoryAvailabilities.push(...page.data);
      next = page.links?.next;
    }

    return territoryAvailabilities;
  }

  /**
   * Create an app pre-order and set the expected app release date.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-appavailabilities
   */
  async createAppAvailability(
    appId: string,
    input: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Promise<void> {
    function mapCode(code: string) {
      return {
        type: 'territoryAvailabilities',
        id: code,
        attributes: { available: true },
        relationships: { territory: { data: { type: 'territories', id: code } } },
      } as const;
    }

    const included: (components['schemas']['TerritoryAvailabilityInlineCreate'] & {
      id: string;
    })[] = input.territories.map(mapCode);
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

    await this.client.request<unknown>(
      'POST',
      this.client.v2('/appAvailabilities'),
      requestDocument,
    );
  }

  /**
   * Update the release territories for your app pre-order.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-territoryavailabilities-_id_
   */
  async updateAppAvailabilityTerritories(
    availabilityId: string,
    territories: readonly string[],
  ): Promise<void> {
    const desired = new Set(territories);
    const territoryAvailabilities = await this.listAppTerritoryAvailabilities(availabilityId);

    function flatMapTerritoryAvailability2(territoryAvailability: {
      id: string;
      attributes?: { available?: boolean };
      relationships?: { territory?: { data?: { id: string } | null } };
    }) {
      const territoryCode = territoryAvailability.relationships?.territory?.data?.id;

      if (territoryCode == null) return [];

      return [territoryCode];
    }

    const returnedCodes = new Set(territoryAvailabilities.flatMap(flatMapTerritoryAvailability2));

    function filterCode(code: string) {
      return !returnedCodes.has(code);
    }

    const missingTerritories = [...desired].filter(filterCode).sort();

    if (missingTerritories.length > 0) {
      throw new AscAvailabilityUpdateError({
        message: `Apple did not return updatable availability rows for: ${missingTerritories.join(', ')}.`,
        missingTerritories,
      });
    }

    function flatMapTerritoryAvailability3(territoryAvailability: {
      id: string;
      attributes?: { available?: boolean };
      relationships?: { territory?: { data?: { id: string } | null } };
    }) {
      const territoryCode = territoryAvailability.relationships?.territory?.data?.id;

      if (territoryCode == null) return [];

      const available = desired.has(territoryCode);

      if (territoryAvailability.attributes?.available == available) return [];

      return [{ id: territoryAvailability.id, available }];
    }

    const changes = territoryAvailabilities.flatMap(flatMapTerritoryAvailability3);

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

          return this.client.updateResource(`/territoryAvailabilities/${id}`, member);
        }),
      );
    }
  }
}
