import type { AscHost } from './host.ts';
import type {
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterDetailResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
  LeaderboardFormatter,
} from '../../types/apple-catalog.ts';
import type { ResourceSingle } from './shared.ts';
import type { components } from '../../apple-api-types.ts';

export class ConnectGameCenter {
  constructor(private readonly client: AscHost) {}

  async getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null> {
    return this.client.getOptional(async () => {
      const { data: appleResources } = await this.client.request<{
        data: {
          id: string;
        } | null;
      }>('GET', `/apps/${appId}/gameCenterDetail`);
      if (appleResources == null) return null;
      return { id: appleResources.id };
    });
  }

  async createGameCenterDetail(appId: string): Promise<GameCenterDetailResource> {
    const requestDocument: components['schemas']['GameCenterDetailCreateRequest'] = {
      data: {
        type: 'gameCenterDetails',
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    };
    const { data: appleResources } = await this.client.request<
      ResourceSingle<Record<string, never>>
    >('POST', '/gameCenterDetails', requestDocument);
    return { id: appleResources.id };
  }

  async listGameCenterAchievements(detailId: string): Promise<GameCenterAchievementResource[]> {
    const appleResources = await this.client.requestAll<{
      vendorIdentifier?: string;
    }>(
      `/gameCenterDetails/${detailId}/gameCenterAchievementsV2?fields[gameCenterAchievements]=vendorIdentifier&limit=200`,
    );
    return appleResources.map((achievement) => {
      const achievementResource: GameCenterAchievementResource = { id: achievement.id };
      if (achievement.attributes.vendorIdentifier != null)
        Object.assign(achievementResource, {
          vendorIdentifier: achievement.attributes.vendorIdentifier,
        });
      return achievementResource;
    });
  }

  async createGameCenterAchievement(
    detailId: string,
    attributes: GameCenterAchievementCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> {
    const requestDocument: components['schemas']['GameCenterAchievementV2CreateRequest'] = {
      data: {
        type: 'gameCenterAchievements',
        attributes,
        relationships: {
          gameCenterDetail: { data: { type: 'gameCenterDetails', id: detailId } },
          versions: { data: [{ type: 'gameCenterAchievementVersions', id: '${version-0}' }] },
        },
      },
      included: [{ type: 'gameCenterAchievementVersions', id: '${version-0}' }],
    };
    const { data: appleResources } = await this.client.request<{
      data: {
        id: string;
        relationships?: {
          versions?: {
            data?: {
              id: string;
            }[];
          };
        };
      };
    }>('POST', this.client.v2('/gameCenterAchievements'), requestDocument);
    let versionId: string | null = null;
    const returnedVersionId = appleResources.relationships?.versions?.data?.[0]?.id;
    if (returnedVersionId != null) versionId = returnedVersionId;
    return { id: appleResources.id, versionId };
  }

  async createGameCenterAchievementLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void> {
    const requestDocument: components['schemas']['GameCenterAchievementLocalizationV2CreateRequest'] =
      {
        data: {
          type: 'gameCenterAchievementLocalizations',
          attributes: fields,
          relationships: {
            version: { data: { type: 'gameCenterAchievementVersions', id: versionId } },
          },
        },
      };
    await this.client.request<unknown>(
      'POST',
      this.client.v2('/gameCenterAchievementLocalizations'),
      requestDocument,
    );
  }

  async listGameCenterLeaderboards(detailId: string): Promise<GameCenterLeaderboardResource[]> {
    const appleResources = await this.client.requestAll<{
      vendorIdentifier?: string;
    }>(
      `/gameCenterDetails/${detailId}/gameCenterLeaderboardsV2?fields[gameCenterLeaderboards]=vendorIdentifier&limit=200`,
    );
    return appleResources.map((leaderboard) => {
      const leaderboardResource: GameCenterLeaderboardResource = { id: leaderboard.id };
      if (leaderboard.attributes.vendorIdentifier != null)
        Object.assign(leaderboardResource, {
          vendorIdentifier: leaderboard.attributes.vendorIdentifier,
        });
      return leaderboardResource;
    });
  }

  async createGameCenterLeaderboard(
    detailId: string,
    attributes: GameCenterLeaderboardCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> {
    const requestDocument: components['schemas']['GameCenterLeaderboardV2CreateRequest'] = {
      data: {
        type: 'gameCenterLeaderboards',
        attributes,
        relationships: {
          gameCenterDetail: { data: { type: 'gameCenterDetails', id: detailId } },
          versions: { data: [{ type: 'gameCenterLeaderboardVersions', id: '${version-0}' }] },
        },
      },
      included: [{ type: 'gameCenterLeaderboardVersions', id: '${version-0}' }],
    };
    const { data: appleResources } = await this.client.request<{
      data: {
        id: string;
        relationships?: {
          versions?: {
            data?: {
              id: string;
            }[];
          };
        };
      };
    }>('POST', this.client.v2('/gameCenterLeaderboards'), requestDocument);
    let versionId: string | null = null;
    const returnedVersionId = appleResources.relationships?.versions?.data?.[0]?.id;
    if (returnedVersionId != null) versionId = returnedVersionId;
    return { id: appleResources.id, versionId };
  }

  async createGameCenterLeaderboardLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      formatterOverride?: LeaderboardFormatter;
    },
  ): Promise<void> {
    const requestDocument: components['schemas']['GameCenterLeaderboardLocalizationV2CreateRequest'] =
      {
        data: {
          type: 'gameCenterLeaderboardLocalizations',
          attributes: fields,
          relationships: {
            version: { data: { type: 'gameCenterLeaderboardVersions', id: versionId } },
          },
        },
      };
    await this.client.request<unknown>(
      'POST',
      this.client.v2('/gameCenterLeaderboardLocalizations'),
      requestDocument,
    );
  }
}
