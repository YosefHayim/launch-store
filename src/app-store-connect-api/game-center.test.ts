import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAppStoreConnectApi, type AppStoreConnectApi } from './app-store-connect-api.js';
import { documentValueAt, fakeResponse, makeKey, readRequestDocument } from './test-helpers.js';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
const fetchMock = vi.fn();
let client: AppStoreConnectApi;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = makeAppStoreConnectApi(makeKey());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('GameCenter API', () => {
  it('returns null when the app has no Game Center detail yet (404)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getGameCenterDetail('app-1')).toBeNull();
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app-1/gameCenterDetail',
    );
  });
  it('enables Game Center by creating a detail with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'gc-1', attributes: {} } })),
    );
    const detail = await client.createGameCenterDetail('app-1');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'app', 'data'])).toEqual({
      type: 'apps',
      id: 'app-1',
    });
    expect(detail).toEqual({ id: 'gc-1' });
  });
  it('lists achievements and leaderboards through the non-deprecated V2 relationship paths', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    await client.listGameCenterAchievements('gc-1');
    await client.listGameCenterLeaderboards('gc-1');
    const [achievementsUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const [leaderboardsUrl] = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    expect(achievementsUrl).toContain('/gameCenterDetails/gc-1/gameCenterAchievementsV2?');
    expect(leaderboardsUrl).toContain('/gameCenterDetails/gc-1/gameCenterLeaderboardsV2?');
  });
  it('creates a V2 achievement with an inline version and returns the real version id', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'ach-1',
            relationships: {
              versions: { data: [{ type: 'gameCenterAchievementVersions', id: 'ver-real' }] },
            },
          },
        }),
      ),
    );
    const createdResource = await client.createGameCenterAchievement('gc-1', {
      referenceName: 'First Win',
      vendorIdentifier: 'first_win',
      points: 10,
      showBeforeEarned: false,
      repeatable: false,
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/v2/gameCenterAchievements');
    const requestDocument = readRequestDocument(init);
    // Apple requires the inline temp id as ${local-id} in both the relationship and the included version.
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'versions', 'data', 0, 'id']),
    ).toBe('${version-0}');
    expect(documentValueAt(requestDocument, ['included', 0])).toEqual({
      type: 'gameCenterAchievementVersions',
      id: '${version-0}',
    });
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'gameCenterDetail', 'data']),
    ).toEqual({
      type: 'gameCenterDetails',
      id: 'gc-1',
    });
    expect(createdResource).toEqual({ id: 'ach-1', versionId: 'ver-real' });
  });
  it("returns a null version id when Apple's create response omits the versions relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'ach-2', relationships: {} } })),
    );
    const createdResource = await client.createGameCenterAchievement('gc-1', {
      referenceName: 'x',
      vendorIdentifier: 'x',
      points: 1,
      showBeforeEarned: false,
      repeatable: false,
    });
    expect(createdResource.versionId).toBeNull();
  });
  it('attaches an achievement localization to the version', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'loc-1', attributes: {} } })),
    );
    await client.createGameCenterAchievementLocalization('ver-real', {
      locale: 'en-US',
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/v2/gameCenterAchievementLocalizations');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toEqual({
      locale: 'en-US',
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'version', 'data'])).toEqual({
      type: 'gameCenterAchievementVersions',
      id: 'ver-real',
    });
  });
  it('creates a V2 leaderboard with its attributes and an inline version', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'lb-1',
            relationships: {
              versions: { data: [{ type: 'gameCenterLeaderboardVersions', id: 'lv-real' }] },
            },
          },
        }),
      ),
    );
    const createdResource = await client.createGameCenterLeaderboard('gc-1', {
      referenceName: 'High Score',
      vendorIdentifier: 'high_score',
      defaultFormatter: 'INTEGER',
      submissionType: 'BEST_SCORE',
      scoreSortType: 'DESC',
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'defaultFormatter'])).toBe(
      'INTEGER',
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'scoreSortType'])).toBe('DESC');
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'versions', 'data', 0, 'id']),
    ).toBe('${version-0}');
    expect(documentValueAt(requestDocument, ['included', 0])).toEqual({
      type: 'gameCenterLeaderboardVersions',
      id: '${version-0}',
    });
    expect(createdResource).toEqual({ id: 'lb-1', versionId: 'lv-real' });
  });
});
