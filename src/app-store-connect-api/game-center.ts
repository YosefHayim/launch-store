// Docs: https://developer.apple.com/documentation/appstoreconnectapi/game-center
import type { components } from '@apple/generated/schema.js';
import type {
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterDetailResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
  LeaderboardFormatter,
} from '@core/types/appleCatalog.js';
import type { AppStoreConnectRequests, ResourceSingle } from './api-client.js';
export const makeGameCenterApi = (api: AppStoreConnectRequests) => {
  /** Read an app's Game Center detail (the container enabling Game Center), or null when not yet enabled. */
  const getGameCenterDetail = async (appId: string): Promise<GameCenterDetailResource | null> => {
    return api.getOptional(async () => {
      const { data: appleResources } = await api.request<{
        data: {
          id: string;
        } | null;
      }>('GET', `/apps/${appId}/gameCenterDetail`);
      if (appleResources === null) return null;
      return { id: appleResources.id };
    });
  };
  /** Enable Game Center for an app by creating its detail container, returning the new detail. */
  const createGameCenterDetail = async (appId: string): Promise<GameCenterDetailResource> => {
    const requestDocument: components['schemas']['GameCenterDetailCreateRequest'] = {
      data: {
        type: 'gameCenterDetails',
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    };
    const { data: appleResources } = await api.request<ResourceSingle<Record<string, never>>>(
      'POST',
      '/gameCenterDetails',
      requestDocument,
    );
    return { id: appleResources.id };
  };
  /** List a detail's achievements (just their `vendorIdentifier`s - the reconciler's idempotency key). */
  const listGameCenterAchievements = async (
    detailId: string,
  ): Promise<GameCenterAchievementResource[]> => {
    const appleResources = await api.requestAll<{
      vendorIdentifier?: string;
    }>(
      `/gameCenterDetails/${detailId}/gameCenterAchievementsV2?fields[gameCenterAchievements]=vendorIdentifier&limit=200`,
    );
    return appleResources.map((achievement) => {
      const achievementResource: GameCenterAchievementResource = { id: achievement.id };
      if (achievement.attributes.vendorIdentifier !== undefined)
        Object.assign(achievementResource, {
          vendorIdentifier: achievement.attributes.vendorIdentifier,
        });
      return achievementResource;
    });
  };
  /**
   * Create a Game Center achievement (V2) under a detail. The V2 model couples an achievement to an
   * initial version, so the create supplies an inline `gameCenterAchievementVersions` with a temp id
   * (the same temp-id + `included` pattern as {@link createSubscriptionOfferCode}); Apple returns the real
   * version id in `data.relationships.versions`, which {@link createGameCenterAchievementLocalization}
   * needs since localizations attach to the version, not the achievement.
   */
  const createGameCenterAchievement = async (
    detailId: string,
    attributes: GameCenterAchievementCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> => {
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
    const { data: appleResources } = await api.request<{
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
    }>('POST', api.v2('/gameCenterAchievements'), requestDocument);
    let versionId: string | null = null;
    const returnedVersionId = appleResources.relationships?.versions?.data?.[0]?.id;
    if (returnedVersionId !== undefined) versionId = returnedVersionId;
    return { id: appleResources.id, versionId };
  };
  /** Create the default-locale localization for an achievement version (name + before/after descriptions). */
  const createGameCenterAchievementLocalization = async (
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void> => {
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
    await api.request<unknown>(
      'POST',
      api.v2('/gameCenterAchievementLocalizations'),
      requestDocument,
    );
  };
  /** List a detail's leaderboards (just their `vendorIdentifier`s - the reconciler's idempotency key). */
  const listGameCenterLeaderboards = async (
    detailId: string,
  ): Promise<GameCenterLeaderboardResource[]> => {
    const appleResources = await api.requestAll<{
      vendorIdentifier?: string;
    }>(
      `/gameCenterDetails/${detailId}/gameCenterLeaderboardsV2?fields[gameCenterLeaderboards]=vendorIdentifier&limit=200`,
    );
    return appleResources.map((leaderboard) => {
      const leaderboardResource: GameCenterLeaderboardResource = { id: leaderboard.id };
      if (leaderboard.attributes.vendorIdentifier !== undefined)
        Object.assign(leaderboardResource, {
          vendorIdentifier: leaderboard.attributes.vendorIdentifier,
        });
      return leaderboardResource;
    });
  };
  /** Create a Game Center leaderboard (V2) under a detail - same inline-version pattern as the achievement create. */
  const createGameCenterLeaderboard = async (
    detailId: string,
    attributes: GameCenterLeaderboardCreate,
  ): Promise<{
    id: string;
    versionId: string | null;
  }> => {
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
    const { data: appleResources } = await api.request<{
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
    }>('POST', api.v2('/gameCenterLeaderboards'), requestDocument);
    let versionId: string | null = null;
    const returnedVersionId = appleResources.relationships?.versions?.data?.[0]?.id;
    if (returnedVersionId !== undefined) versionId = returnedVersionId;
    return { id: appleResources.id, versionId };
  };
  /** Create the default-locale localization for a leaderboard version (name, optional formatter override). */
  const createGameCenterLeaderboardLocalization = async (
    versionId: string,
    fields: {
      locale: string;
      name: string;
      formatterOverride?: LeaderboardFormatter;
    },
  ): Promise<void> => {
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
    await api.request<unknown>(
      'POST',
      api.v2('/gameCenterLeaderboardLocalizations'),
      requestDocument,
    );
  };
  return {
    getGameCenterDetail,
    createGameCenterDetail,
    listGameCenterAchievements,
    createGameCenterAchievement,
    createGameCenterAchievementLocalization,
    listGameCenterLeaderboards,
    createGameCenterLeaderboard,
    createGameCenterLeaderboardLocalization,
  };
};
