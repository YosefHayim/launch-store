import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  fakeBinaryResponse,
  makeKey,
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
describe('SalesAndFinance API', () => {
  it('downloads a sales report with the right filters and gzip Accept header', async () => {
    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, 'gzip-bytes'));
    const bytes = await client.getSalesReport({
      vendorNumber: '12345678',
      frequency: 'DAILY',
      reportType: 'SALES',
      reportSubType: 'SUMMARY',
      reportDate: '2026-06-01',
      version: '1_0',
    });
    expect(bytes.toString()).toBe('gzip-bytes');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const path = String(url);
    expect(path).toContain('/salesReports?');
    expect(path).toContain('filter[frequency]=DAILY');
    expect(path).toContain('filter[reportType]=SALES');
    expect(path).toContain('filter[reportSubType]=SUMMARY');
    expect(path).toContain('filter[vendorNumber]=12345678');
    expect(path).toContain('filter[reportDate]=2026-06-01');
    expect(path).toContain('filter[version]=1_0');
    expect(requestHeaders(init).get('Accept')).toBe('application/a-gzip, application/json');
  });
  it('defaults the finance report type to FINANCE_DETAIL', async () => {
    fetchMock.mockResolvedValueOnce(fakeBinaryResponse(200, 'fin'));
    await client.getFinanceReport({
      vendorNumber: '12345678',
      reportDate: '2026-05',
      regionCode: 'ZZ',
    });
    const path = String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]);
    expect(path).toContain('/financeReports?');
    expect(path).toContain('filter[regionCode]=ZZ');
    expect(path).toContain('filter[reportType]=FINANCE_DETAIL');
  });
  it("surfaces Apple's 'no sales' detail on a report 404", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeBinaryResponse(
        404,
        '',
        JSON.stringify({ errors: [{ detail: 'There were no sales for the date specified.' }] }),
      ),
    );
    await expect(
      client.getSalesReport({
        vendorNumber: '1',
        frequency: 'DAILY',
        reportType: 'SALES',
        reportSubType: 'SUMMARY',
        reportDate: '2026-06-01',
      }),
    ).rejects.toThrow(/404.*no sales/);
  });
});
