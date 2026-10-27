import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import type { AscKey } from '../core/types/credentials.js';
import { expectArrayElement, expectDefined } from '../testkit/assertions.testkit.js';
import {
  AppStoreConnectClient,
  clockSkewHint,
  describeErrors,
  parseErrorCodes,
} from './ascClient.js';
/** A real P-256 PKCS#8 key so `jose` can actually sign - the client mints a genuine ES256 JWT. */
const makeKey = (): AscKey => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    keyId: 'KEY123',
    issuerId: 'issuer-uuid',
    p8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};
const fakeResponse = (
  status: number,
  responseText: string,
  headers: Record<string, string> = {},
): Response => {
  let responseBody: string | null = responseText;
  if (status === 204) responseBody = null;
  return new Response(responseBody, { status, headers });
};
const fakeBinaryResponse = (status: number, bytes: string, errorResponseText = ''): Response => {
  let responseBody = errorResponseText;
  if (status >= 200 && status < 300) responseBody = bytes;
  return new Response(responseBody, { status });
};
const readRequestDocument = (requestInit: RequestInit): unknown => {
  if (typeof requestInit.body !== 'string') throw new Error('expected a JSON request body');
  return Schema.decodeUnknownSync(Schema.parseJson())(requestInit.body);
};
const requestHeaders = (requestInit: RequestInit): Headers => new Headers(requestInit.headers);
const documentValueAt = (document: unknown, path: readonly (number | string)[]): unknown => {
  let currentValue = document;
  for (const pathPart of path) {
    if (typeof pathPart === 'number') {
      if (!Array.isArray(currentValue)) throw new Error('expected a JSON array');
      currentValue = currentValue[pathPart];
      continue;
    }
    if (typeof currentValue !== 'object') throw new Error('expected a JSON object');
    if (currentValue === null) throw new Error('expected a JSON object');
    currentValue = Reflect.get(currentValue, pathPart);
  }
  return currentValue;
};
const numberClaim = (claims: Record<string, unknown>, claimName: string): number => {
  const claim = claims[claimName];
  if (typeof claim !== 'number') throw new Error(`expected numeric JWT claim ${claimName}`);
  return claim;
};
const JwtPartSchema = Schema.parseJson(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);
const decodeJwt = (
  token: string,
): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} => {
  const [header, jwtClaims] = token.split('.');
  return {
    header: Schema.decodeUnknownSync(JwtPartSchema)(
      Buffer.from(expectDefined(header, 'JWT header'), 'base64url').toString(),
    ),
    payload: Schema.decodeUnknownSync(JwtPartSchema)(
      Buffer.from(expectDefined(jwtClaims, 'JWT payload'), 'base64url').toString(),
    ),
  };
};
const fetchMock = vi.fn();
let client: AppStoreConnectClient;
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = new AppStoreConnectClient(makeKey());
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('AppStoreConnectClient - auth + request building', () => {
  it('signs each request with a short-lived ES256 JWT bound to the key', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: '42', attributes: {} }] })),
    );
    const id = await client.getAppId('com.example.hello');
    expect(id).toBe('42');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/apps?filter[bundleId]=com.example.hello&limit=1');
    const auth = expectDefined(requestHeaders(init).get('Authorization'), 'authorization header');
    expect(auth).toMatch(/^Bearer /);
    const { header, payload: jwtClaims } = decodeJwt(auth.slice('Bearer '.length));
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(jwtClaims['iss']).toBe('issuer-uuid');
    expect(jwtClaims['aud']).toBe('appstoreconnect-v1');
    // Apple rejects tokens older than 20 minutes; the client stays at 19.
    expect(numberClaim(jwtClaims, 'exp') - numberClaim(jwtClaims, 'iat')).toBe(19 * 60);
  });
  it('returns null when no app record exists for the bundle id', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getAppId('com.example.missing')).toBeNull();
  });
  it('authenticates only with a Bearer API-key JWT - never a password or session cookie (the EAS 2FA dodge)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    await client.assertReady();
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const headers = requestHeaders(init);
    // Bearer <JWT> (JWTs start `eyJ`) - Apple-ID 2FA can't enter the loop, so EAS's 2FA failures can't either.
    expect(headers.get('Authorization')).toMatch(/^Bearer eyJ/);
    expect(headers.get('Cookie')).toBeNull();
  });
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
  it("surfaces Apple's error detail (not a bare status) on failure", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        403,
        JSON.stringify({
          errors: [
            {
              status: '403',
              code: 'X',
              title: 'Forbidden',
              detail: 'A required agreement is missing.',
            },
          ],
        }),
      ),
    );
    await expect(client.assertReady()).rejects.toThrow(/403.*A required agreement is missing\./);
  });
  it('checkRequiredAgreements: true on a clean read, false on the agreements 403, rethrows otherwise', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.checkRequiredAgreements()).toBe(true);
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        403,
        JSON.stringify({
          errors: [
            {
              status: '403',
              code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED',
              title: 'Forbidden',
            },
          ],
        }),
      ),
    );
    expect(await client.checkRequiredAgreements()).toBe(false);
    // A different 403 (e.g. a permissions problem) is a real failure, not "agreements fine" - it rethrows.
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        403,
        JSON.stringify({ errors: [{ status: '403', code: 'FORBIDDEN.ACCESS_DENIED' }] }),
      ),
    );
    await expect(client.checkRequiredAgreements()).rejects.toThrow(/403/);
  });
  it('POSTs a correctly-shaped bundle-id registration with a JSON content type', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'b1', attributes: { identifier: 'com.x', seedId: 'SEED' } } }),
      ),
    );
    const created = await client.createBundleId('com.x', 'X App');
    expect(created).toEqual({ id: 'b1', identifier: 'com.x', seedId: 'SEED' });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(requestHeaders(init).get('Content-Type')).toBe('application/json');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'bundleIds',
        attributes: { identifier: 'com.x', name: 'X App', platform: 'IOS' },
      },
    });
  });
  it('registers a macOS bundle id under MAC_OS when the platform is passed', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'b2', attributes: { identifier: 'com.x.mac', seedId: 'SEED' } },
        }),
      ),
    );
    await client.createBundleId('com.x.mac', 'X Mac', 'MAC_OS');
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
    ).toMatchObject({
      data: { type: 'bundleIds', attributes: { platform: 'MAC_OS' } },
    });
  });
  it("creates an App Store profile with the platform's profile type (tvOS)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'pf2', attributes: { name: 'TV', uuid: 'U2', profileContent: 'B64' } },
        }),
      ),
    );
    await client.createAppStoreProfile('TV', 'bundle1', 'cert1', 'TVOS_APP_STORE');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'profileType'])).toBe(
      'TVOS_APP_STORE',
    );
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'bundleId', 'data'])).toEqual(
      {
        type: 'bundleIds',
        id: 'bundle1',
      },
    );
  });
  it("resolves the Team ID from the first bundle id's seedId", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'b1', attributes: { seedId: 'ABCDE12345' } }] }),
      ),
    );
    expect(await client.resolveTeamId()).toBe('ABCDE12345');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/bundleIds?limit=1&fields[bundleIds]=seedId',
    );
  });
  it('returns null for the Team ID when the account has no bundle ids yet', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.resolveTeamId()).toBeNull();
  });
  it('lists accessible app names, dropping any without a name', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { attributes: { name: 'Mapleleaf' } },
            { attributes: {} },
            { attributes: { name: 'SampleApp' } },
          ],
        }),
      ),
    );
    expect(await client.listAppNames()).toEqual(['Mapleleaf', 'SampleApp']);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps?fields[apps]=name',
    );
  });
  it('treats a 204 as success with no body (profile deletion)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await expect(client.deleteProfile('p1')).resolves.toBeUndefined();
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('DELETE');
    expect(url).toContain('/profiles/p1');
    expect(requestHeaders(init).get('Content-Type')).toBeNull();
  });
});
describe('AppStoreConnectClient - token reuse + parallel asset upload', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('signs once per 15 minutes instead of once per request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    fetchMock.mockImplementation(() =>
      Promise.resolve(fakeResponse(200, JSON.stringify({ data: [] }))),
    );
    await client.getAppId('com.example.one');
    await client.getAppId('com.example.two');
    vi.setSystemTime(new Date('2030-01-01T00:16:00.000Z'));
    await client.getAppId('com.example.three');
    const authorizations = fetchMock.mock.calls.map(([, requestInit]) =>
      requestHeaders(requestInit).get('Authorization'),
    );
    expect(authorizations[1]).toBe(authorizations[0]);
    expect(authorizations[2]).not.toBe(authorizations[0]);
  });
  it('uploads asset parts a few at a time', async () => {
    let inFlightUploads = 0;
    let peakInFlightUploads = 0;
    const uploadOperations = Array.from({ length: 6 }, (_, partIndex) => ({
      method: 'PUT',
      url: `https://upload.example/part-${partIndex}`,
      offset: partIndex,
      length: 1,
      requestHeaders: [],
    }));
    fetchMock.mockImplementation(async (url: string, requestInit: RequestInit) => {
      if (url.startsWith('https://upload.example/')) {
        inFlightUploads += 1;
        peakInFlightUploads = Math.max(peakInFlightUploads, inFlightUploads);
        await new Promise((resumeUpload) => setTimeout(resumeUpload, 20));
        inFlightUploads -= 1;
        return fakeResponse(200, '');
      }
      if (requestInit.method === 'POST') {
        const reservation = { data: { id: 'shot-1', attributes: { uploadOperations } } };
        return fakeResponse(201, JSON.stringify(reservation));
      }
      return fakeResponse(200, JSON.stringify({ data: { id: 'shot-1', attributes: {} } }));
    });
    await client.uploadScreenshot('set-1', 'shot.png', fileURLToPath(import.meta.url));
    const partUploads = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('https://upload.example/'),
    );
    expect(partUploads).toHaveLength(6);
    expect(peakInFlightUploads).toBeGreaterThan(1);
    expect(peakInFlightUploads).toBeLessThanOrEqual(4);
  });
  it('retries a part after a dropped connection', async () => {
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: 0, length: 1 },
    ];
    let partAttempts = 0;
    fetchMock.mockImplementation((url: string, requestInit: RequestInit) => {
      if (url.startsWith('https://upload.example/')) {
        partAttempts += 1;
        if (partAttempts === 1) return Promise.reject(new TypeError('fetch failed'));
        return Promise.resolve(fakeResponse(200, ''));
      }
      if (requestInit.method === 'POST') {
        const reservation = { data: { id: 'shot-1', attributes: { uploadOperations } } };
        return Promise.resolve(fakeResponse(201, JSON.stringify(reservation)));
      }
      return Promise.resolve(
        fakeResponse(200, JSON.stringify({ data: { id: 'shot-1', attributes: {} } })),
      );
    });
    await client.uploadScreenshot('set-1', 'shot.png', fileURLToPath(import.meta.url));
    expect(partAttempts).toBe(2);
  });
  it('lets every part in a batch finish before reporting a failed part', async () => {
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: 0, length: 1 },
      { method: 'PUT', url: 'https://upload.example/part-1', offset: 1, length: 1 },
    ];
    let slowPartFinished = false;
    fetchMock.mockImplementation(async (url: string, requestInit: RequestInit) => {
      if (url === 'https://upload.example/part-0') return fakeResponse(400, '');
      if (url === 'https://upload.example/part-1') {
        await new Promise((resumeUpload) => setTimeout(resumeUpload, 10));
        slowPartFinished = true;
        return fakeResponse(200, '');
      }
      if (requestInit.method === 'POST') {
        const reservation = { data: { id: 'shot-1', attributes: { uploadOperations } } };
        return fakeResponse(201, JSON.stringify(reservation));
      }
      return fakeResponse(200, JSON.stringify({ data: { id: 'shot-1', attributes: {} } }));
    });
    await expect(
      client.uploadScreenshot('set-1', 'shot.png', fileURLToPath(import.meta.url)),
    ).rejects.toThrow(/asset upload chunk failed \(400\)/);
    expect(slowPartFinished).toBe(true);
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
describe('AppStoreConnectClient - pagination (links.next)', () => {
  it('follows the absolute links.next URL verbatim, without the /v1/v1 double-prefix', async () => {
    const page2Url = 'https://api.appstoreconnect.apple.com/v1/devices?cursor=PAGE2';
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [{ id: 'd1', attributes: { udid: 'AAAA', name: 'Phone A', status: 'ENABLED' } }],
            links: { next: page2Url },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ data: [{ id: 'd2', attributes: { udid: 'BBBB', name: 'Phone B' } }] }),
        ),
      );
    const devices = await client.listDevices();
    // Both pages folded into one list - reading only page 1 would silently truncate the team.
    expect(devices.map((d) => d.udid)).toEqual(['AAAA', 'BBBB']);
    // The crux of the #3764 regression: the second request hits the absolute next URL exactly,
    // NOT https://.../v1/v1/devices?... (which is what re-prefixing BASE_URL would produce).
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(page2Url);
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).not.toContain(
      '/v1/v1',
    );
  });
  it('stops after one page when there is no links.next', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'd1', attributes: { udid: 'AAAA', name: 'Phone A' } }] }),
      ),
    );
    expect(await client.listDevices()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe('AppStoreConnectClient - device registration + ad-hoc profile', () => {
  it('finds a registered device by UDID case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'd1', attributes: { udid: 'abcd1234', name: 'Phone' } }] }),
      ),
    );
    const found = await client.findDeviceByUdid('ABCD1234');
    expect(found?.id).toBe('d1');
  });
  it('POSTs a correctly-shaped device registration', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'd9', attributes: { udid: 'UDID9', name: "Dana's iPhone" } },
        }),
      ),
    );
    const created = await client.registerDevice('UDID9', "Dana's iPhone");
    expect(created).toMatchObject({ id: 'd9', udid: 'UDID9', name: "Dana's iPhone" });
    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'devices',
        attributes: { udid: 'UDID9', name: "Dana's iPhone", platform: 'IOS' },
      },
    });
  });
  it('creates an ad-hoc profile linking the bundle, cert, and every listed device', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'pf1', attributes: { name: 'AdHoc', uuid: 'U', profileContent: 'B64' } },
        }),
      ),
    );
    const profile = await client.createAdHocProfile('AdHoc', 'bundle1', 'cert1', ['d1', 'd2']);
    expect(profile).toEqual({ id: 'pf1', name: 'AdHoc', uuid: 'U', profileContent: 'B64' });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'profileType'])).toBe(
      'IOS_APP_ADHOC',
    );
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'devices', 'data'])).toEqual([
      { type: 'devices', id: 'd1' },
      { type: 'devices', id: 'd2' },
    ]);
  });
  it('creates a tvOS ad-hoc profile with the TVOS_APP_ADHOC type when passed', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'pf3', attributes: { name: 'TVAdHoc', uuid: 'U3', profileContent: 'B64' } },
        }),
      ),
    );
    await client.createAdHocProfile('TVAdHoc', 'bundle1', 'cert1', ['d1'], 'TVOS_APP_ADHOC');
    expect(
      documentValueAt(
        readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
        ['data', 'attributes', 'profileType'],
      ),
    ).toBe('TVOS_APP_ADHOC');
  });
});
describe('AppStoreConnectClient - transient-failure retry', () => {
  it('retries a 429 then succeeds, surfacing the eventual result', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(429, JSON.stringify({ errors: [{ title: 'Rate limited' }] })),
      )
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: '42', attributes: {} }] })),
      );
    expect(await client.getAppId('com.example.hello')).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does NOT retry a 4xx (a permanent failure surfaces immediately)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(403, JSON.stringify({ errors: [{ detail: 'Forbidden' }] })),
    );
    await expect(client.assertReady()).rejects.toThrow(/403.*Forbidden/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('retries a read after a dropped connection', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: '42', attributes: {} }] })),
      );
    expect(await client.getAppId('com.example.hello')).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does NOT repeat a write after a dropped connection (it may already have landed)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.registerDevice('UDID9', "Dana's iPhone")).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
