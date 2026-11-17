import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
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
describe('BundleIds API', () => {
  it('POSTs a correctly-shaped bundle-id registration with a JSON content type', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'b1', attributes: { identifier: 'com.x', seedId: 'SEED' } } }),
      ),
    );
    const created = await client.createBundleId('com.x', 'X App');
    expect(created).toEqual({ id: 'b1', identifier: 'com.x', seedId: 'SEED' });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(requestHeaders(init).get('Content-Type')).toBe('application/json');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'bundleIds',
        attributes: { identifier: 'com.x', name: 'X App', platform: 'IOS' },
      },
    });
  });
  it('registers a macOS bundle id under MAC_OS when the platform is passed', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'b2', attributes: { identifier: 'com.x.mac', seedId: 'SEED' } },
        }),
      ),
    );
    await client.createBundleId('com.x.mac', 'X Mac', 'MAC_OS');
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
    ).toMatchObject({
      data: { type: 'bundleIds', attributes: { platform: 'MAC_OS' } },
    });
  });
  it('enables a capability with the bundleId relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'cap1', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } },
        }),
      ),
    );
    const created = await client.enableCapability('bundle1', 'PUSH_NOTIFICATIONS');
    expect(created).toEqual({ id: 'cap1', capabilityType: 'PUSH_NOTIFICATIONS' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/bundleIdCapabilities');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
        relationships: { bundleId: { data: { type: 'bundleIds', id: 'bundle1' } } },
      },
    });
  });
  it('lists bundle id capabilities without a limit param (the related endpoint rejects it)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'cap1', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } }],
        }),
      ),
    );
    const caps = await client.listBundleIdCapabilities('bundle1');
    expect(caps).toEqual([{ id: 'cap1', capabilityType: 'PUSH_NOTIFICATIONS' }]);
    const url = String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]);
    expect(url).toContain('/bundleIds/bundle1/bundleIdCapabilities');
    expect(url).not.toContain('limit');
    expect(url).toContain('fields[bundleIdCapabilities]=capabilityType,settings');
  });
  it('selects the exact identifier when the substring filter also returns child bundle ids', async () => {
    // Apple's filter[identifier] is a substring match, so a query for the main bundle also returns its
    // widget - and it can come back first. The exact row must win, never data[0].
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'widget-res', attributes: { identifier: 'com.example.sampleapp.widget' } },
            {
              id: 'main-res',
              attributes: { identifier: 'com.example.sampleapp', seedId: 'TEAM01' },
            },
          ],
        }),
      ),
    );
    const bundle = await client.findBundleId('com.example.sampleapp');
    expect(bundle).toEqual({
      id: 'main-res',
      identifier: 'com.example.sampleapp',
      seedId: 'TEAM01',
    });
    // Drops the limit=1 that could paginate the exact row away behind its substring siblings.
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('filter[identifier]=com.example.sampleapp');
    expect(url).toContain('limit=200');
  });
  it('returns null when only substring siblings match (the bundle itself is unregistered)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'widget-res', attributes: { identifier: 'com.example.sampleapp.widget' } }],
        }),
      ),
    );
    expect(await client.findBundleId('com.example.sampleapp')).toBeNull();
  });
});
