import type { AppAvailabilityResource } from '../../types/apple-catalog.ts';
import type { AscHost } from './host.ts';
import type { TerritoryAvailabilityRow, TerritoryAvailabilityPage } from './shared.ts';
import type { components } from '../../apple-api-types.ts';
import { AscAvailabilityUpdateError, TERRITORY_AVAILABILITY_UPDATE_CONCURRENCY } from './shared.ts';

export class ConnectAvailability {
  constructor(private readonly client: AscHost) {}

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

  async createAppAvailability(
    appId: string,
    input: {
      availableInNewTerritories: boolean;
      territories: string[];
    },
  ): Promise<void> {
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
    await this.client.request<unknown>(
      'POST',
      this.client.v2('/appAvailabilities'),
      requestDocument,
    );
  }

  async updateAppAvailabilityTerritories(
    availabilityId: string,
    territories: readonly string[],
  ): Promise<void> {
    const desired = new Set(territories);
    const territoryAvailabilities = await this.listAppTerritoryAvailabilities(availabilityId);
    const returnedCodes = new Set(
      territoryAvailabilities.flatMap((territoryAvailability) => {
        const territoryCode = territoryAvailability.relationships?.territory?.data?.id;
        if (territoryCode === undefined) return [];
        return [territoryCode];
      }),
    );
    const missingTerritories = [...desired].filter((code) => !returnedCodes.has(code)).sort();
    if (missingTerritories.length > 0) {
      throw new AscAvailabilityUpdateError({
        message: `Apple did not return updatable availability rows for: ${missingTerritories.join(', ')}.`,
        missingTerritories,
      });
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
          return this.client.updateResource(`/territoryAvailabilities/${id}`, member);
        }),
      );
    }
  }
}
