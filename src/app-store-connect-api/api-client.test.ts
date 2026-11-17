import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { makeAppStoreConnectApi, type AppStoreConnectApi } from './app-store-connect-api.js';
import {
  makeKey,
  decodeJwt,
  documentValueAt,
  fakeResponse,
  numberClaim,
  readRequestDocument,
  requestHeaders,
} from './test-helpers.js';
import { expectArrayElement, expectDefined } from '@testkit/assertions.testkit.js';
import { clockSkewHint, describeErrors, parseErrorCodes } from './api-client.js';
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
describe('AppStoreConnectApi - auth + request building', () => {
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
  it('treats a 204 as success with no body (profile deletion)', async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(204, ''));
    await expect(client.deleteProfile('p1')).resolves.toBeUndefined();
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    expect(init.method).toBe('DELETE');
    expect(url).toContain('/profiles/p1');
    expect(requestHeaders(init).get('Content-Type')).toBeNull();
  });
});
describe('AppStoreConnectApi - token reuse + parallel asset upload', () => {
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
    expect(await client.uploadScreenshot('set-1', 'shot.png', fileURLToPath(import.meta.url))).toBe(
      'shot-1',
    );
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
describe('AppStoreConnectApi - pagination (links.next)', () => {
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
describe('AppStoreConnectApi - transient-failure retry', () => {
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
  it('retries a refused token once with a newly signed one, writes included', async () => {
    fetchMock
      .mockResolvedValueOnce(
        fakeResponse(401, JSON.stringify({ errors: [{ detail: 'signed bearer token' }] })),
      )
      .mockResolvedValueOnce(fakeResponse(204, ''));
    await client.deleteScreenshot('shot1');
    const authorizations = fetchMock.mock.calls.map(([, requestInit]) =>
      requestHeaders(requestInit).get('Authorization'),
    );
    expect(authorizations).toHaveLength(2);
    expect(authorizations[1]).not.toBe(authorizations[0]);
  });
  it('surfaces a 401 that a new token does not fix', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fakeResponse(401, JSON.stringify({ errors: [{ detail: 'signed bearer token' }] })),
      ),
    );
    await expect(client.assertReady()).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('does NOT repeat a write after a dropped connection (it may already have landed)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.registerDevice('UDID9', "Dana's iPhone")).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
describe('AppStoreConnectApi - 401 clock-skew enrichment', () => {
  it('appends the resync hint when a 401 coincides with a skewed clock (on macOS)', async () => {
    client = makeAppStoreConnectApi(makeKey(), 'darwin');
    const skewedDate = new Date(Date.now() + 10 * 60000).toUTCString();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fakeResponse(401, JSON.stringify({ errors: [{ detail: 'token expired' }] }), {
          date: skewedDate,
        }),
      ),
    );
    await expect(client.assertReady()).rejects.toThrow(
      /401.*token expired.*sudo sntp -sS time\.apple\.com/,
    );
  });
  it("surfaces only Apple's 401 detail when the clock is fine - no false alarm", async () => {
    client = makeAppStoreConnectApi(makeKey(), 'darwin');
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        fakeResponse(401, JSON.stringify({ errors: [{ detail: 'token expired' }] }), {
          date: new Date().toUTCString(),
        }),
      ),
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
