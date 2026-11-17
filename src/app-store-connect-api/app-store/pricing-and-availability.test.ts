import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  documentValueAt,
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
describe('Pricing and availability API', () => {
  it('matches an app price point by territory and customer price', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } },
            { id: 'pp2', attributes: { customerPrice: '9.99', territory: 'USA' } },
          ],
        }),
      ),
    );
    const point = await client.findAppPricePoint('app1', 'USA', 9.99);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/appPricePoints?filter[territory]=USA',
    );
    expect(point).toEqual({ id: 'pp2', customerPrice: '9.99', territory: 'USA' });
  });
  it('reads the open-interval manual app price and skips scheduled future prices', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            // A future scheduled change for USA - must be ignored, not mistaken for the current price.
            {
              attributes: { startDate: '2026-12-01', endDate: null },
              relationships: { appPricePoint: { data: { id: 'future' } } },
            },
            // The currently-effective price: open interval (no start, no end).
            {
              attributes: { startDate: null, endDate: null },
              relationships: { appPricePoint: { data: { id: 'pp2' } } },
            },
          ],
          included: [
            {
              type: 'appPricePoints',
              id: 'future',
              attributes: { customerPrice: '12.99', territory: 'USA' },
            },
            {
              type: 'appPricePoints',
              id: 'pp2',
              attributes: { customerPrice: '9.99', territory: 'USA' },
            },
          ],
        }),
      ),
    );
    expect(await client.getCurrentAppPrice('app1', 'USA')).toBe('9.99');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/appPriceSchedule/manualPrices?include=appPricePoint',
    );
  });
  it('returns null for the current app price when the schedule is absent (404)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getCurrentAppPrice('app1', 'USA')).toBeNull();
  });
  it('builds an app price schedule with a base territory and a temp-id included price', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'sched1', attributes: {} } })),
    );
    await client.createAppPriceSchedule('app1', 'USA', 'pp2');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/appPriceSchedules');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('appPriceSchedules');
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'app', 'data'])).toEqual({
      type: 'apps',
      id: 'app1',
    });
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'baseTerritory', 'data']),
    ).toEqual({
      type: 'territories',
      id: 'USA',
    });
    const tempId = documentValueAt(requestDocument, [
      'data',
      'relationships',
      'manualPrices',
      'data',
      0,
      'id',
    ]);
    // Apple's JSON:API inline creation rejects a bare id (409 "invalid format") - it must be ${local-id}-wrapped.
    expect(tempId).toBe('${launch-base-price}');
    expect(documentValueAt(requestDocument, ['included', 0])).toMatchObject({
      type: 'appPrices',
      id: tempId,
      relationships: { appPricePoint: { data: { type: 'appPricePoints', id: 'pp2' } } },
    });
  });
  it('reads available territories only when the territory relationship is present', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: {
              id: 'availability-1',
              attributes: { availableInNewTerritories: true },
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'row-usa',
                attributes: { available: true },
                relationships: { territory: { data: { type: 'territories', id: 'USA' } } },
              },
              {
                id: 'row-gbr',
                attributes: { available: false },
                relationships: { territory: { data: { type: 'territories', id: 'GBR' } } },
              },
              {
                id: 'row-can',
                attributes: { available: true },
                relationships: { territory: { data: { type: 'territories', id: 'CAN' } } },
              },
            ],
            links: {},
          }),
        ),
      );
    await expect(client.getAppAvailability('app-1')).resolves.toEqual({
      id: 'availability-1',
      availableInNewTerritories: true,
      availableTerritories: ['USA', 'CAN'],
    });
    const [headUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'availability head');
    expect(headUrl).toContain('/apps/app-1/appAvailabilityV2');
    const [territoryListUrl] = expectArrayElement(
      fetchMock.mock.calls,
      1,
      'territory availability list',
    );
    expect(territoryListUrl).toContain(
      '/v2/appAvailabilities/availability-1/territoryAvailabilities',
    );
    expect(territoryListUrl).toContain('include=territory');
    expect(territoryListUrl).not.toContain('fields[territoryAvailabilities]');
  });
  it('returns null when the app has no availability singleton', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    await expect(client.getAppAvailability('app-1')).resolves.toBeNull();
  });
  it('creates the singleton with POST and the complete inline territory set', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'availability-1', attributes: {} } })),
    );
    await client.createAppAvailability('app-1', {
      availableInNewTerritories: false,
      territories: ['GBR', 'USA'],
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'create availability call');
    expect(url).toBe('https://api.appstoreconnect.apple.com/v2/appAvailabilities');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toEqual({
      data: {
        type: 'appAvailabilities',
        attributes: { availableInNewTerritories: false },
        relationships: {
          app: { data: { type: 'apps', id: 'app-1' } },
          territoryAvailabilities: {
            data: [
              { type: 'territoryAvailabilities', id: 'GBR' },
              { type: 'territoryAvailabilities', id: 'USA' },
            ],
          },
        },
      },
      included: [
        {
          type: 'territoryAvailabilities',
          id: 'GBR',
          attributes: { available: true },
          relationships: { territory: { data: { type: 'territories', id: 'GBR' } } },
        },
        {
          type: 'territoryAvailabilities',
          id: 'USA',
          attributes: { available: true },
          relationships: { territory: { data: { type: 'territories', id: 'USA' } } },
        },
      ],
    });
  });
  it('PATCHes only changed territory rows when the singleton already exists', async () => {
    fetchMock.mockImplementation((_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return Promise.resolve(
          fakeResponse(
            200,
            JSON.stringify({
              data: [
                {
                  id: 'row-usa',
                  attributes: { available: false },
                  relationships: { territory: { data: { id: 'USA' } } },
                },
                {
                  id: 'row-gbr',
                  attributes: { available: true },
                  relationships: { territory: { data: { id: 'GBR' } } },
                },
                {
                  id: 'row-can',
                  attributes: { available: false },
                  relationships: { territory: { data: { id: 'CAN' } } },
                },
              ],
              links: {},
            }),
          ),
        );
      }
      return Promise.resolve(fakeResponse(204, ''));
    });
    await client.updateAppAvailabilityTerritories('availability-1', ['USA']);
    const [readUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'territory availability read');
    expect(readUrl).toContain('/v2/appAvailabilities/availability-1/territoryAvailabilities');
    expect(readUrl).toContain('include=territory');
    const patches = fetchMock.mock.calls
      .slice(1)
      .map(([url, init]) => ({ url, init, body: readRequestDocument(init) }));
    expect(patches).toHaveLength(2);
    expect(patches).toEqual(
      expect.arrayContaining([
        {
          url: 'https://api.appstoreconnect.apple.com/v1/territoryAvailabilities/row-usa',
          init: expect.objectContaining({ method: 'PATCH' }),
          body: {
            data: {
              type: 'territoryAvailabilities',
              id: 'row-usa',
              attributes: { available: true },
            },
          },
        },
        {
          url: 'https://api.appstoreconnect.apple.com/v1/territoryAvailabilities/row-gbr',
          init: expect.objectContaining({ method: 'PATCH' }),
          body: {
            data: {
              type: 'territoryAvailabilities',
              id: 'row-gbr',
              attributes: { available: false },
            },
          },
        },
      ]),
    );
  });
  it('accepts an empty desired set and disables every currently available territory', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'row-usa',
                attributes: { available: true },
                relationships: { territory: { data: { id: 'USA' } } },
              },
              {
                id: 'row-gbr',
                attributes: { available: false },
                relationships: { territory: { data: { id: 'GBR' } } },
              },
            ],
            links: {},
          }),
        ),
      )
      .mockResolvedValueOnce(fakeResponse(204, ''));
    await client.updateAppAvailabilityTerritories('availability-1', []);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 1, 'clear territory call');
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/territoryAvailabilities/row-usa');
    expect(init.method).toBe('PATCH');
    expect(documentValueAt(readRequestDocument(init), ['data', 'attributes'])).toEqual({
      available: false,
    });
  });
  it('fails before PATCHing when Apple omits a desired territory row', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'row-usa',
              attributes: { available: true },
              relationships: { territory: { data: { id: 'USA' } } },
            },
          ],
          links: {},
        }),
      ),
    );
    await expect(
      client.updateAppAvailabilityTerritories('availability-1', ['USA', 'GBR']),
    ).rejects.toThrow(/GBR/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('never POSTs a second singleton when updating an existing availability', async () => {
    fetchMock.mockImplementation((_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return Promise.resolve(
          fakeResponse(
            200,
            JSON.stringify({
              data: [
                {
                  id: 'row-usa',
                  attributes: { available: true },
                  relationships: { territory: { data: { id: 'USA' } } },
                },
              ],
              links: {},
            }),
          ),
        );
      }
      if (init?.method === 'PATCH') return Promise.resolve(fakeResponse(204, ''));
      return Promise.resolve(
        fakeResponse(500, JSON.stringify({ errors: [{ title: 'unexpected' }] })),
      );
    });
    await client.updateAppAvailabilityTerritories('availability-1', []);
    const methods = fetchMock.mock.calls.map(([, requestInit]) => {
      if (requestInit?.method === undefined) return 'GET';
      return requestInit.method;
    });
    expect(methods).not.toContain('POST');
    expect(methods).toContain('PATCH');
    const createSingletonCalls = fetchMock.mock.calls.filter(([requestUrl, requestInit]) => {
      if (requestInit?.method !== 'POST') return false;
      return String(requestUrl).includes('/v2/appAvailabilities');
    });
    expect(createSingletonCalls).toHaveLength(0);
  });
});
