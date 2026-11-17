import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import { fakeResponse, makeKey } from '@/app-store-connect-api/test-helpers.js';
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

describe('Screenshots and previews API', () => {
  it('deletes a screenshot and treats the 404 of an already-deleted one as success', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(404, JSON.stringify({ errors: [] })));

    await expect(client.deleteScreenshot('gone')).resolves.toBeUndefined();

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toBe('https://api.appstoreconnect.apple.com/v1/appScreenshots/gone');
    expect(init.method).toBe('DELETE');
  });

  it('reorders a screenshot set by patching its relationship in the given order', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));

    await client.reorderScreenshots('set1', ['shot3', 'shot2']);

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toBe(
      'https://api.appstoreconnect.apple.com/v1/appScreenshotSets/set1/relationships/appScreenshots',
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({
      data: [
        { type: 'appScreenshots', id: 'shot3' },
        { type: 'appScreenshots', id: 'shot2' },
      ],
    });
  });
});
