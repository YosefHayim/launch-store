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
describe('Certificates API', () => {
  it('lists distribution certificates filtered by certificate type', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'c1',
              attributes: {
                serialNumber: 'S1',
                certificateContent: 'PEM',
                expirationDate: '2027-01-01',
              },
            },
          ],
        }),
      ),
    );
    const certificates = await client.listDistributionCertificates();
    expect(certificates).toEqual([
      { id: 'c1', serialNumber: 'S1', certificateContent: 'PEM', expirationDate: '2027-01-01' },
    ]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toContain(
      '/certificates?filter[certificateType]=DISTRIBUTION&limit=200',
    );
  });
  it('creates a distribution certificate from a signing request', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'c2', attributes: { serialNumber: 'S2', certificateContent: 'PEM2' } },
        }),
      ),
    );
    const certificate = await client.createCertificate('CSR');
    expect(certificate).toMatchObject({ id: 'c2', serialNumber: 'S2', certificateContent: 'PEM2' });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'certificates',
        attributes: { csrContent: 'CSR', certificateType: 'DISTRIBUTION' },
      },
    });
  });
});
