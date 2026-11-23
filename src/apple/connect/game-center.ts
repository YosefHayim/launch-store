import type { AscHost } from './host.ts';
import type {
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterDetailResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
  LeaderboardFormatter,
} from '@/types/apple-catalog.js';
import type { ResourceSingle } from './shared.ts';
import type { components } from '@/apple-api-types.js';

export class ConnectGameCenter {
  constructor(private readonly client: AscHost) {}

  /**
   * Get Game Center detail information for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-gamecenterdetail
   */
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

  /**
   * Create a Game Center detail for an app.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v1-gamecenterdetails
   */
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

  /**
   * Get a list of achievements for a specific Game Center detail.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterachievementsv2
   */
  async listGameCenterAchievements(detailId: string): Promise<GameCenterAchievementResource[]> {
    const appleResources = await this.client.requestAll<{
      vendorIdentifier?: string;
    }>(
      `/gameCenterDetails/${detailId}/gameCenterAchievementsV2?fields[gameCenterAchievements]=vendorIdentifier&limit=200`,
    );

    function mapAchievement(achievement: {
      id: string;
      attributes: { vendorIdentifier?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const achievementResource: GameCenterAchievementResource = { id: achievement.id };

      if (achievement.attributes.vendorIdentifier != null)
        Object.assign(achievementResource, {
          vendorIdentifier: achievement.attributes.vendorIdentifier,
        });

      return achievementResource;
    }

    return appleResources.map(mapAchievement);
  }

  /**
   * Create a Game Center achievement.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievements
   */
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

  /**
   * Create a Game Center achievement localization.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterachievementlocalizations
   */
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

  /**
   * Get a list of leaderboards for a specific Game Center detail.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/get-v1-gamecenterdetails-_id_-gamecenterleaderboardsv2
   */
  async listGameCenterLeaderboards(detailId: string): Promise<GameCenterLeaderboardResource[]> {
    const appleResources = await this.client.requestAll<{
      vendorIdentifier?: string;
    }>(
      `/gameCenterDetails/${detailId}/gameCenterLeaderboardsV2?fields[gameCenterLeaderboards]=vendorIdentifier&limit=200`,
    );

    function mapLeaderboard(leaderboard: {
      id: string;
      attributes: { vendorIdentifier?: string };
      relationships?: { build?: { data?: { id: string } | null } };
    }) {
      const leaderboardResource: GameCenterLeaderboardResource = { id: leaderboard.id };

      if (leaderboard.attributes.vendorIdentifier != null)
        Object.assign(leaderboardResource, {
          vendorIdentifier: leaderboard.attributes.vendorIdentifier,
        });

      return leaderboardResource;
    }

    return appleResources.map(mapLeaderboard);
  }

  /**
   * Create a Game Center leaderboard.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboards
   */
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

  /**
   * Create a Game Center leaderboard localization.
   *
   * @see https://developer.apple.com/documentation/appstoreconnectapi/post-v2-gamecenterleaderboardlocalizations
   */
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
