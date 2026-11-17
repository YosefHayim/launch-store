import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import { makeKey, fakeResponse } from '@/app-store-connect-api/test-helpers.js';
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
describe('Apps API', () => {
  it('lists accessible app names, dropping any without a name', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { attributes: { name: 'Mapleleaf' } },
            { attributes: {} },
            { attributes: { name: 'SampleApp' } },
          ],
        }),
      ),
    );
    expect(await client.listAppNames()).toEqual(['Mapleleaf', 'SampleApp']);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps?fields[apps]=name',
    );
  });
  it('lists apps with id, name and bundle id, using the id when a name is missing', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: '1', attributes: { name: 'Mapleleaf', bundleId: 'com.acme.maple' } },
            { id: '2', attributes: {} },
          ],
        }),
      ),
    );
    expect(await client.listApps()).toEqual([
      { id: '1', name: 'Mapleleaf', bundleId: 'com.acme.maple' },
      { id: '2', name: '2', bundleId: null },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps?fields[apps]=name,bundleId&limit=200',
    );
  });
});
