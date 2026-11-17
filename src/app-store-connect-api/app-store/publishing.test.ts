import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import {
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
describe('AppStoreConnectClient - App Store release lifecycle', () => {
  it("returns null for a phased release that doesn't exist (404 or empty relationship)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getPhasedRelease('v1')).toBeNull();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: null })));
    expect(await client.getPhasedRelease('v2')).toBeNull();
  });
  it("propagates a non-404 failure on an optional read instead of swallowing it as 'absent'", async () => {
    // The shared 404-as-absent path (getOptional) must only catch 404s - any other status is a real failure
    // that has to surface, not be misread as "no phased release". A 403 is non-retryable (isRetryableAscError
    // covers only 429/5xx), so it rejects on the first attempt with no backoff and still carries the status.
    fetchMock.mockResolvedValueOnce(
      fakeResponse(403, JSON.stringify({ errors: [{ title: 'Forbidden' }] })),
    );
    await expect(client.getPhasedRelease('v3')).rejects.toThrow(/403/);
  });
  it('steers a phased release with a state PATCH', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.updatePhasedRelease('ph1', 'PAUSE');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appStoreVersionPhasedReleases/ph1');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'appStoreVersionPhasedReleases',
        id: 'ph1',
        attributes: { phasedReleaseState: 'PAUSE' },
      },
    });
  });
});
