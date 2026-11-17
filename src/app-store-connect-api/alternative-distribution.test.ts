import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAppStoreConnectApi, type AppStoreConnectApi } from './app-store-connect-api.js';
import { documentValueAt, fakeResponse, makeKey, readRequestDocument } from './test-helpers.js';
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
describe('AlternativeDistribution API', () => {
  it('lists authorized distribution domains with their reference names', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'd1',
              attributes: { domain: 'downloads.acme.com', referenceName: 'Acme Downloads' },
            },
            { id: 'd2', attributes: { domain: 'cdn.acme.com' } },
          ],
        }),
      ),
    );
    const domains = await client.listAlternativeDistributionDomains();
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/alternativeDistributionDomains?limit=200',
    );
    expect(domains).toEqual([
      { id: 'd1', domain: 'downloads.acme.com', referenceName: 'Acme Downloads' },
      { id: 'd2', domain: 'cdn.acme.com' },
    ]);
  });
  it('creates a distribution domain with the domain + reference name', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'd-new', attributes: {} } })),
    );
    await client.createAlternativeDistributionDomain('cdn.acme.com', 'Acme CDN');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(url).toContain('/alternativeDistributionDomains');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data'])).toEqual({
      type: 'alternativeDistributionDomains',
      attributes: { domain: 'cdn.acme.com', referenceName: 'Acme CDN' },
    });
  });
  it('registers the package-signing public key', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'k-new', attributes: {} } })),
    );
    const created = await client.createAlternativeDistributionKey(
      '-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----',
    );
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('alternativeDistributionKeys');
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'publicKey'])).toContain(
      'BEGIN PUBLIC KEY',
    );
    expect(created).toEqual({ id: 'k-new' });
  });
});
