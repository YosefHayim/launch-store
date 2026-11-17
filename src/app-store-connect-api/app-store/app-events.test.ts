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
describe('AppStoreConnectClient - listing localizations', () => {
  it('omits null optional fields from in-app events and their localizations', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'ev1',
                attributes: {
                  referenceName: 'Launch week',
                  badge: null,
                  eventState: 'DRAFT',
                  primaryLocale: null,
                  deepLink: null,
                  priority: null,
                  purpose: null,
                },
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'evl1',
                attributes: {
                  locale: 'en-US',
                  name: null,
                  shortDescription: null,
                  longDescription: null,
                },
              },
            ],
          }),
        ),
      );
    expect(await client.listAppEvents('app1')).toEqual([
      { id: 'ev1', referenceName: 'Launch week', eventState: 'DRAFT' },
    ]);
    expect(await client.listAppEventLocalizations('ev1')).toEqual([
      { id: 'evl1', locale: 'en-US' },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]).toContain(
      '/appEvents/ev1/localizations?',
    );
  });
});
