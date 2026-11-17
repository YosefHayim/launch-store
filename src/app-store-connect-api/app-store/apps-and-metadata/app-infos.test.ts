import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  makeKey,
  documentValueAt,
  fakeResponse,
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
describe('app-level release attributes', () => {
  it('resolves the editable app info and its current category ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'live', attributes: { state: 'READY_FOR_DISTRIBUTION' }, relationships: {} },
            {
              id: 'editable',
              attributes: { state: 'PREPARE_FOR_SUBMISSION' },
              relationships: {
                primaryCategory: { data: { type: 'appCategories', id: 'PRODUCTIVITY' } },
                secondaryCategory: { data: { type: 'appCategories', id: 'BUSINESS' } },
              },
            },
          ],
        }),
      ),
    );
    const appInformation = await client.getAppInfo('app1');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/appInfos?include=primaryCategory,secondaryCategory',
    );
    expect(appInformation).toEqual({
      id: 'editable',
      state: 'PREPARE_FOR_SUBMISSION',
      primaryCategoryId: 'PRODUCTIVITY',
      secondaryCategoryId: 'BUSINESS',
    });
  });
  it('PATCHes only the categories provided, as appCategories relationships', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'editable', attributes: {} } })),
    );
    await client.updateAppInfoCategories('editable', { primaryCategoryId: 'GAMES' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appInfos/editable');
    const requestDocument = readRequestDocument(init);
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'primaryCategory', 'data']),
    ).toEqual({
      type: 'appCategories',
      id: 'GAMES',
    });
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'secondaryCategory']),
    ).toBeUndefined();
  });
  it('PATCHes secondaryCategory to null when clearing the stale secondary category', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'editable', attributes: {} } })),
    );
    await client.updateAppInfoCategories('editable', { secondaryCategoryId: null });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(init);
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'secondaryCategory', 'data']),
    ).toBeNull();
  });
  it('reads an age-rating declaration and treats a 404 as none', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: { id: 'age1', attributes: { violenceCartoonOrFantasy: 'NONE' } } }),
      ),
    );
    expect(await client.getAgeRatingDeclaration('editable')).toEqual({
      id: 'age1',
      attributes: { violenceCartoonOrFantasy: 'NONE' },
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getAgeRatingDeclaration('editable')).toBeNull();
  });
  it('PATCHes age-rating answers verbatim', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'age1', attributes: {} } })),
    );
    await client.updateAgeRatingDeclaration('age1', {
      gambling: false,
      violenceRealistic: 'INFREQUENT',
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data'])).toEqual({
      type: 'ageRatingDeclarations',
      id: 'age1',
      attributes: { gambling: false, violenceRealistic: 'INFREQUENT' },
    });
  });
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
  it('finds the editable App Store version and skips frozen ones', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'v-live', attributes: { appVersionState: 'READY_FOR_DISTRIBUTION' } },
            {
              id: 'v-edit',
              attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', copyright: null },
            },
          ],
        }),
      ),
    );
    expect(await client.findEditableAppStoreVersion('app1', 'IOS')).toEqual({
      id: 'v-edit',
      copyright: '',
    });
    const requestUrl = expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0];
    expect(requestUrl).toContain('/apps/app1/appStoreVersions?filter[platform]=IOS');
    expect(requestUrl).toContain('copyright');
  });
  it("reads the editable version's copyright", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'v-edit',
              attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', copyright: '2026 Acme' },
            },
          ],
        }),
      ),
    );
    expect(await client.findEditableAppStoreVersion('app1', 'IOS')).toEqual({
      id: 'v-edit',
      copyright: '2026 Acme',
    });
  });
  it('sends copyright in the App Store version PATCH', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: { id: 'v-edit' } })));
    await client.updateAppStoreVersion('v-edit', {
      releaseType: 'AFTER_APPROVAL',
      copyright: '2026 Acme',
    });
    const patchCall = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(patchCall[0]).toContain('/appStoreVersions/v-edit');
    const patchBody = readRequestDocument(patchCall[1]);
    expect(documentValueAt(patchBody, ['data', 'attributes'])).toEqual({
      releaseType: 'AFTER_APPROVAL',
      copyright: '2026 Acme',
    });
  });
  it('returns null when no App Store version is editable', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'v-live', attributes: { appVersionState: 'REPLACED_WITH_NEW_VERSION' } }],
        }),
      ),
    );
    expect(await client.findEditableAppStoreVersion('app1', 'IOS')).toBeNull();
  });
  it('reads review details, creates them with the version relationship, and patches updates', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: { id: 'rd1', attributes: { contactEmail: 'a@b.co' } } }),
      ),
    );
    expect(await client.getAppStoreReviewDetail('v-edit')).toEqual({
      id: 'rd1',
      attributes: { contactEmail: 'a@b.co' },
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'rd2', attributes: {} } })),
    );
    const created = await client.createAppStoreReviewDetail('v-edit', {
      contactEmail: 'a@b.co',
      demoAccountRequired: false,
    });
    expect(created).toEqual({ id: 'rd2' });
    const createBody = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[1],
    );
    expect(
      documentValueAt(createBody, ['data', 'relationships', 'appStoreVersion', 'data']),
    ).toEqual({
      type: 'appStoreVersions',
      id: 'v-edit',
    });
    expect(documentValueAt(createBody, ['data', 'attributes'])).toEqual({
      contactEmail: 'a@b.co',
      demoAccountRequired: false,
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'rd2', attributes: {} } })),
    );
    await client.updateAppStoreReviewDetail('rd2', { notes: 'use the QR code' });
    const [patchUrl, patchInit] = expectArrayElement(fetchMock.mock.calls, 2, 'mock call');
    expect(patchInit.method).toBe('PATCH');
    expect(patchUrl).toContain('/appStoreReviewDetails/rd2');
  });
  it('returns null review details on a 404', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getAppStoreReviewDetail('v-edit')).toBeNull();
  });
});
