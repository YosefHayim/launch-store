import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import {
  documentValueAt,
  fakeResponse,
  makeKey,
  readRequestDocument,
} from '@/app-store-connect-api/test-helpers.js';
import {
  type AppStoreConnectApi,
  makeAppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
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
describe('App Clips', () => {
  it('lists default experiences with the version each releases with (from the relationship)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'exp-1',
              attributes: { action: 'OPEN' },
              relationships: {
                releaseWithAppStoreVersion: { data: { type: 'appStoreVersions', id: 'ver-1' } },
              },
            },
            { id: 'exp-2', attributes: {}, relationships: {} },
          ],
        }),
      ),
    );
    const experiences = await client.listAppClipDefaultExperiences('clip-1');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/appClips/clip-1/appClipDefaultExperiences',
    );
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      'include=releaseWithAppStoreVersion',
    );
    expect(experiences).toEqual([
      { id: 'exp-1', action: 'OPEN', versionId: 'ver-1' },
      { id: 'exp-2' },
    ]);
  });
  it('creates a default experience with the appClip + version relationships and the action', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'exp-new', attributes: {} } })),
    );
    const created = await client.createAppClipDefaultExperience('clip-1', 'ver-1', 'VIEW');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(url).toContain('/appClipDefaultExperiences');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'action'])).toBe('VIEW');
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'appClip', 'data'])).toEqual({
      type: 'appClips',
      id: 'clip-1',
    });
    expect(
      documentValueAt(requestDocument, [
        'data',
        'relationships',
        'releaseWithAppStoreVersion',
        'data',
      ]),
    ).toEqual({
      type: 'appStoreVersions',
      id: 'ver-1',
    });
    expect(created).toEqual({ id: 'exp-new' });
  });
  it('omits the attributes block when no action is given on create', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'exp-new', attributes: {} } })),
    );
    await client.createAppClipDefaultExperience('clip-1', 'ver-1');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toBeUndefined();
  });
  it('creates a card localization with locale + subtitle under the experience', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'loc-new', attributes: {} } })),
    );
    await client.createAppClipDefaultExperienceLocalization('exp-1', 'en-US', 'Order now');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/appClipDefaultExperienceLocalizations');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toEqual({
      locale: 'en-US',
      subtitle: 'Order now',
    });
    expect(
      documentValueAt(requestDocument, [
        'data',
        'relationships',
        'appClipDefaultExperience',
        'data',
      ]),
    ).toEqual({
      type: 'appClipDefaultExperiences',
      id: 'exp-1',
    });
  });
});