describe('AppStoreConnectClient - product catalog', () => {
  it('enables a capability with the bundleId relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'cap1', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } },
        }),
      ),
    );
    const created = await client.enableCapability('bundle1', 'PUSH_NOTIFICATIONS');
    expect(created).toEqual({ id: 'cap1', capabilityType: 'PUSH_NOTIFICATIONS' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/bundleIdCapabilities');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
        relationships: { bundleId: { data: { type: 'bundleIds', id: 'bundle1' } } },
      },
    });
  });
  it('creates an in-app purchase against the /v2 endpoint with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'iap1',
            attributes: {
              productId: 'com.x.coins',
              name: 'Coins',
              inAppPurchaseType: 'CONSUMABLE',
            },
          },
        }),
      ),
    );
    const created = await client.createInAppPurchase('app1', {
      productId: 'com.x.coins',
      name: 'Coins',
      inAppPurchaseType: 'CONSUMABLE',
    });
    expect(created).toMatchObject({
      id: 'iap1',
      productId: 'com.x.coins',
      inAppPurchaseType: 'CONSUMABLE',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(String(url)).toBe('https://api.appstoreconnect.apple.com/v2/inAppPurchases');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'inAppPurchases',
        attributes: { productId: 'com.x.coins', name: 'Coins', inAppPurchaseType: 'CONSUMABLE' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  });
  it('creates a version experiment and lists its treatments on the v2 paths', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(201, JSON.stringify({ data: { id: 'exp1', attributes: {} } })),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ data: [{ id: 'treat1', attributes: { name: 'Colorful' } }] }),
        ),
      );
    await client.createVersionExperiment('app1', {
      name: 'Screenshots',
      platform: 'IOS',
      trafficProportion: 50,
    });
    const treatments = await client.listExperimentTreatments('exp1');
    expect(treatments).toEqual([{ id: 'treat1', name: 'Colorful' }]);
    const [createUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'create call');
    expect(String(createUrl)).toBe(
      'https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments',
    );
    const [listUrl] = expectArrayElement(fetchMock.mock.calls, 1, 'list call');
    expect(String(listUrl)).toContain(
      'https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments/exp1/appStoreVersionExperimentTreatments?',
    );
  });
  it('creates a subscription with its billing period and group relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'sub1', attributes: { productId: 'com.x.pro', name: 'Pro' } },
        }),
      ),
    );
    await client.createSubscription('group1', {
      productId: 'com.x.pro',
      name: 'Pro Monthly',
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('subscriptions');
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toMatchObject({
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'group', 'data'])).toEqual({
      type: 'subscriptionGroups',
      id: 'group1',
    });
  });
  it('creates a subscription localization through the shared helper with the right parent relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'loc1', attributes: { locale: 'en-US', name: 'Pro' } } }),
      ),
    );
    await client.createSubscriptionLocalization('sub1', {
      locale: 'en-US',
      name: 'Pro',
      description: 'All features',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/subscriptionLocalizations');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'subscriptionLocalizations',
        attributes: { locale: 'en-US', name: 'Pro', description: 'All features' },
        relationships: { subscription: { data: { type: 'subscriptions', id: 'sub1' } } },
      },
    });
  });
  it('omits description on a group localization (groups carry a name only)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'gl1', attributes: { locale: 'en-US', name: 'Pro Tiers' } } }),
      ),
    );
    await client.createSubscriptionGroupLocalization('group1', {
      locale: 'en-US',
      name: 'Pro Tiers',
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toEqual({
      locale: 'en-US',
      name: 'Pro Tiers',
    });
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).not.toHaveProperty(
      'description',
    );
  });
  it('resolves a subscription price point by exact customer price', async () => {
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
    const point = await client.findSubscriptionPricePoint('sub1', 'USA', 9.99);
    expect(point).toEqual({ id: 'pp2', customerPrice: '9.99', territory: 'USA' });
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/subscriptions/sub1/pricePoints?filter[territory]=USA',
    );
  });
  it('returns null when no price point matches the requested amount', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } }],
        }),
      ),
    );
    expect(await client.findSubscriptionPricePoint('sub1', 'USA', 9.99)).toBeNull();
  });
  it('sets a subscription price by linking the resolved price point', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'spr1', attributes: {} } })),
    );
    await client.createSubscriptionPrice('sub1', 'pp2');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('subscriptionPrices');
    expect(documentValueAt(requestDocument, ['data', 'relationships'])).toMatchObject({
      subscription: { data: { type: 'subscriptions', id: 'sub1' } },
      subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: 'pp2' } },
    });
  });
  it('builds an IAP price schedule with a base territory and a temp-id included price', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'sched1', attributes: {} } })),
    );
    await client.createInAppPurchasePriceSchedule('iap1', 'USA', 'pp9');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'type'])).toBe('inAppPurchasePriceSchedules');
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
      type: 'inAppPurchasePrices',
      id: tempId,
      relationships: {
        inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: 'pp9' } },
      },
    });
  });
  it('reports an unpriced in-app purchase when the price-schedule relationship is empty/404', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.inAppPurchaseHasPrice('iap1')).toBe(false);
    // Must hit the /v2/inAppPurchases/{id}/... relationship path - the bare /v1 inAppPurchasesV2/{id} form 404s for real.
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/iap1/iapPriceSchedule',
    );
  });
  it('reads IAP localizations from the /v2 relationship path (not the bare inAppPurchasesV2 resource)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'loc1', attributes: { locale: 'en-US', name: 'Lifetime' } }],
        }),
      ),
    );
    const locs = await client.listInAppPurchaseLocalizations('iap1');
    expect(locs).toEqual([{ id: 'loc1', locale: 'en-US', name: 'Lifetime' }]);
    expect(String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0])).toBe(
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/iap1/inAppPurchaseLocalizations?limit=200',
    );
  });
  it('lists bundle id capabilities without a limit param (the related endpoint rejects it)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'cap1', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } }],
        }),
      ),
    );
    const caps = await client.listBundleIdCapabilities('bundle1');
    expect(caps).toEqual([{ id: 'cap1', capabilityType: 'PUSH_NOTIFICATIONS' }]);
    const url = String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]);
    expect(url).toContain('/bundleIds/bundle1/bundleIdCapabilities');
    expect(url).not.toContain('limit');
    expect(url).toContain('fields[bundleIdCapabilities]=capabilityType,settings');
  });
  const OFFER_PRICES = [
    { territory: 'ISR', pricePointId: 'pp-isr' },
    { territory: 'USA', pricePointId: 'pp-usa' },
  ];
  const expectInlinePriceIds = (requestInit: RequestInit) => {
    const requestDocument = readRequestDocument(requestInit);
    for (const [index, localId] of ['${price-0}', '${price-1}'].entries()) {
      expect(
        documentValueAt(requestDocument, ['data', 'relationships', 'prices', 'data', index, 'id']),
      ).toBe(localId);
      expect(documentValueAt(requestDocument, ['included', index, 'id'])).toBe(localId);
    }
  };
  it('creates an offer-code campaign with ${local-id} inline price ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'offer-1', attributes: {} } })),
    );
    await client.createSubscriptionOfferCode({
      subscriptionId: 'sub-1',
      name: 'retention-half-price',
      customerEligibilities: ['EXISTING'],
      offerEligibility: 'REPLACE_INTRO_OFFERS',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 3,
      prices: OFFER_PRICES,
    });
    expectInlinePriceIds(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]);
  });
  it('creates a promotional offer with ${local-id} inline price ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'promo-1', attributes: {} } })),
    );
    await client.createPromotionalOffer({
      subscriptionId: 'sub-1',
      name: 'Come back',
      offerCode: 'come_back',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 1,
      prices: OFFER_PRICES,
    });
    expectInlinePriceIds(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]);
  });
  it('creates a win-back offer with ${local-id} inline price ids', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'win-back-1', attributes: {} } })),
    );
    await client.createWinBackOffer({
      subscriptionId: 'sub-1',
      offerId: 'win_back',
      referenceName: 'Win back',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 1,
      eligiblePaidMonths: 2,
      monthsSinceLastSubscribed: { min: 1, max: 6 },
      startDate: '2026-11-01',
      priority: 'NORMAL',
      prices: OFFER_PRICES,
    });
    expectInlinePriceIds(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]);
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
describe('AppStoreConnectClient - listing localizations', () => {
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
describe('AppStoreConnectClient - TestFlight beta groups + testers', () => {
  it('creates an external beta group with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({ data: { id: 'bg1', attributes: { name: 'External Testers' } } }),
      ),
    );
    const group = await client.createBetaGroup('app1', 'External Testers');
    expect(group).toEqual({ id: 'bg1', name: 'External Testers' });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaGroups');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'betaGroups',
        attributes: { name: 'External Testers' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  });
  it('lists beta groups, dropping a nameless row and surfacing internal/public-link', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'bg1',
              attributes: { name: 'External', isInternalGroup: false, publicLink: 'https://tf/x' },
            },
            { id: 'bg2', attributes: { name: 'Team', isInternalGroup: true } },
            { id: 'bg3', attributes: {} },
          ],
        }),
      ),
    );
    expect(await client.listBetaGroups('app1')).toEqual([
      { id: 'bg1', name: 'External', isInternal: false, publicLink: 'https://tf/x' },
      { id: 'bg2', name: 'Team', isInternal: true },
    ]);
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app1/betaGroups',
    );
  });
  it('finds a beta group by name case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({ data: [{ id: 'bg1', attributes: { name: 'External Testers' } }] }),
      ),
    );
    expect((await client.findBetaGroupByName('app1', 'external testers'))?.id).toBe('bg1');
  });
  it('creates a tester with the betaGroups relationship (the invite-sending path)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 't1', attributes: { email: 'a@x.com', firstName: 'Dana', state: 'INVITED' } },
        }),
      ),
    );
    const tester = await client.createBetaTester('bg1', { email: 'a@x.com', firstName: 'Dana' });
    expect(tester).toMatchObject({
      id: 't1',
      email: 'a@x.com',
      firstName: 'Dana',
      state: 'INVITED',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaTesters');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'betaTesters',
        attributes: { email: 'a@x.com', firstName: 'Dana' },
        relationships: { betaGroups: { data: [{ type: 'betaGroups', id: 'bg1' }] } },
      },
    });
  });
  it('keeps a public-link tester with a null email and omits null names', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 't-public',
              attributes: { email: null, firstName: null, lastName: null, state: 'INSTALLED' },
            },
            {
              id: 't-invited',
              attributes: { email: 'a@x.com', firstName: null, lastName: null, state: 'INVITED' },
            },
          ],
        }),
      ),
    );
    expect(await client.listBetaTestersInGroup('bg1')).toEqual([
      { id: 't-public', email: '', state: 'INSTALLED' },
      { id: 't-invited', email: 'a@x.com', state: 'INVITED' },
    ]);
  });
  it('finds a tester by email via the filter, matching case-insensitively', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ data: [{ id: 't1', attributes: { email: 'A@X.com' } }] })),
    );
    expect((await client.findBetaTesterByEmail('a@x.com'))?.id).toBe('t1');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/betaTesters?filter[email]=a%40x.com',
    );
  });
  it('bulk-adds existing testers to a group via the relationship endpoint', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.addTestersToGroup('bg1', ['t1', 't2']);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaGroups/bg1/relationships/betaTesters');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toEqual({
      data: [
        { type: 'betaTesters', id: 't1' },
        { type: 'betaTesters', id: 't2' },
      ],
    });
  });
  it('removes testers from a group with a DELETE carrying the relationship body', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.removeTestersFromGroup('bg1', ['t1']);
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/betaGroups/bg1/relationships/betaTesters');
    expect(init.method).toBe('DELETE');
    expect(readRequestDocument(init)).toEqual({ data: [{ type: 'betaTesters', id: 't1' }] });
  });
});
describe('AppStoreConnectClient - customer reviews', () => {
  it('lists reviews with include=response, computing `answered` from the response relationship', async () => {
    const page2 = 'https://api.appstoreconnect.apple.com/v1/apps/app1/customerReviews?cursor=P2';
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              {
                id: 'r1',
                attributes: {
                  rating: 5,
                  title: 'Love it',
                  body: 'Great',
                  reviewerNickname: 'fan',
                  territory: 'USA',
                },
                relationships: { response: { data: { id: 'resp1' } } },
              },
            ],
            links: { next: page2 },
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({
            data: [
              { id: 'r2', attributes: { rating: 1 }, relationships: { response: { data: null } } },
            ],
          }),
        ),
      );
    const reviews = await client.listCustomerReviews('app1', { rating: 5, territory: 'USA' });
    expect(reviews).toEqual([
      {
        id: 'r1',
        rating: 5,
        title: 'Love it',
        body: 'Great',
        reviewerNickname: 'fan',
        territory: 'USA',
        answered: true,
      },
      { id: 'r2', rating: 1, answered: false },
    ]);
    const firstUrl = String(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]);
    expect(firstUrl).toContain('/apps/app1/customerReviews?include=response&sort=-createdDate');
    expect(firstUrl).toContain('filter[rating]=5');
    expect(firstUrl).toContain('filter[territory]=USA');
    // Page 2 follows the absolute cursor verbatim - no /v1/v1 double-prefix.
    expect(String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0])).toBe(page2);
  });
  it('returns null for a review with no developer response (Apple 404s)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getCustomerReviewResponse('r1')).toBeNull();
  });
  it('creates/replaces a response with the review relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'resp1', attributes: { responseBody: 'Thanks!', state: 'PENDING_PUBLISH' } },
        }),
      ),
    );
    const reviewResponse = await client.createCustomerReviewResponse('r1', 'Thanks!');
    expect(reviewResponse).toEqual({
      id: 'resp1',
      responseBody: 'Thanks!',
      state: 'PENDING_PUBLISH',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/customerReviewResponses');
    expect(init.method).toBe('POST');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: 'Thanks!' },
        relationships: { review: { data: { type: 'customerReviews', id: 'r1' } } },
      },
    });
  });
  it('deletes a response by id', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.deleteCustomerReviewResponse('resp1');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('DELETE');
    expect(url).toContain('/customerReviewResponses/resp1');
  });
});
describe('AppStoreConnectClient - reports', () => {
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
describe('AppStoreConnectClient - app availability', () => {
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
describe('App Clips', () => {
  it('lists default experiences with the version each releases with (from the relationship)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'exp-1',
              attributes: { action: 'OPEN' },
              relationships: {
                releaseWithAppStoreVersion: { data: { type: 'appStoreVersions', id: 'ver-1' } },
              },
            },
            { id: 'exp-2', attributes: {}, relationships: {} },
          ],
        }),
      ),
    );
    const experiences = await client.listAppClipDefaultExperiences('clip-1');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/appClips/clip-1/appClipDefaultExperiences',
    );
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      'include=releaseWithAppStoreVersion',
    );
    expect(experiences).toEqual([
      { id: 'exp-1', action: 'OPEN', versionId: 'ver-1' },
      { id: 'exp-2' },
    ]);
  });
  it('creates a default experience with the appClip + version relationships and the action', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'exp-new', attributes: {} } })),
    );
    const created = await client.createAppClipDefaultExperience('clip-1', 'ver-1', 'VIEW');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(url).toContain('/appClipDefaultExperiences');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'action'])).toBe('VIEW');
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'appClip', 'data'])).toEqual({
      type: 'appClips',
      id: 'clip-1',
    });
    expect(
      documentValueAt(requestDocument, [
        'data',
        'relationships',
        'releaseWithAppStoreVersion',
        'data',
      ]),
    ).toEqual({
      type: 'appStoreVersions',
      id: 'ver-1',
    });
    expect(created).toEqual({ id: 'exp-new' });
  });
  it('omits the attributes block when no action is given on create', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'exp-new', attributes: {} } })),
    );
    await client.createAppClipDefaultExperience('clip-1', 'ver-1');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toBeUndefined();
  });
  it('creates a card localization with locale + subtitle under the experience', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'loc-new', attributes: {} } })),
    );
    await client.createAppClipDefaultExperienceLocalization('exp-1', 'en-US', 'Order now');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/appClipDefaultExperienceLocalizations');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toEqual({
      locale: 'en-US',
      subtitle: 'Order now',
    });
    expect(
      documentValueAt(requestDocument, [
        'data',
        'relationships',
        'appClipDefaultExperience',
        'data',
      ]),
    ).toEqual({
      type: 'appClipDefaultExperiences',
      id: 'exp-1',
    });
  });
});
describe('EU alternative distribution', () => {
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
describe('Apple Pay / Wallet identifiers', () => {
  it('lists merchant ids with their identifier + name', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'm1', attributes: { identifier: 'merchant.com.acme.app', name: 'Acme Pay' } },
            { id: 'm2', attributes: { identifier: 'merchant.com.acme.b2b' } },
          ],
        }),
      ),
    );
    const merchantIds = await client.listMerchantIds();
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/merchantIds?limit=200',
    );
    expect(merchantIds).toEqual([
      { id: 'm1', identifier: 'merchant.com.acme.app', name: 'Acme Pay' },
      { id: 'm2', identifier: 'merchant.com.acme.b2b' },
    ]);
  });
  it('registers a merchant id with name + identifier', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'm-new', attributes: {} } })),
    );
    await client.createMerchantId('merchant.com.acme.app', 'Acme Pay');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('POST');
    expect(url).toContain('/merchantIds');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data'])).toEqual({
      type: 'merchantIds',
      attributes: { name: 'Acme Pay', identifier: 'merchant.com.acme.app' },
    });
  });
  it('registers a pass type id with name + identifier', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'p-new', attributes: {} } })),
    );
    await client.createPassTypeId('pass.com.acme.coupon', 'Acme Coupon');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/passTypeIds');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data'])).toEqual({
      type: 'passTypeIds',
      attributes: { name: 'Acme Coupon', identifier: 'pass.com.acme.coupon' },
    });
  });
});
describe('Game Center', () => {
  it('returns null when the app has no Game Center detail yet (404)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getGameCenterDetail('app-1')).toBeNull();
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      '/apps/app-1/gameCenterDetail',
    );
  });
  it('enables Game Center by creating a detail with the app relationship', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'gc-1', attributes: {} } })),
    );
    const detail = await client.createGameCenterDetail('app-1');
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'app', 'data'])).toEqual({
      type: 'apps',
      id: 'app-1',
    });
    expect(detail).toEqual({ id: 'gc-1' });
  });
  it('lists achievements and leaderboards through the non-deprecated V2 relationship paths', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    await client.listGameCenterAchievements('gc-1');
    await client.listGameCenterLeaderboards('gc-1');
    const [achievementsUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const [leaderboardsUrl] = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    expect(achievementsUrl).toContain('/gameCenterDetails/gc-1/gameCenterAchievementsV2?');
    expect(leaderboardsUrl).toContain('/gameCenterDetails/gc-1/gameCenterLeaderboardsV2?');
  });
  it('creates a V2 achievement with an inline version and returns the real version id', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'ach-1',
            relationships: {
              versions: { data: [{ type: 'gameCenterAchievementVersions', id: 'ver-real' }] },
            },
          },
        }),
      ),
    );
    const createdResource = await client.createGameCenterAchievement('gc-1', {
      referenceName: 'First Win',
      vendorIdentifier: 'first_win',
      points: 10,
      showBeforeEarned: false,
      repeatable: false,
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/v2/gameCenterAchievements');
    const requestDocument = readRequestDocument(init);
    // Apple requires the inline temp id as ${local-id} in both the relationship and the included version.
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'versions', 'data', 0, 'id']),
    ).toBe('${version-0}');
    expect(documentValueAt(requestDocument, ['included', 0])).toEqual({
      type: 'gameCenterAchievementVersions',
      id: '${version-0}',
    });
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'gameCenterDetail', 'data']),
    ).toEqual({
      type: 'gameCenterDetails',
      id: 'gc-1',
    });
    expect(createdResource).toEqual({ id: 'ach-1', versionId: 'ver-real' });
  });
  it("returns a null version id when Apple's create response omits the versions relationship", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'ach-2', relationships: {} } })),
    );
    const createdResource = await client.createGameCenterAchievement('gc-1', {
      referenceName: 'x',
      vendorIdentifier: 'x',
      points: 1,
      showBeforeEarned: false,
      repeatable: false,
    });
    expect(createdResource.versionId).toBeNull();
  });
  it('attaches an achievement localization to the version', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(201, JSON.stringify({ data: { id: 'loc-1', attributes: {} } })),
    );
    await client.createGameCenterAchievementLocalization('ver-real', {
      locale: 'en-US',
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    });
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(url).toContain('/v2/gameCenterAchievementLocalizations');
    const requestDocument = readRequestDocument(init);
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toEqual({
      locale: 'en-US',
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'version', 'data'])).toEqual({
      type: 'gameCenterAchievementVersions',
      id: 'ver-real',
    });
  });
  it('creates a V2 leaderboard with its attributes and an inline version', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'lb-1',
            relationships: {
              versions: { data: [{ type: 'gameCenterLeaderboardVersions', id: 'lv-real' }] },
            },
          },
        }),
      ),
    );
    const createdResource = await client.createGameCenterLeaderboard('gc-1', {
      referenceName: 'High Score',
      vendorIdentifier: 'high_score',
      defaultFormatter: 'INTEGER',
      submissionType: 'BEST_SCORE',
      scoreSortType: 'DESC',
    });
    const requestDocument = readRequestDocument(
      expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1],
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'defaultFormatter'])).toBe(
      'INTEGER',
    );
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'scoreSortType'])).toBe('DESC');
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'versions', 'data', 0, 'id']),
    ).toBe('${version-0}');
    expect(documentValueAt(requestDocument, ['included', 0])).toEqual({
      type: 'gameCenterLeaderboardVersions',
      id: '${version-0}',
    });
    expect(createdResource).toEqual({ id: 'lb-1', versionId: 'lv-real' });
  });
});
describe('describeErrors', () => {
  it("joins Apple's error details, falling back to titles", () => {
    expect(describeErrors(JSON.stringify({ errors: [{ detail: 'd1' }, { title: 't2' }] }))).toBe(
      'd1; t2',
    );
  });
  it("returns the raw body when it isn't JSON, and a placeholder when empty", () => {
    expect(describeErrors('plain text failure')).toBe('plain text failure');
    expect(describeErrors('')).toBe('no response body');
  });
  it("includes Apple's associated validation errors with their resource path", () => {
    const requestDocument = JSON.stringify({
      errors: [
        {
          detail: 'This resource cannot be reviewed, please check associated errors to see why.',
          meta: {
            associatedErrors: {
              '/v1/appInfos/info1': [
                {
                  title: 'The provided entity is missing a required relationship',
                  detail: "You must provide a value for the relationship 'primaryCategory'.",
                },
              ],
              '/v1/appEncryptionDeclarations/decl1': [
                {
                  detail: 'You must answer the regulated medical device declaration.',
                },
              ],
            },
          },
        },
      ],
    });
    expect(describeErrors(requestDocument)).toBe(
      "This resource cannot be reviewed, please check associated errors to see why.; associated /v1/appInfos/info1: You must provide a value for the relationship 'primaryCategory'.; associated /v1/appEncryptionDeclarations/decl1: You must answer the regulated medical device declaration.",
    );
  });
});
describe('parseErrorCodes', () => {
  it("extracts Apple's machine-readable error codes", () => {
    const requestDocument = JSON.stringify({
      errors: [{ code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED' }, { code: 'X' }],
    });
    expect(parseErrorCodes(requestDocument)).toEqual([
      'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED',
      'X',
    ]);
  });
  it('returns an empty list for a non-JSON or errorless body', () => {
    expect(parseErrorCodes('not json')).toEqual([]);
    expect(parseErrorCodes(JSON.stringify({ data: [] }))).toEqual([]);
  });
});
describe('clockSkewHint', () => {
  // A fixed reference instant so the skew math is deterministic regardless of when the suite runs.
  const APPLE_DATE = 'Sun, 15 Jun 2026 12:00:00 GMT';
  const APPLE_MS = Date.parse(APPLE_DATE);
  it('flags a fast Mac clock with the drift and the resync command', () => {
    const hint = clockSkewHint({
      appleDate: APPLE_DATE,
      nowMs: APPLE_MS + 5 * 60000,
      platform: 'darwin',
    });
    expect(hint).toContain('~5 minutes');
    expect(hint).toContain('sudo sntp -sS time.apple.com');
  });
  it('flags a slow clock too (drift is absolute), in seconds under two minutes', () => {
    const hint = clockSkewHint({
      appleDate: APPLE_DATE,
      nowMs: APPLE_MS - 90000,
      platform: 'darwin',
    });
    expect(hint).toContain('~90 seconds');
  });
  it('stays silent when the drift is within tolerance', () => {
    expect(
      clockSkewHint({ appleDate: APPLE_DATE, nowMs: APPLE_MS + 30000, platform: 'darwin' }),
    ).toBe('');
  });
  it('stays silent off macOS, even with a wild clock - no sntp spam on other platforms', () => {
    const wild = APPLE_MS + 60 * 60000;
    expect(clockSkewHint({ appleDate: APPLE_DATE, nowMs: wild, platform: 'linux' })).toBe('');
    expect(clockSkewHint({ appleDate: APPLE_DATE, nowMs: wild, platform: 'win32' })).toBe('');
  });
  it('stays silent when Apple sent no usable Date header', () => {
    expect(
      clockSkewHint({ appleDate: null, nowMs: APPLE_MS + 60 * 60000, platform: 'darwin' }),
    ).toBe('');
    expect(clockSkewHint({ appleDate: 'not-a-date', nowMs: APPLE_MS, platform: 'darwin' })).toBe(
      '',
    );
  });
});
describe('AppStoreConnectClient - 401 clock-skew enrichment', () => {
  it('appends the resync hint when a 401 coincides with a skewed clock (on macOS)', async () => {
    client = new AppStoreConnectClient(makeKey(), 'darwin');
    const skewedDate = new Date(Date.now() + 10 * 60000).toUTCString();
    fetchMock.mockResolvedValueOnce(
      fakeResponse(401, JSON.stringify({ errors: [{ detail: 'token expired' }] }), {
        date: skewedDate,
      }),
    );
    await expect(client.assertReady()).rejects.toThrow(
      /401.*token expired.*sudo sntp -sS time\.apple\.com/,
    );
  });
  it("surfaces only Apple's 401 detail when the clock is fine - no false alarm", async () => {
    client = new AppStoreConnectClient(makeKey(), 'darwin');
    fetchMock.mockResolvedValueOnce(
      fakeResponse(401, JSON.stringify({ errors: [{ detail: 'token expired' }] }), {
        date: new Date().toUTCString(),
      }),
    );
    let message = '';
    try {
      await client.assertReady();
    } catch (error) {
      if (error instanceof Error) message = error.message;
      else message = String(error);
    }
    expect(message).toContain('token expired');
    expect(message).not.toContain('sudo sntp');
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
      'filter[version]=591&limit=1&fields[builds]=version,processingState,uploadedDate,expired,preReleaseVersion&include=preReleaseVersion',
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
  it('creates an App Store version with the app relationship and release type', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: {
            id: 'v1',
            attributes: { versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
          },
        }),
      ),
    );
    const version = await client.createAppStoreVersion('app1', {
      versionString: '1.2.0',
      platform: 'IOS',
      releaseType: 'AFTER_APPROVAL',
    });
    expect(version).toMatchObject({
      id: 'v1',
      versionString: '1.2.0',
      appStoreState: 'PREPARE_FOR_SUBMISSION',
    });
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
    ).toMatchObject({
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: '1.2.0', releaseType: 'AFTER_APPROVAL' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
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
  it('opens a review submission, adds the version as an item, and submits it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(
          201,
          JSON.stringify({ data: { id: 'rs1', attributes: { state: 'READY_FOR_REVIEW' } } }),
        ),
      )
      .mockResolvedValueOnce(
        fakeResponse(201, JSON.stringify({ data: { id: 'item1', attributes: {} } })),
      )
      .mockResolvedValueOnce(fakeResponse(204, ''));
    const submission = await client.createReviewSubmission('app1', 'IOS');
    expect(submission).toEqual({ id: 'rs1', state: 'READY_FOR_REVIEW' });
    await client.addReviewSubmissionItem('rs1', 'v1');
    await client.submitReviewSubmission('rs1');
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[1]),
    ).toMatchObject({
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { id: 'app1' } } },
      },
    });
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[1]),
    ).toMatchObject({
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { id: 'rs1' } },
          appStoreVersion: { data: { id: 'v1' } },
        },
      },
    });
    expect(
      readRequestDocument(expectArrayElement(fetchMock.mock.calls, 2, 'mock call')[1]),
    ).toMatchObject({
      data: { type: 'reviewSubmissions', id: 'rs1', attributes: { submitted: true } },
    });
  });
  it("returns null for a phased release that doesn't exist (404 or empty relationship)", async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getPhasedRelease('v1')).toBeNull();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: null })));
    expect(await client.getPhasedRelease('v2')).toBeNull();
  });
  it("propagates a non-404 failure on an optional read instead of swallowing it as 'absent'", async () => {
    // The shared 404-as-absent path (getOptional) must only catch 404s - any other status is a real failure
    // that has to surface, not be misread as "no phased release". A 403 is non-retryable (isRetryableAscError
    // covers only 429/5xx), so it rejects on the first attempt with no backoff and still carries the status.
    fetchMock.mockResolvedValueOnce(
      fakeResponse(403, JSON.stringify({ errors: [{ title: 'Forbidden' }] })),
    );
    await expect(client.getPhasedRelease('v3')).rejects.toThrow(/403/);
  });
  it('steers a phased release with a state PATCH', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await client.updatePhasedRelease('ph1', 'PAUSE');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appStoreVersionPhasedReleases/ph1');
    expect(readRequestDocument(init)).toMatchObject({
      data: {
        type: 'appStoreVersionPhasedReleases',
        id: 'ph1',
        attributes: { phasedReleaseState: 'PAUSE' },
      },
    });
  });
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
describe('findBundleId - exact identifier, not substring (#291)', () => {
  it('selects the exact identifier when the substring filter also returns child bundle ids', async () => {
    // Apple's filter[identifier] is a substring match, so a query for the main bundle also returns its
    // widget - and it can come back first. The exact row must win, never data[0].
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            { id: 'widget-res', attributes: { identifier: 'com.example.sampleapp.widget' } },
            {
              id: 'main-res',
              attributes: { identifier: 'com.example.sampleapp', seedId: 'TEAM01' },
            },
          ],
        }),
      ),
    );
    const bundle = await client.findBundleId('com.example.sampleapp');
    expect(bundle).toEqual({
      id: 'main-res',
      identifier: 'com.example.sampleapp',
      seedId: 'TEAM01',
    });
    // Drops the limit=1 that could paginate the exact row away behind its substring siblings.
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('filter[identifier]=com.example.sampleapp');
    expect(url).toContain('limit=200');
  });
  it('returns null when only substring siblings match (the bundle itself is unregistered)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'widget-res', attributes: { identifier: 'com.example.sampleapp.widget' } }],
        }),
      ),
    );
    expect(await client.findBundleId('com.example.sampleapp')).toBeNull();
  });
});
