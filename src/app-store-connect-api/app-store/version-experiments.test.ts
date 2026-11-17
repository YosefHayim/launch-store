import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { fakeResponse, makeKey } from '@/app-store-connect-api/test-helpers.js';
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
describe('AppStoreConnectClient - product catalog', () => {
  it('creates a version experiment and lists its treatments on the v2 paths', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(201, JSON.stringify({ data: { id: 'exp1', attributes: {} } })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ data: [{ id: 'treat1', attributes: { name: 'Colorful' } }] }),
        ),
      );
    await client.createVersionExperiment('app1', {
      name: 'Screenshots',
      platform: 'IOS',
      trafficProportion: 50,
    });
    const treatments = await client.listExperimentTreatments('exp1');
    expect(treatments).toEqual([{ id: 'treat1', name: 'Colorful' }]);
    const [createUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'create call');
    expect(String(createUrl)).toBe(
      'https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments',
    );
    const [listUrl] = expectArrayElement(fetchMock.mock.calls, 1, 'list call');
    expect(String(listUrl)).toContain(
      'https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments/exp1/appStoreVersionExperimentTreatments?',
    );
  });
});
