import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectArrayElement } from '@testkit/assertions.testkit.js';
import { fakeBinaryResponse, fakeResponse, makeKey } from '@/app-store-connect-api/test-helpers.js';
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
describe('AppStoreConnectClient - TestFlight beta feedback', () => {
  it('parses crash submissions and resolves the build version from the included builds', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'c1',
              attributes: {
                createdDate: '2026-06-20T00:00:00Z',
                comment: 'froze',
                email: 't@x.com',
                deviceModel: 'iPhone 15',
                osVersion: '17.5',
              },
              relationships: { build: { data: { id: 'b1' } } },
            },
          ],
          included: [{ type: 'builds', id: 'b1', attributes: { version: '42' } }],
        }),
      ),
    );
    const crashes = await client.listBetaFeedbackCrashSubmissions('app1');
    expect(crashes).toEqual([
      {
        id: 'c1',
        createdDate: '2026-06-20T00:00:00Z',
        comment: 'froze',
        email: 't@x.com',
        deviceModel: 'iPhone 15',
        osVersion: '17.5',
        buildVersion: '42',
      },
    ]);
    const [url] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toContain('/apps/app1/betaFeedbackCrashSubmissions?include=build');
    expect(String(url)).toContain('sort=-createdDate');
  });
  it('parses screenshot submissions, keeping only attachments with a usable URL', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 's1',
              attributes: {
                screenshots: [
                  { url: 'https://a/1.png', width: 100, height: 200 },
                  { width: 1, height: 1 },
                ],
              },
              relationships: { build: { data: { id: 'b1' } } },
            },
          ],
          included: [{ type: 'builds', id: 'b1', attributes: { version: '7' } }],
        }),
      ),
    );
    const shots = await client.listBetaFeedbackScreenshotSubmissions('app1');
    expect(shots).toEqual([
      {
        id: 's1',
        buildVersion: '7',
        screenshots: [{ url: 'https://a/1.png', width: 100, height: 200 }],
      },
    ]);
  });
  it('omits the null comment, email and device fields of an anonymous submission', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 's2',
              attributes: {
                createdDate: '2026-06-21T00:00:00Z',
                comment: null,
                email: null,
                deviceModel: null,
                osVersion: null,
                screenshots: [],
              },
            },
          ],
        }),
      ),
    );
    expect(await client.listBetaFeedbackScreenshotSubmissions('app1')).toEqual([
      { id: 's2', createdDate: '2026-06-21T00:00:00Z', screenshots: [] },
    ]);
  });
  it('pushes filter[build] when a build id is given', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    await client.listBetaFeedbackCrashSubmissions('app1', { buildId: 'b9' });
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toContain(
      'filter[build]=b9',
    );
  });
  it('downloads a screenshot from its presigned URL without an Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, 'imgbytes'));
    const bytes = await client.downloadBetaFeedbackScreenshot('https://apple.example/shot.png');
    expect(bytes.toString()).toBe('imgbytes');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toBe('https://apple.example/shot.png');
    expect(init).toBeUndefined();
  });
});
