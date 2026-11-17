import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  makeAppStoreConnectApi,
  type AppStoreConnectApi,
} from '@/app-store-connect-api/app-store-connect-api.js';
import {
  makeKey,
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
describe('AppStoreConnectApi - listing localizations', () => {
  it('picks the editable App Store version, ignoring a live one', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'v-live', attributes: { appStoreState: 'READY_FOR_SALE' } },
            { id: 'v-edit', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } },
          ],
        }),
      ),
    );
    expect(await client.getEditableVersionId('app1')).toBe('v-edit');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/appStoreVersions',
    );
  });
  it('returns null when no App Store version is editable', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'v-live', attributes: { appStoreState: 'READY_FOR_SALE' } }],
        }),
      ),
    );
    expect(await client.getEditableVersionId('app1')).toBeNull();
  });
  it('picks the editable appInfo by state', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'ai-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
            { id: 'ai-edit', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
          ],
        }),
      ),
    );
    expect(await client.getEditableAppInfoId('app1')).toBe('ai-edit');
  });
  it('reads the live appInfo and version when nothing is editable', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'ai-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
              { id: 'ai-review', attributes: { state: 'WAITING_FOR_REVIEW' } },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'v-old', attributes: { appStoreState: 'REPLACED_WITH_NEW_VERSION' } },
              { id: 'v-live', attributes: { appStoreState: 'READY_FOR_SALE' } },
            ],
          }),
        ),
      );
    expect(await client.getCurrentAppInfoId('app1')).toBe('ai-live');
    expect(await client.getCurrentVersionId('app1')).toBe('v-live');
  });
  it('reads a pre-order version as the live one', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'v-preorder', attributes: { appStoreState: 'PREORDER_READY_FOR_SALE' } }],
        }),
      ),
    );
    expect(await client.getCurrentVersionId('app1')).toBe('v-preorder');
  });
  it('prefers the editable appInfo and version over the live ones', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'ai-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
              { id: 'ai-edit', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'v-live', attributes: { appStoreState: 'READY_FOR_SALE' } },
              { id: 'v-edit', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } },
            ],
          }),
        ),
      );
    expect(await client.getCurrentAppInfoId('app1')).toBe('ai-edit');
    expect(await client.getCurrentVersionId('app1')).toBe('v-edit');
  });
  it('lists version localizations, keeping only present non-empty fields', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'vl1',
              attributes: {
                locale: 'en-US',
                description: 'Copy',
                keywords: 'a,b',
                whatsNew: null,
                marketingUrl: '',
              },
            },
          ],
        }),
      ),
    );
    expect(await client.listVersionLocalizations('v-edit')).toEqual([
      { id: 'vl1', locale: 'en-US', fields: { description: 'Copy', keywords: 'a,b' } },
    ]);
  });
  it('reads a null privacyChoicesUrl as an unset account-deletion URL', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'ail-en', attributes: { locale: 'en-US', privacyChoicesUrl: null } },
            {
              id: 'ail-he',
              attributes: { locale: 'he', privacyChoicesUrl: 'https://example.com/delete' },
            },
          ],
        }),
      ),
    );
    expect(await client.listAccountDeletionUrls('ai-edit')).toEqual([
      { locale: 'en-US', url: '' },
      { locale: 'he', url: 'https://example.com/delete' },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/appInfos/ai-edit/appInfoLocalizations',
    );
  });
  it('omits null promotional text, product description and What to Test copy', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'cpl1', attributes: { locale: 'en-US', promotionalText: null } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'iapv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'loc1', attributes: { locale: 'en-US', name: 'Pro', description: null } }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'bbl1', attributes: { locale: 'en-US', whatsNew: null } }],
          }),
        ),
      );
    expect(await client.listCustomProductPageLocalizations('cppv1')).toEqual([
      { id: 'cpl1', locale: 'en-US' },
    ]);
    expect(await client.listInAppPurchaseLocalizations('iap1')).toEqual([
      { id: 'loc1', locale: 'en-US', name: 'Pro' },
    ]);
    expect(await client.listBetaBuildLocalizations('b1')).toEqual([
      { id: 'bbl1', locale: 'en-US' },
    ]);
  });
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
  it('POSTs a new version localization with the appStoreVersion relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'vl-new', attributes: {} } })),
    );
    await client.createVersionLocalization('v-edit', 'fr-FR', { description: 'Texte' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toContain('/appStoreVersionLocalizations');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toEqual({
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale: 'fr-FR', description: 'Texte' },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: 'v-edit' } } },
      },
    });
  });
  it('PATCHes only the changed fields on an app-level localization', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'ail1', attributes: {} } })),
    );
    await client.updateAppInfoLocalization('ail1', { name: 'New' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toContain('/appInfoLocalizations/ail1');
    expect(init.method).toBe('PATCH');
    expect(readRequestDocument(init)).toEqual({
      data: { type: 'appInfoLocalizations', id: 'ail1', attributes: { name: 'New' } },
    });
  });
});
describe('AppStoreConnectApi - app store versions', () => {
  it('reads the attached build id from the build relationship, and asks Apple for it', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'v-edit',
              attributes: { versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
              relationships: { build: { data: { type: 'builds', id: 'b-42' } } },
            },
            {
              id: 'v-empty',
              attributes: { versionString: '1.1.0', appStoreState: 'READY_FOR_SALE' },
              relationships: { build: { data: null } },
            },
          ],
        }),
      ),
    );
    const versions = await client.listAppStoreVersions('app1', 'IOS');
    const [requestUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(requestUrl)).toContain(
      'fields[appStoreVersions]=versionString,appStoreState,releaseType,build',
    );
    expect(expectArrayElement(versions, 0, 'version').attachedBuildId).toBe('b-42');
    expect(expectArrayElement(versions, 1, 'version').attachedBuildId).toBeUndefined();
  });

  it('reads the attached build number and processing state from the included build', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'v-edit',
              attributes: { versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
              relationships: { build: { data: { type: 'builds', id: 'b-42' } } },
            },
          ],
          included: [
            { type: 'builds', id: 'b-42', attributes: { version: '42', processingState: 'VALID' } },
          ],
        }),
      ),
    );
    const versions = await client.listAppStoreVersions('app1', 'IOS');
    expect(expectArrayElement(versions, 0, 'version')).toMatchObject({
      attachedBuildNumber: '42',
      attachedBuildProcessingState: 'VALID',
    });
  });

  it('keeps each attached build number when the versions span two pages', async () => {
    const page2Url =
      'https://api.appstoreconnect.apple.com/v1/apps/app1/appStoreVersions?cursor=page-2';
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'v-1',
                attributes: { versionString: '1.2.0', appStoreState: 'IN_REVIEW' },
                relationships: { build: { data: { type: 'builds', id: 'b-1' } } },
              },
            ],
            included: [
              {
                type: 'builds',
                id: 'b-1',
                attributes: { version: '42', processingState: 'PROCESSING' },
              },
            ],
            links: { next: page2Url },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'v-2',
                attributes: { versionString: '1.1.0', appStoreState: 'READY_FOR_SALE' },
                relationships: { build: { data: { type: 'builds', id: 'b-2' } } },
              },
            ],
            included: [
              {
                type: 'builds',
                id: 'b-2',
                attributes: { version: '41', processingState: 'VALID' },
              },
            ],
          }),
        ),
      );

    const versions = await client.listAppStoreVersions('app1', 'IOS');

    expect(versions.map((version) => version.attachedBuildNumber)).toEqual(['42', '41']);
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(page2Url);
  });

  it('asks Apple for the build of one marketing version, newest upload first', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));

    const storeBuild = await client.findBuildByVersion('app1', 9, '1.2.0');

    const [requestUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(requestUrl)).toContain(
      'filter[version]=9&filter[preReleaseVersion.version]=1.2.0&sort=-uploadedDate&limit=1',
    );
    expect(storeBuild).toBeNull();
  });
});
