import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expectArrayElement, expectDefined } from '@testkit/assertions.testkit.js';
import {
  documentValueAt,
  fakeResponse,
  makeKey,
  readRequestDocument,
} from '@/app-store-connect-api/test-helpers.js';
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
describe('AppStoreConnectClient - auth + request building', () => {
  it('resolves the app id then the latest build number', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      )
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'b', attributes: { version: '7' } }] })),
      );
    expect(await client.getLatestBuildNumber('com.example.hello')).toBe(7);
    expect(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]).toContain(
      '/builds?filter[app]=app1',
    );
  });
  it('reports zero builds when the app record is missing', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestBuildNumber('com.example.missing')).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('folds App Store + TestFlight versions and picks the highest numerically', async () => {
    // Route by URL, not call order: getLatestMarketingVersion fires the App Store + TestFlight
    // lookups through Promise.all, so which fetch lands first is a race (each awaits JWT signing).
    // Keying the mock on the path keeps the test deterministic regardless of dispatch order.
    fetchMock.mockImplementation((url: string | URL) => {
      const path = String(url);
      if (path.includes('/appStoreVersions'))
        return Promise.resolve(
          fakeResponse(
            200,
            JSON.stringify({ data: [{ id: 'v1', attributes: { versionString: '1.9.0' } }] }),
          ),
        );
      if (path.includes('/preReleaseVersions'))
        return Promise.resolve(
          fakeResponse(
            200,
            JSON.stringify({ data: [{ id: 'p1', attributes: { version: '1.10.0' } }] }),
          ),
        );
      return Promise.resolve(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      );
    });
    // 1.10.0 (TestFlight) beats 1.9.0 (App Store) - a lexical sort would wrongly pick 1.9.0.
    expect(await client.getLatestMarketingVersion('com.example.hello')).toBe('1.10.0');
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((path) => path.includes('/apps/app1/appStoreVersions'))).toBe(true);
    expect(urls.some((path) => path.includes('/apps/app1/preReleaseVersions'))).toBe(true);
  });
  it('returns null for marketing version when the app record is missing', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestMarketingVersion('com.example.missing')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('returns null when the app exists but has no versions yet', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      )
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestMarketingVersion('com.example.hello')).toBeNull();
  });
});
describe('AppStoreConnectClient - build uploads', () => {
  it('opens a build upload for the app, version, build number and platform', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(201, JSON.stringify({ data: { id: 'upload-1', type: 'buildUploads' } })),
    );
    await expect(client.createBuildUpload('app-1', '1.4.0', 42, 'IOS')).resolves.toBe('upload-1');
    const [url, requestInit] = expectArrayElement(fetchMock.mock.calls, 0, 'create call');
    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/buildUploads');
    expect(requestInit.method).toBe('POST');
    expect(readRequestDocument(requestInit)).toEqual({
      data: {
        type: 'buildUploads',
        attributes: { cfBundleShortVersionString: '1.4.0', cfBundleVersion: '42', platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: 'app-1' } } },
      },
    });
  });
  it('fails clearly when the file is shorter than a part Apple asks for', async () => {
    const ipaPath = fileURLToPath(import.meta.url);
    const ipaBytes = readFileSync(ipaPath);
    const pastTheEnd = ipaBytes.byteLength - 2;
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: pastTheEnd, length: 5 },
    ];
    fetchMock.mockImplementation((url: string, requestInit: RequestInit) => {
      if (url.startsWith('https://upload.example/')) return Promise.resolve(fakeResponse(200, ''));
      if (requestInit.method === 'POST') {
        const reservation = { data: { id: 'file-1', attributes: { uploadOperations } } };
        return Promise.resolve(fakeResponse(201, JSON.stringify(reservation)));
      }
      return Promise.resolve(
        fakeResponse(200, JSON.stringify({ data: { id: 'file-1', attributes: {} } })),
      );
    });
    await expect(client.uploadBuildFile('upload-1', 'App.ipa', ipaPath)).rejects.toThrow(
      `Read 2 of 5 bytes at offset ${pastTheEnd} from ${ipaPath}; the file changed during the upload.`,
    );
    const partCalls = fetchMock.mock.calls.filter(([url]) => url.startsWith('https://upload.'));
    expect(partCalls).toEqual([]);
  });
  it('reserves the IPA, PUTs each part from its own byte range, then marks it uploaded', async () => {
    const ipaPath = fileURLToPath(import.meta.url);
    const ipaBytes = readFileSync(ipaPath);
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: 0, length: 5 },
      { method: 'PUT', url: 'https://upload.example/part-1', offset: 5, length: 7 },
    ];
    fetchMock.mockImplementation((url: string, requestInit: RequestInit) => {
      if (url.startsWith('https://upload.example/')) return Promise.resolve(fakeResponse(200, ''));
      if (requestInit.method === 'POST') {
        const reservation = { data: { id: 'file-1', attributes: { uploadOperations } } };
        return Promise.resolve(fakeResponse(201, JSON.stringify(reservation)));
      }
      return Promise.resolve(
        fakeResponse(200, JSON.stringify({ data: { id: 'file-1', attributes: {} } })),
      );
    });
    await client.uploadBuildFile('upload-1', 'App.ipa', ipaPath);
    const [reserveUrl, reserveInit] = expectArrayElement(fetchMock.mock.calls, 0, 'reserve call');
    expect(reserveUrl).toBe('https://api.appstoreconnect.apple.com/v1/buildUploadFiles');
    expect(documentValueAt(readRequestDocument(reserveInit), ['data', 'attributes'])).toEqual({
      fileName: 'App.ipa',
      fileSize: ipaBytes.byteLength,
      assetType: 'ASSET',
      uti: 'com.apple.ipa',
    });
    expect(
      documentValueAt(readRequestDocument(reserveInit), ['data', 'relationships', 'buildUpload']),
    ).toEqual({ data: { type: 'buildUploads', id: 'upload-1' } });
    const partCalls = fetchMock.mock.calls.slice(1, 3);
    const firstPartCall = partCalls.find(([url]) => url === 'https://upload.example/part-0');
    const [, firstPartInit] = expectDefined(firstPartCall, 'part 0');
    expect(firstPartInit.body).toEqual(ipaBytes.subarray(0, 5));
    const secondPartCall = partCalls.find(([url]) => url === 'https://upload.example/part-1');
    const [, secondPartInit] = expectDefined(secondPartCall, 'part 1');
    expect(secondPartInit.body).toEqual(ipaBytes.subarray(5, 12));
    const [commitUrl, commitInit] = expectArrayElement(fetchMock.mock.calls, 3, 'commit call');
    expect(commitUrl).toBe('https://api.appstoreconnect.apple.com/v1/buildUploadFiles/file-1');
    expect(commitInit.method).toBe('PATCH');
    expect(readRequestDocument(commitInit)).toEqual({
      data: { type: 'buildUploadFiles', id: 'file-1', attributes: { uploaded: true } },
    });
  });
  it('reads the upload state with the delivery errors of its IPA', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(
        200,
        JSON.stringify({
          data: {
            id: 'upload-1',
            type: 'buildUploads',
            attributes: {
              state: {
                state: 'FAILED',
                errors: [{ code: '90186', description: 'Invalid Pre-Release Train.' }],
              },
            },
          },
          included: [
            {
              id: 'file-1',
              type: 'buildUploadFiles',
              attributes: {
                assetDeliveryState: {
                  state: 'FAILED',
                  errors: [{ code: '90062', description: 'Version must be higher.' }],
                },
              },
            },
          ],
        }),
      ),
    );
    await expect(client.getBuildUploadStatus('upload-1')).resolves.toEqual({
      state: 'FAILED',
      fileState: 'FAILED',
      errors: [
        { code: '90186', description: 'Invalid Pre-Release Train.' },
        { code: '90062', description: 'Version must be higher.' },
      ],
    });
    const [url] = expectArrayElement(fetchMock.mock.calls, 0, 'status call');
    expect(url).toBe(
      'https://api.appstoreconnect.apple.com/v1/buildUploads/upload-1?include=assetFile&fields[buildUploads]=state,assetFile&fields[buildUploadFiles]=assetDeliveryState',
    );
  });
  it('treats an upload with no state yet as awaiting upload', async () => {
    fetchMock.mockResolvedValue(
      fakeResponse(200, JSON.stringify({ data: { id: 'upload-1', type: 'buildUploads' } })),
    );
    await expect(client.getBuildUploadStatus('upload-1')).resolves.toEqual({
      state: 'AWAITING_UPLOAD',
      fileState: '',
      errors: [],
    });
  });
});
describe('AppStoreConnectClient - export compliance', () => {
  it("resolves a build's id and export-compliance answer by build number", async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'build9', attributes: { usesNonExemptEncryption: false } }],
          }),
        ),
      );
    expect(await client.findBuild('com.example.hello', 9)).toEqual({
      id: 'build9',
      usesNonExemptEncryption: false,
    });
    expect(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]).toContain(
      '/builds?filter[app]=app1&filter[version]=9',
    );
  });
  it("reports null usesNonExemptEncryption when the build hasn't answered yet", async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      )
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'build9', attributes: {} }] })),
      );
    expect(await client.findBuild('com.example.hello', 9)).toEqual({
      id: 'build9',
      usesNonExemptEncryption: null,
    });
  });
  it('returns null for findBuild when the app record is missing', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.findBuild('com.example.missing', 9)).toBeNull();
  });
  it("PATCHes the build's usesNonExemptEncryption attribute", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: { id: 'build9', attributes: {} } })),
    );
    await client.setBuildUsesNonExemptEncryption('build9', false);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toContain('/builds/build9');
    expect(init.method).toBe('PATCH');
    expect(readRequestDocument(init)).toEqual({
      data: { type: 'builds', id: 'build9', attributes: { usesNonExemptEncryption: false } },
    });
  });
  it("lists an app's encryption declarations with their review state", async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'decl1', attributes: { appEncryptionDeclarationState: 'APPROVED' } }],
          }),
        ),
      );
    expect(await client.listEncryptionDeclarations('com.example.hello')).toEqual([
      { id: 'decl1', state: 'APPROVED' },
    ]);
  });
  it('links a build to a declaration via the relationships endpoint', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.linkBuildToDeclaration('decl1', 'build9');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toContain('/appEncryptionDeclarations/decl1/relationships/builds');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toEqual({ data: [{ type: 'builds', id: 'build9' }] });
  });
});
describe('AppStoreConnectClient - App Store release lifecycle', () => {
  it('lists recent builds with processing state and expiry, newest upload first', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'b1', attributes: { version: '42', processingState: 'VALID', expired: false } },
          ],
        }),
      ),
    );
    const builds = await client.listBuilds('app1');
    expect(builds[0]).toEqual({
      id: 'b1',
      version: '42',
      processingState: 'VALID',
      expired: false,
    });
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/builds?filter[app]=app1&sort=-uploadedDate',
    );
  });
  it("reads each build's marketing version from its included pre-release version", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'b591',
              attributes: { version: '591', processingState: 'VALID', expired: false },
              relationships: {
                preReleaseVersion: { data: { type: 'preReleaseVersions', id: 'p1' } },
              },
            },
          ],
          included: [{ type: 'preReleaseVersions', id: 'p1', attributes: { version: '6.11.77' } }],
        }),
      ),
    );
    const promotedBuild = await client.findBuildByVersion('app1', 591);
    expect(promotedBuild).toEqual({
      id: 'b591',
      version: '591',
      processingState: 'VALID',
      expired: false,
      marketingVersion: '6.11.77',
    });
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      'filter[version]=591&sort=-uploadedDate&limit=1&fields[builds]=version,processingState,uploadedDate,expired,preReleaseVersion&include=preReleaseVersion',
    );
  });
  it('declares export compliance with a PATCH to the build', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.setBuildUsesNonExemptEncryption('b1', false);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/builds/b1');
    expect(readRequestDocument(init)).toMatchObject({
      data: { type: 'builds', id: 'b1', attributes: { usesNonExemptEncryption: false } },
    });
  });
  it('attaches a build via the relationships/build PATCH', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.selectBuildForVersion('v1', 'b1');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appStoreVersions/v1/relationships/build');
    expect(readRequestDocument(init)).toEqual({ data: { type: 'builds', id: 'b1' } });
  });
});
describe('AppStoreConnectClient - app store versions', () => {
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
