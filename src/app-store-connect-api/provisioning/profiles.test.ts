import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  documentValueAt,
  fakeResponse,
  makeKey,
  readRequestDocument,
  requestHeaders,
} from '@/app-store-connect-api/test-helpers.js';
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
describe('Profiles API', () => {
  it("creates an App Store profile with the platform's profile type (tvOS)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'pf2', attributes: { name: 'TV', uuid: 'U2', profileContent: 'B64' } },
        }),
      ),
    );
    await client.createAppStoreProfile('TV', 'bundle1', 'cert1', 'TVOS_APP_STORE');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'profileType'])).toBe(
      'TVOS_APP_STORE',
    );
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'bundleId', 'data'])).toEqual(
      {
        type: 'bundleIds',
        id: 'bundle1',
      },
    );
  });
  it('treats a 204 as success with no body (profile deletion)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await expect(client.deleteProfile('p1')).resolves.toBeUndefined();
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('DELETE');
    expect(url).toContain('/profiles/p1');
    expect(requestHeaders(init).get('Content-Type')).toBeNull();
  });
  it('creates an ad-hoc profile linking the bundle, cert, and every listed device', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'pf1', attributes: { name: 'AdHoc', uuid: 'U', profileContent: 'B64' } },
        }),
      ),
    );
    const profile = await client.createAdHocProfile('AdHoc', 'bundle1', 'cert1', ['d1', 'd2']);
    expect(profile).toEqual({ id: 'pf1', name: 'AdHoc', uuid: 'U', profileContent: 'B64' });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'profileType'])).toBe(
      'IOS_APP_ADHOC',
    );
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'devices', 'data'])).toEqual([
      { type: 'devices', id: 'd1' },
      { type: 'devices', id: 'd2' },
    ]);
  });
  it('creates a tvOS ad-hoc profile with the TVOS_APP_ADHOC type when passed', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'pf3', attributes: { name: 'TVAdHoc', uuid: 'U3', profileContent: 'B64' } },
        }),
      ),
    );
    await client.createAdHocProfile('TVAdHoc', 'bundle1', 'cert1', ['d1'], 'TVOS_APP_ADHOC');
    expect(
      documentValueAt(
        readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
        ['data', 'attributes', 'profileType'],
      ),
    ).toBe('TVOS_APP_ADHOC');
  });
});
