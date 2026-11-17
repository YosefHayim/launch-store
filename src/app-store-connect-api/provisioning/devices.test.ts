import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  fakeResponse,
  makeKey,
  readRequestDocument,
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
describe('Devices API', () => {
  it('follows the absolute links.next URL verbatim, without the /v1/v1 double-prefix', async () => {
    const page2Url = 'https://api.appstoreconnect.apple.com/v1/devices?cursor=PAGE2';
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'd1', attributes: { udid: 'AAAA', name: 'Phone A', status: 'ENABLED' } }],
            links: { next: page2Url },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ data: [{ id: 'd2', attributes: { udid: 'BBBB', name: 'Phone B' } }] }),
        ),
      );
    const devices = await client.listDevices();
    // Both pages folded into one list - reading only page 1 would silently truncate the team.
    expect(devices.map((d) => d.udid)).toEqual(['AAAA', 'BBBB']);
    // The crux of the #3764 regression: the second request hits the absolute next URL exactly,
    // NOT https://.../v1/v1/devices?... (which is what re-prefixing BASE_URL would produce).
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(page2Url);
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).not.toContain(
      '/v1/v1',
    );
  });
  it('stops after one page when there is no links.next', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'd1', attributes: { udid: 'AAAA', name: 'Phone A' } }] }),
      ),
    );
    expect(await client.listDevices()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('finds a registered device by UDID case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'd1', attributes: { udid: 'abcd1234', name: 'Phone' } }] }),
      ),
    );
    const found = await client.findDeviceByUdid('ABCD1234');
    expect(found?.id).toBe('d1');
  });
  it('POSTs a correctly-shaped device registration', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'd9', attributes: { udid: 'UDID9', name: "Dana's iPhone" } },
        }),
      ),
    );
    const created = await client.registerDevice('UDID9', "Dana's iPhone");
    expect(created).toMatchObject({ id: 'd9', udid: 'UDID9', name: "Dana's iPhone" });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'devices',
        attributes: { udid: 'UDID9', name: "Dana's iPhone", platform: 'IOS' },
      },
    });
  });
  it('does NOT repeat a write after a dropped connection (it may already have landed)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.registerDevice('UDID9', "Dana's iPhone")).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
