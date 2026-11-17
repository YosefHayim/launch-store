import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  fakeBinaryResponse,
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
describe('Analytics API', () => {
  it('creates an analytics report request with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'req1', attributes: { accessType: 'ONGOING' } } }),
      ),
    );
    const request = await client.createAnalyticsReportRequest('app1', 'ONGOING');
    expect(request).toEqual({ id: 'req1', accessType: 'ONGOING' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/analyticsReportRequests');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  });
  it('filters reports by category and instances by granularity/date', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'rep1', attributes: { name: 'App Sessions', category: 'APP_USAGE' } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'inst1', attributes: { granularity: 'DAILY', processingDate: '2026-06-01' } },
            ],
          }),
        ),
      );
    const reports = await client.listAnalyticsReports('req1', { category: 'APP_USAGE' });
    expect(reports).toEqual([{ id: 'rep1', name: 'App Sessions', category: 'APP_USAGE' }]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toContain(
      '/analyticsReportRequests/req1/reports?limit=200&filter[category]=APP_USAGE',
    );
    const instances = await client.listAnalyticsReportInstances('rep1', {
      granularity: 'DAILY',
      processingDate: '2026-06-01',
    });
    expect(instances).toEqual([
      { id: 'inst1', granularity: 'DAILY', processingDate: '2026-06-01' },
    ]);
    const instUrl = String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]);
    expect(instUrl).toContain(
      '/analyticsReports/rep1/instances?limit=200&filter[granularity]=DAILY',
    );
    expect(instUrl).toContain('filter[processingDate]=2026-06-01');
  });
  it('lists segments (dropping any without a url) and downloads one unauthenticated', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'seg1',
              attributes: {
                url: 'https://store.example/seg1.gz',
                checksum: 'abc',
                sizeInBytes: 10,
              },
            },
            { id: 'seg2', attributes: {} },
          ],
        }),
      ),
    );
    const segments = await client.listAnalyticsReportSegments('inst1');
    expect(segments).toEqual([
      { id: 'seg1', url: 'https://store.example/seg1.gz', checksum: 'abc', sizeInBytes: 10 },
    ]);
    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, 'segment-gzip'));
    const bytes = await client.downloadAnalyticsSegment('https://store.example/seg1.gz');
    expect(bytes.toString()).toBe('segment-gzip');
    // Presigned URL -> no init (and therefore no Authorization), so the storage backend doesn't 400 on dual auth.
    expect(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[1]).toBeUndefined();
  });
});
