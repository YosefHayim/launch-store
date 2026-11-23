import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AscKey } from '../types/credentials.ts';
import { expectArrayElement, expectDefined } from '../testkit/assertions-testkit.ts';
import { AppStoreConnectClient } from './asc-client.ts';
import { clockSkewHint, describeErrors, parseErrorCodes } from './connect/shared.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

/** A real P-256 PKCS#8 key so the client can mint a genuine ES256 JWT. */
function makeKey(): AscKey {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });

  return {
    keyId: 'KEY123',
    issuerId: 'issuer-uuid',
    p8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}
function fakeResponse(
  status: number,
  responseText: string,
  headers: Record<string, string> = {},
): Response {
  let responseBody: string | null = responseText;

  if (status == 204) responseBody = null;

  return new Response(responseBody, { status, headers });
}
function fakeBinaryResponse(
  status: number,
  bytes: string,
  errorResponseText: string = '',
): Response {
  let responseBody = errorResponseText;

  if (status >= 200 && status < 300) responseBody = bytes;

  return new Response(responseBody, { status });
}
function readRequestDocument(requestInit: RequestInit): unknown {
  const requestBody = requestInit.body;

  if (typeof requestBody == 'string') return JSON.parse(requestBody);

  throw new Error('expected a JSON request body');
}
function requestHeaders(requestInit: RequestInit): Headers {
  return new Headers(requestInit.headers);
}
function documentValueAt(document: unknown, path: readonly (number | string)[]): unknown {
  let currentValue = document;

  for (const pathPart of path) {
    if (typeof pathPart == 'number') {
      if (!Array.isArray(currentValue)) throw new Error('expected a JSON array');

      currentValue = currentValue[pathPart];
      continue;
    }

    if (typeof currentValue != 'object') throw new Error('expected a JSON object');

    if (currentValue == null) throw new Error('expected a JSON object');

    currentValue = Reflect.get(currentValue, pathPart);
  }

  return currentValue;
}
function numberClaim(claims: Record<string, unknown>, claimName: string): number {
  const claim = claims[claimName];

  if (typeof claim != 'number') throw new Error(`expected numeric JWT claim ${claimName}`);

  return claim;
}
function decodeJwt(token: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
} {
  const tokenParts = token.split('.');
  const headerPart = tokenParts[0];
  const claimsPart = tokenParts[1];
  const headerText = Buffer.from(expectDefined(headerPart, 'JWT header'), 'base64url').toString();
  const claimsText = Buffer.from(expectDefined(claimsPart, 'JWT payload'), 'base64url').toString();

  return {
    header: readObjectText(headerText),
    claims: readObjectText(claimsText),
  };
}

function readObjectText(objectText: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(objectText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject != null) return parsedObject;

  throw new Error('expected a JSON object');
}

const fetchMock = vi.fn();
let client: AppStoreConnectClient;
function prepare() {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = new AppStoreConnectClient(makeKey());
}

beforeEach(prepare);
function cleanup() {
  vi.unstubAllGlobals();
}

afterEach(cleanup);
describe('AppStoreConnectClient - auth + request building', () => {
  async function signsEachRequestWithAShortLivedES256JWTBoundToTheKey() {
    const serialized = JSON.stringify({ data: [{ id: '42', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const id = await client.getAppId('com.example.hello');

    expect(id).toBe('42');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/apps?filter[bundleId]=com.example.hello&limit=1');

    const auth = expectDefined(requestHeaders(init).get('Authorization'), 'authorization header');

    expect(auth).toMatch(/^Bearer /);

    const { header, claims: jwtClaims } = decodeJwt(auth.slice('Bearer '.length));

    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    expect(jwtClaims['iss']).toBe('issuer-uuid');
    expect(jwtClaims['aud']).toBe('appstoreconnect-v1');
    // Apple rejects tokens older than 20 minutes; the client stays at 19.
    expect(numberClaim(jwtClaims, 'exp') - numberClaim(jwtClaims, 'iat')).toBe(19 * 60);
  }

  it(
    'signs each request with a short-lived ES256 JWT bound to the key',
    signsEachRequestWithAShortLivedES256JWTBoundToTheKey,
  );

  async function returnsNullWhenNoAppPieceExistsForTheBundleId() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getAppId('com.example.missing')).toBeNull();
  }

  it(
    'returns null when no app record exists for the bundle id',
    returnsNullWhenNoAppPieceExistsForTheBundleId,
  );

  async function authenticatesOnlyWithABearerAPIKeyJWTNeverAPasswordOrSessionCookieTheEAS2FADodge() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.assertReady();

    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const headers = requestHeaders(init);

    // Bearer <JWT> (JWTs start `eyJ`) - Apple-ID 2FA can't enter the loop, so EAS's 2FA failures can't either.
    expect(headers.get('Authorization')).toMatch(/^Bearer eyJ/);
    expect(headers.get('Cookie')).toBeNull();
  }

  it(
    'authenticates only with a Bearer API-key JWT - never a password or session cookie (the EAS 2FA dodge)',
    authenticatesOnlyWithABearerAPIKeyJWTNeverAPasswordOrSessionCookieTheEAS2FADodge,
  );

  async function resolvesTheAppIdThenTheLatestBuildNumber() {
    const serialized = JSON.stringify({ data: [{ id: 'app1', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'b', attributes: { version: '7' } }] })),
      );
    expect(await client.getLatestBuildNumber('com.example.hello')).toBe(7);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');

    expect(arrayElement[0]).toContain('/builds?filter[app]=app1');
  }

  it('resolves the app id then the latest build number', resolvesTheAppIdThenTheLatestBuildNumber);

  async function reportsZeroBuildsWhenTheAppPieceIsMissing() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getLatestBuildNumber('com.example.missing')).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it(
    'reports zero builds when the app record is missing',
    reportsZeroBuildsWhenTheAppPieceIsMissing,
  );
  it('folds App Store + TestFlight versions and picks the highest numerically', async () => {
    function mockImplementationUrl(url: string | URL) {
      const path = String(url);

      if (path.includes('/appStoreVersions')) {
        const serialized = JSON.stringify({
          data: [{ id: 'v1', attributes: { versionString: '1.9.0' } }],
        });
        const fakeReply = fakeResponse(200, serialized);

        return Promise.resolve(fakeReply);
      }

      if (path.includes('/preReleaseVersions')) {
        const serialized = JSON.stringify({
          data: [{ id: 'p1', attributes: { version: '1.10.0' } }],
        });
        const fakeReply = fakeResponse(200, serialized);

        return Promise.resolve(fakeReply);
      }

      return Promise.resolve(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'app1', attributes: {} }] })),
      );
    }

    // Route by URL, not call order: getLatestMarketingVersion fires the App Store + TestFlight
    // lookups through Promise.all, so which fetch lands first is a race (each awaits JWT signing).
    // Keying the mock on the path keeps the test deterministic regardless of dispatch order.
    fetchMock.mockImplementation(mockImplementationUrl);
    // 1.10.0 (TestFlight) beats 1.9.0 (App Store) - a lexical sort would wrongly pick 1.9.0.
    expect(await client.getLatestMarketingVersion('com.example.hello')).toBe('1.10.0');

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    function hasAppStoreVersionsPath(path: string) {
      return path.includes('/apps/app1/appStoreVersions');
    }

    expect(urls.some(hasAppStoreVersionsPath)).toBe(true);

    function hasPreReleaseVersionsPath(path: string) {
      return path.includes('/apps/app1/preReleaseVersions');
    }

    expect(urls.some(hasPreReleaseVersionsPath)).toBe(true);
  });

  async function returnsNullForMarketingVersionWhenTheAppPieceIsMissing() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getLatestMarketingVersion('com.example.missing')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it(
    'returns null for marketing version when the app record is missing',
    returnsNullForMarketingVersionWhenTheAppPieceIsMissing,
  );

  async function returnsNullWhenTheAppExistsButHasNoVersionsYet() {
    const serialized = JSON.stringify({ data: [{ id: 'app1', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })))
      .mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    expect(await client.getLatestMarketingVersion('com.example.hello')).toBeNull();
  }

  it(
    'returns null when the app exists but has no versions yet',
    returnsNullWhenTheAppExistsButHasNoVersionsYet,
  );

  async function surfacesAppleSErrorDetailNotABareStatusOnFailure() {
    const serialized = JSON.stringify({
      errors: [
        {
          status: '403',
          code: 'X',
          title: 'Forbidden',
          detail: 'A required agreement is missing.',
        },
      ],
    });
    const fakeReply = fakeResponse(403, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(client.assertReady()).rejects.toThrow(/403.*A required agreement is missing\./);
  }

  it(
    "surfaces Apple's error detail (not a bare status) on failure",
    surfacesAppleSErrorDetailNotABareStatusOnFailure,
  );

  async function checkRequiredAgreementsTrueOnACleanReadFalseOnTheAgreements403RethrowsOtherwise() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
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
  }

  it(
    'checkRequiredAgreements: true on a clean read, false on the agreements 403, rethrows otherwise',
    checkRequiredAgreementsTrueOnACleanReadFalseOnTheAgreements403RethrowsOtherwise,
  );

  async function pOSTsACorrectlyShapedBundleIdRegistrationWithAJSONPieceType() {
    const serialized = JSON.stringify({
      data: { id: 'b1', attributes: { identifier: 'com.x', seedId: 'SEED' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const created = await client.createBundleId('com.x', 'X App');

    expect(created).toEqual({ id: 'b1', identifier: 'com.x', seedId: 'SEED' });

    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('POST');
    expect(requestHeaders(init).get('Content-Type')).toBe('application/json');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'bundleIds',
        attributes: { identifier: 'com.x', name: 'X App', platform: 'IOS' },
      },
    });
  }

  it(
    'POSTs a correctly-shaped bundle-id registration with a JSON content type',
    pOSTsACorrectlyShapedBundleIdRegistrationWithAJSONPieceType,
  );

  async function registersAMacOSBundleIdUnderMACOSWhenThePlatformIsPassed() {
    const serialized = JSON.stringify({
      data: { id: 'b2', attributes: { identifier: 'com.x.mac', seedId: 'SEED' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createBundleId('com.x.mac', 'X Mac', 'MAC_OS');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);

    expect(requestDocument).toMatchObject({
      data: { type: 'bundleIds', attributes: { platform: 'MAC_OS' } },
    });
  }

  it(
    'registers a macOS bundle id under MAC_OS when the platform is passed',
    registersAMacOSBundleIdUnderMACOSWhenThePlatformIsPassed,
  );

  async function createsAnAppStoreProfileWithThePlatformSProfileTypeTvOS() {
    const serialized = JSON.stringify({
      data: { id: 'pf2', attributes: { name: 'TV', uuid: 'U2', profileContent: 'B64' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAppStoreProfile('TV', 'bundle1', 'cert1', 'TVOS_APP_STORE');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes', 'profileType']);

    expect(documentAt).toBe('TVOS_APP_STORE');
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'bundleId', 'data'])).toEqual(
      {
        type: 'bundleIds',
        id: 'bundle1',
      },
    );
  }

  it(
    "creates an App Store profile with the platform's profile type (tvOS)",
    createsAnAppStoreProfileWithThePlatformSProfileTypeTvOS,
  );

  async function resolvesTheTeamIDFromTheFirstBundleIdSSeedId() {
    const serialized = JSON.stringify({
      data: [{ id: 'b1', attributes: { seedId: 'ABCDE12345' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.resolveTeamId()).toBe('ABCDE12345');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/bundleIds?limit=1&fields[bundleIds]=seedId');
  }

  it(
    "resolves the Team ID from the first bundle id's seedId",
    resolvesTheTeamIDFromTheFirstBundleIdSSeedId,
  );

  async function returnsNullForTheTeamIDWhenTheAccountHasNoBundleIdsYet() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.resolveTeamId()).toBeNull();
  }

  it(
    'returns null for the Team ID when the account has no bundle ids yet',
    returnsNullForTheTeamIDWhenTheAccountHasNoBundleIdsYet,
  );

  async function listsAccessibleAppNamesDroppingAnyWithoutAName() {
    const serialized = JSON.stringify({
      data: [
        { attributes: { name: 'Mapleleaf' } },
        { attributes: {} },
        { attributes: { name: 'SampleApp' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listAppNames()).toEqual(['Mapleleaf', 'SampleApp']);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/apps?fields[apps]=name');
  }

  it(
    'lists accessible app names, dropping any without a name',
    listsAccessibleAppNamesDroppingAnyWithoutAName,
  );

  async function listsAppsWithIdNameAndBundleIdUsingTheIdWhenANameIsMissing() {
    const serialized = JSON.stringify({
      data: [
        { id: '1', attributes: { name: 'Mapleleaf', bundleId: 'com.acme.maple' } },
        { id: '2', attributes: {} },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listApps()).toEqual([
      { id: '1', name: 'Mapleleaf', bundleId: 'com.acme.maple' },
      { id: '2', name: '2', bundleId: null },
    ]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/apps?fields[apps]=name,bundleId&limit=200');
  }

  it(
    'lists apps with id, name and bundle id, using the id when a name is missing',
    listsAppsWithIdNameAndBundleIdUsingTheIdWhenANameIsMissing,
  );

  async function treatsA204AsSuccessWithNoPieceProfileDeletion() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(client.deleteProfile('p1')).resolves.toBeUndefined();

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('DELETE');
    expect(url).toContain('/profiles/p1');
    expect(requestHeaders(init).get('Content-Type')).toBeNull();
  }

  it(
    'treats a 204 as success with no body (profile deletion)',
    treatsA204AsSuccessWithNoPieceProfileDeletion,
  );
});
describe('AppStoreConnectClient - token reuse + parallel asset upload', () => {
  function cleanupAppStoreConnectClientTokenReuseParallelAssetUpload() {
    vi.useRealTimers();
  }

  afterEach(cleanupAppStoreConnectClientTokenReuseParallelAssetUpload);
  it('signs once per 15 minutes instead of once per request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));

    function mockImplementationPiece() {
      const serialized = JSON.stringify({ data: [] });
      const fakeReply = fakeResponse(200, serialized);
      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationPiece);
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

    function fromPiece(_: unknown, partIndex: number) {
      return {
        method: 'PUT',
        url: `https://upload.example/part-${partIndex}`,
        offset: partIndex,
        length: 1,
        requestHeaders: [],
      };
    }

    const uploadOperations = Array.from({ length: 6 }, fromPiece);

    async function mockImplementationUrl7(url: string, requestInit: RequestInit) {
      if (url.startsWith('https://upload.example/')) {
        inFlightUploads += 1;
        peakInFlightUploads = Math.max(peakInFlightUploads, inFlightUploads);

        function createPromiseWork(resumeUpload: (value: unknown) => void) {
          return setTimeout(resumeUpload, 20);
        }

        await new Promise(createPromiseWork);
        inFlightUploads -= 1;

        return fakeResponse(200, '');
      }

      if (requestInit.method == 'POST') {
        const reservation = { data: { id: 'shot-1', attributes: { uploadOperations } } };
        const serialized = JSON.stringify(reservation);
        return fakeResponse(201, serialized);
      }

      const serialized = JSON.stringify({ data: { id: 'shot-1', attributes: {} } });

      return fakeResponse(200, serialized);
    }

    fetchMock.mockImplementation(mockImplementationUrl7);

    const fileUrltoPath = fileURLToPath(import.meta.url);

    expect(await client.uploadScreenshot('set-1', 'shot.png', fileUrltoPath)).toBe('shot-1');

    const partUploads = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('https://upload.example/'),
    );

    expect(partUploads).toHaveLength(6);
    expect(peakInFlightUploads).toBeGreaterThan(1);
    expect(peakInFlightUploads).toBeLessThanOrEqual(4);
  });

  async function retriesAPartAfterADroppedConnection() {
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: 0, length: 1 },
    ];
    let partAttempts = 0;

    function mockImplementationUrl2(url: string, requestInit: RequestInit) {
      if (url.startsWith('https://upload.example/')) {
        partAttempts += 1;

        if (partAttempts == 1) return Promise.reject(new TypeError('fetch failed'));

        const fakeReply = fakeResponse(200, '');

        return Promise.resolve(fakeReply);
      }

      if (requestInit.method == 'POST') {
        const reservation = { data: { id: 'shot-1', attributes: { uploadOperations } } };
        const serialized = JSON.stringify(reservation);
        const fakeReply = fakeResponse(201, serialized);
        return Promise.resolve(fakeReply);
      }

      const serialized = JSON.stringify({ data: { id: 'shot-1', attributes: {} } });
      const fakeReply = fakeResponse(200, serialized);

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationUrl2);

    const fileUrltoPath = fileURLToPath(import.meta.url);

    await client.uploadScreenshot('set-1', 'shot.png', fileUrltoPath);
    expect(partAttempts).toBe(2);
  }

  it('retries a part after a dropped connection', retriesAPartAfterADroppedConnection);

  async function letsEveryPartInABatchFinishBeforeReportingAFailedPart() {
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: 0, length: 1 },
      { method: 'PUT', url: 'https://upload.example/part-1', offset: 1, length: 1 },
    ];
    let slowPartFinished = false;

    async function mockImplementationUrl8(url: string, requestInit: RequestInit) {
      if (url == 'https://upload.example/part-0') return fakeResponse(400, '');

      if (url == 'https://upload.example/part-1') {
        function createPromiseWork2(resumeUpload: (value: unknown) => void) {
          return setTimeout(resumeUpload, 10);
        }

        await new Promise(createPromiseWork2);
        slowPartFinished = true;

        return fakeResponse(200, '');
      }

      if (requestInit.method == 'POST') {
        const reservation = { data: { id: 'shot-1', attributes: { uploadOperations } } };
        const serialized = JSON.stringify(reservation);
        return fakeResponse(201, serialized);
      }

      const serialized = JSON.stringify({ data: { id: 'shot-1', attributes: {} } });

      return fakeResponse(200, serialized);
    }

    fetchMock.mockImplementation(mockImplementationUrl8);

    const fileUrltoPath = fileURLToPath(import.meta.url);

    await expect(client.uploadScreenshot('set-1', 'shot.png', fileUrltoPath)).rejects.toThrow(
      /asset upload chunk failed \(400\)/,
    );
    expect(slowPartFinished).toBe(true);
  }

  it(
    'lets every part in a batch finish before reporting a failed part',
    letsEveryPartInABatchFinishBeforeReportingAFailedPart,
  );
});
describe('AppStoreConnectClient - build uploads', () => {
  async function opensABuildUploadForTheAppVersionBuildNumberAndPlatform() {
    const serialized = JSON.stringify({ data: { id: 'upload-1', type: 'buildUploads' } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValue(fakeReply);
    await expect(client.createBuildUpload('app-1', '1.4.0', 42, 'IOS')).resolves.toBe('upload-1');

    const [url, requestInit] = expectArrayElement(fetchMock.mock.calls, 0, 'create call');

    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/buildUploads');
    expect(requestInit.method).toBe('POST');

    const requestDocument = readRequestDocument(requestInit);

    expect(requestDocument).toEqual({
      data: {
        type: 'buildUploads',
        attributes: { cfBundleShortVersionString: '1.4.0', cfBundleVersion: '42', platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: 'app-1' } } },
      },
    });
  }

  it(
    'opens a build upload for the app, version, build number and platform',
    opensABuildUploadForTheAppVersionBuildNumberAndPlatform,
  );
  it('fails clearly when the file is shorter than a part Apple asks for', async () => {
    const ipaPath = fileURLToPath(import.meta.url);
    const ipaBytes = readFileSync(ipaPath);
    const pastTheEnd = ipaBytes.byteLength - 2;
    const uploadOperations = [
      { method: 'PUT', url: 'https://upload.example/part-0', offset: pastTheEnd, length: 5 },
    ];

    function mockImplementationUrl3(url: string, requestInit: RequestInit) {
      if (url.startsWith('https://upload.example/')) {
        const fakeReply = fakeResponse(200, '');
        return Promise.resolve(fakeReply);
      }

      if (requestInit.method == 'POST') {
        const reservation = { data: { id: 'file-1', attributes: { uploadOperations } } };
        const serialized = JSON.stringify(reservation);
        const fakeReply = fakeResponse(201, serialized);
        return Promise.resolve(fakeReply);
      }

      const serialized = JSON.stringify({ data: { id: 'file-1', attributes: {} } });
      const fakeReply = fakeResponse(200, serialized);

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationUrl3);
    await expect(client.uploadBuildFile('upload-1', 'App.ipa', ipaPath)).rejects.toMatchObject({
      _tag: 'StoreUploadFailure',
      provider: 'app-store-connect',
      message: `Read 2 of 5 bytes at offset ${pastTheEnd} from ${ipaPath}; the file changed during the upload.`,
    });

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

    function mockImplementationUrl4(url: string, requestInit: RequestInit) {
      if (url.startsWith('https://upload.example/')) {
        const fakeReply = fakeResponse(200, '');
        return Promise.resolve(fakeReply);
      }

      if (requestInit.method == 'POST') {
        const reservation = { data: { id: 'file-1', attributes: { uploadOperations } } };
        const serialized = JSON.stringify(reservation);
        const fakeReply = fakeResponse(201, serialized);
        return Promise.resolve(fakeReply);
      }

      const serialized = JSON.stringify({ data: { id: 'file-1', attributes: {} } });
      const fakeReply = fakeResponse(200, serialized);

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationUrl4);
    await client.uploadBuildFile('upload-1', 'App.ipa', ipaPath);

    const [reserveUrl, reserveInit] = expectArrayElement(fetchMock.mock.calls, 0, 'reserve call');

    expect(reserveUrl).toBe('https://api.appstoreconnect.apple.com/v1/buildUploadFiles');

    const requestDocument = readRequestDocument(reserveInit);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes']);

    expect(documentAt).toEqual({
      fileName: 'App.ipa',
      fileSize: ipaBytes.byteLength,
      assetType: 'ASSET',
      uti: 'com.apple.ipa',
    });
    expect(
      documentValueAt(readRequestDocument(reserveInit), ['data', 'relationships', 'buildUpload']),
    ).toEqual({ data: { type: 'buildUploads', id: 'upload-1' } });

    const partCalls = fetchMock.mock.calls.slice(1, 3);
    const firstPartCall = partCalls.find(([url]) => url == 'https://upload.example/part-0');
    const [, firstPartInit] = expectDefined(firstPartCall, 'part 0');

    expect(firstPartInit.body).toEqual(ipaBytes.subarray(0, 5));

    const secondPartCall = partCalls.find(([url]) => url == 'https://upload.example/part-1');
    const [, secondPartInit] = expectDefined(secondPartCall, 'part 1');

    expect(secondPartInit.body).toEqual(ipaBytes.subarray(5, 12));

    const [commitUrl, commitInit] = expectArrayElement(fetchMock.mock.calls, 3, 'commit call');

    expect(commitUrl).toBe('https://api.appstoreconnect.apple.com/v1/buildUploadFiles/file-1');
    expect(commitInit.method).toBe('PATCH');
    expect(readRequestDocument(commitInit)).toEqual({
      data: { type: 'buildUploadFiles', id: 'file-1', attributes: { uploaded: true } },
    });
  });

  async function readsTheUploadPieceWithTheDeliveryErrorsOfItsIPA() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValue(fakeReply);
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
  }

  it(
    'reads the upload state with the delivery errors of its IPA',
    readsTheUploadPieceWithTheDeliveryErrorsOfItsIPA,
  );

  async function treatsAnUploadWithNoPieceYetAsAwaitingUpload() {
    const serialized = JSON.stringify({ data: { id: 'upload-1', type: 'buildUploads' } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValue(fakeReply);
    await expect(client.getBuildUploadStatus('upload-1')).resolves.toEqual({
      state: 'AWAITING_UPLOAD',
      fileState: '',
      errors: [],
    });
  }

  it(
    'treats an upload with no state yet as awaiting upload',
    treatsAnUploadWithNoPieceYetAsAwaitingUpload,
  );
});
function describeAppStoreConnectClientPaginationLinksNext() {
  async function followsTheAbsoluteLinksNextURLVerbatimWithoutTheV1V1DoublePrefix() {
    const page2Url = 'https://api.appstoreconnect.apple.com/v1/devices?cursor=PAGE2';
    const serialized = JSON.stringify({
      data: [{ id: 'd1', attributes: { udid: 'AAAA', name: 'Phone A', status: 'ENABLED' } }],
      links: { next: page2Url },
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(
        fakeResponse(
          200,
          JSON.stringify({ data: [{ id: 'd2', attributes: { udid: 'BBBB', name: 'Phone B' } }] }),
        ),
      );

    const devices = await client.listDevices();

    function readUdid(d: {
      readonly id: string;
      readonly udid: string;
      readonly name: string;
      readonly status?: string | undefined | undefined;
    }) {
      return d.udid;
    }

    // Both pages folded into one list - reading only page 1 would silently truncate the team.
    expect(devices.map(readUdid)).toEqual(['AAAA', 'BBBB']);

    // The crux of the #3764 regression: the second request hits the absolute next URL exactly,
    // NOT https://.../v1/v1/devices?... (which is what re-prefixing BASE_URL would produce).
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toBe(page2Url);

    const string = String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]);

    expect(string).not.toContain('/v1/v1');
  }

  it(
    'follows the absolute links.next URL verbatim, without the /v1/v1 double-prefix',
    followsTheAbsoluteLinksNextURLVerbatimWithoutTheV1V1DoublePrefix,
  );

  async function stopsAfterOnePageWhenThereIsNoLinksNext() {
    const serialized = JSON.stringify({
      data: [{ id: 'd1', attributes: { udid: 'AAAA', name: 'Phone A' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listDevices()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it('stops after one page when there is no links.next', stopsAfterOnePageWhenThereIsNoLinksNext);
}

describe(
  'AppStoreConnectClient - pagination (links.next)',
  describeAppStoreConnectClientPaginationLinksNext,
);
function describeAppStoreConnectClientDeviceRegistrationAdHocProfile() {
  async function findsARegisteredDeviceByUDIDCaseInsensitively() {
    const serialized = JSON.stringify({
      data: [{ id: 'd1', attributes: { udid: 'abcd1234', name: 'Phone' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const found = await client.findDeviceByUdid('ABCD1234');

    expect(found?.id).toBe('d1');
  }

  it(
    'finds a registered device by UDID case-insensitively',
    findsARegisteredDeviceByUDIDCaseInsensitively,
  );

  async function pOSTsACorrectlyShapedDeviceRegistration() {
    const serialized = JSON.stringify({
      data: { id: 'd9', attributes: { udid: 'UDID9', name: "Dana's iPhone" } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const created = await client.registerDevice('UDID9', "Dana's iPhone");

    expect(created).toMatchObject({ id: 'd9', udid: 'UDID9', name: "Dana's iPhone" });

    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'devices',
        attributes: { udid: 'UDID9', name: "Dana's iPhone", platform: 'IOS' },
      },
    });
  }

  it('POSTs a correctly-shaped device registration', pOSTsACorrectlyShapedDeviceRegistration);

  async function createsAnAdHocProfileLinkingTheBundleCertAndEveryListedDevice() {
    const serialized = JSON.stringify({
      data: { id: 'pf1', attributes: { name: 'AdHoc', uuid: 'U', profileContent: 'B64' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const profile = await client.createAdHocProfile('AdHoc', 'bundle1', 'cert1', ['d1', 'd2']);

    expect(profile).toEqual({ id: 'pf1', name: 'AdHoc', uuid: 'U', profileContent: 'B64' });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes', 'profileType']);

    expect(documentAt).toBe('IOS_APP_ADHOC');
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'devices', 'data'])).toEqual([
      { type: 'devices', id: 'd1' },
      { type: 'devices', id: 'd2' },
    ]);
  }

  it(
    'creates an ad-hoc profile linking the bundle, cert, and every listed device',
    createsAnAdHocProfileLinkingTheBundleCertAndEveryListedDevice,
  );

  async function createsATvOSAdHocProfileWithTheTVOSAPPADHOCTypeWhenPassed() {
    const serialized = JSON.stringify({
      data: { id: 'pf3', attributes: { name: 'TVAdHoc', uuid: 'U3', profileContent: 'B64' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAdHocProfile('TVAdHoc', 'bundle1', 'cert1', ['d1'], 'TVOS_APP_ADHOC');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes', 'profileType']);

    expect(documentAt).toBe('TVOS_APP_ADHOC');
  }

  it(
    'creates a tvOS ad-hoc profile with the TVOS_APP_ADHOC type when passed',
    createsATvOSAdHocProfileWithTheTVOSAPPADHOCTypeWhenPassed,
  );
}

describe(
  'AppStoreConnectClient - device registration + ad-hoc profile',
  describeAppStoreConnectClientDeviceRegistrationAdHocProfile,
);
describe('AppStoreConnectClient - transient-failure retry', () => {
  async function retriesA429ThenSucceedsSurfacingTheEventualPiece() {
    const serialized = JSON.stringify({ errors: [{ title: 'Rate limited' }] });
    const fakeReply = fakeResponse(429, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: '42', attributes: {} }] })),
      );
    expect(await client.getAppId('com.example.hello')).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }

  it(
    'retries a 429 then succeeds, surfacing the eventual result',
    retriesA429ThenSucceedsSurfacingTheEventualPiece,
  );

  async function doesNOTRetryA4xxAPermanentFailureSurfacesImmediately() {
    const serialized = JSON.stringify({ errors: [{ detail: 'Forbidden' }] });
    const fakeReply = fakeResponse(403, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(client.assertReady()).rejects.toThrow(/403.*Forbidden/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it(
    'does NOT retry a 4xx (a permanent failure surfaces immediately)',
    doesNOTRetryA4xxAPermanentFailureSurfacesImmediately,
  );

  async function retriesAReadAfterADroppedConnection() {
    const serialized = JSON.stringify({ data: [{ id: '42', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(fakeReply);
    expect(await client.getAppId('com.example.hello')).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }

  it('retries a read after a dropped connection', retriesAReadAfterADroppedConnection);
  it('retries a refused token once with a newly signed one, writes included', async () => {
    const serialized = JSON.stringify({ errors: [{ detail: 'signed bearer token' }] });
    const fakeReply = fakeResponse(401, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(fakeResponse(204, ''));
    await client.deleteScreenshot('shot1');

    const authorizations = fetchMock.mock.calls.map(([, requestInit]) =>
      requestHeaders(requestInit).get('Authorization'),
    );

    expect(authorizations).toHaveLength(2);
    expect(authorizations[1]).not.toBe(authorizations[0]);
  });

  async function surfacesA401ThatANewTokenDoesNotFix() {
    function mockImplementationPiece2() {
      const serialized = JSON.stringify({ errors: [{ detail: 'signed bearer token' }] });
      const fakeReply = fakeResponse(401, serialized);
      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationPiece2);
    await expect(client.assertReady()).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }

  it('surfaces a 401 that a new token does not fix', surfacesA401ThatANewTokenDoesNotFix);

  async function doesNOTRepeatAWriteAfterADroppedConnectionItMayAlreadyHaveLanded() {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.registerDevice('UDID9', "Dana's iPhone")).rejects.toThrow(/fetch failed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it(
    'does NOT repeat a write after a dropped connection (it may already have landed)',
    doesNOTRepeatAWriteAfterADroppedConnectionItMayAlreadyHaveLanded,
  );
});
function describeAppStoreConnectClientProductCatalog() {
  async function enablesACapabilityWithTheBundleIdRelationship() {
    const serialized = JSON.stringify({
      data: { id: 'cap1', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const created = await client.enableCapability('bundle1', 'PUSH_NOTIFICATIONS');

    expect(created).toEqual({ id: 'cap1', capabilityType: 'PUSH_NOTIFICATIONS' });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/bundleIdCapabilities');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'bundleIdCapabilities',
        attributes: { capabilityType: 'PUSH_NOTIFICATIONS' },
        relationships: { bundleId: { data: { type: 'bundleIds', id: 'bundle1' } } },
      },
    });
  }

  it(
    'enables a capability with the bundleId relationship',
    enablesACapabilityWithTheBundleIdRelationship,
  );

  async function createsAnInAppPurchaseAgainstTheV2EndpointWithTheAppRelationship() {
    const serialized = JSON.stringify({
      data: {
        id: 'iap1',
        attributes: {
          productId: 'com.x.coins',
          name: 'Coins',
          inAppPurchaseType: 'CONSUMABLE',
        },
      },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

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
    const asString = String(url);

    expect(asString).toBe('https://api.appstoreconnect.apple.com/v2/inAppPurchases');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'inAppPurchases',
        attributes: { productId: 'com.x.coins', name: 'Coins', inAppPurchaseType: 'CONSUMABLE' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  }

  it(
    'creates an in-app purchase against the /v2 endpoint with the app relationship',
    createsAnInAppPurchaseAgainstTheV2EndpointWithTheAppRelationship,
  );

  async function createsAVersionExperimentAndListsItsTreatmentsOnTheV2Paths() {
    const serialized = JSON.stringify({ data: { id: 'exp1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
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
    const asString = String(createUrl);

    expect(asString).toBe('https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments');

    const [listUrl] = expectArrayElement(fetchMock.mock.calls, 1, 'list call');
    const string = String(listUrl);

    expect(string).toContain(
      'https://api.appstoreconnect.apple.com/v2/appStoreVersionExperiments/exp1/appStoreVersionExperimentTreatments?',
    );
  }

  it(
    'creates a version experiment and lists its treatments on the v2 paths',
    createsAVersionExperimentAndListsItsTreatmentsOnTheV2Paths,
  );

  async function treatsAScreenshotAppleNoLongerHasAsDeleted() {
    const serialized = JSON.stringify({ errors: [{ detail: 'There is no resource' }] });
    const fakeReply = fakeResponse(404, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(client.deleteScreenshot('gone')).resolves.toBeUndefined();
  }

  it(
    'treats a screenshot Apple no longer has as deleted',
    treatsAScreenshotAppleNoLongerHasAsDeleted,
  );

  async function deletesAScreenshotAndReordersAScreenshotSet() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(fakeResponse(204, ''));
    await client.deleteScreenshot('shot1');
    await client.reorderScreenshots('set1', ['shot3', 'shot2']);

    const [deleteUrl, deleteInit] = expectArrayElement(fetchMock.mock.calls, 0, 'delete call');
    const asString = String(deleteUrl);

    expect(asString).toBe('https://api.appstoreconnect.apple.com/v1/appScreenshots/shot1');
    expect(deleteInit?.method).toBe('DELETE');

    const [reorderUrl, reorderInit] = expectArrayElement(fetchMock.mock.calls, 1, 'reorder call');
    const string = String(reorderUrl);

    expect(string).toBe(
      'https://api.appstoreconnect.apple.com/v1/appScreenshotSets/set1/relationships/appScreenshots',
    );
    expect(reorderInit?.method).toBe('PATCH');

    const parsed = JSON.parse(String(reorderInit?.body));

    expect(parsed).toEqual({
      data: [
        { type: 'appScreenshots', id: 'shot3' },
        { type: 'appScreenshots', id: 'shot2' },
      ],
    });
  }

  it(
    'deletes a screenshot and reorders a screenshot set',
    deletesAScreenshotAndReordersAScreenshotSet,
  );

  async function createsASubscriptionWithItsBillingPeriodAndGroupRelationship() {
    const serialized = JSON.stringify({
      data: { id: 'sub1', attributes: { productId: 'com.x.pro', name: 'Pro' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createSubscription('group1', {
      productId: 'com.x.pro',
      name: 'Pro Monthly',
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'type']);

    expect(documentAt).toBe('subscriptions');
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).toMatchObject({
      subscriptionPeriod: 'ONE_MONTH',
      groupLevel: 1,
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'group', 'data'])).toEqual({
      type: 'subscriptionGroups',
      id: 'group1',
    });
  }

  it(
    'creates a subscription with its billing period and group relationship',
    createsASubscriptionWithItsBillingPeriodAndGroupRelationship,
  );

  async function writesASubscriptionLocalizationOntoTheExistingDraftVersion() {
    const serialized = JSON.stringify({
      data: [{ id: 'sv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(
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

    const [draftLookupUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const [localizationUrl, localizationInit] = expectArrayElement(
      fetchMock.mock.calls,
      1,
      'mock call',
    );
    const asString = String(draftLookupUrl);

    expect(asString).toBe(
      'https://api.appstoreconnect.apple.com/v1/subscriptions/sub1/versions?limit=200',
    );

    const string = String(localizationUrl);

    expect(string).toBe('https://api.appstoreconnect.apple.com/v2/subscriptionLocalizations');
    expect(fetchMock.mock.calls).toHaveLength(2);

    const requestDocument = readRequestDocument(localizationInit);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'subscriptionLocalizations',
        attributes: { locale: 'en-US', name: 'Pro', description: 'All features' },
        relationships: { version: { data: { type: 'subscriptionVersions', id: 'sv1' } } },
      },
    });
  }

  it(
    'writes a subscription localization onto the existing draft version',
    writesASubscriptionLocalizationOntoTheExistingDraftVersion,
  );

  async function createsTheSubscriptionDraftVersionFirstWhenTheSubscriptionHasNone() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(fakeResponse(201, JSON.stringify({ data: { id: 'sv2' } })))
      .mockResolvedValueOnce(
        fakeResponse(
          201,
          JSON.stringify({ data: { id: 'loc1', attributes: { locale: 'en-US', name: 'Pro' } } }),
        ),
      );
    await client.createSubscriptionLocalization('sub1', {
      locale: 'en-US',
      name: 'Pro',
    });

    const [versionCreateUrl, versionCreateInit] = expectArrayElement(
      fetchMock.mock.calls,
      1,
      'mock call',
    );
    const [, localizationInit] = expectArrayElement(fetchMock.mock.calls, 2, 'mock call');
    const asString = String(versionCreateUrl);

    expect(asString).toBe('https://api.appstoreconnect.apple.com/v1/subscriptionVersions');

    const requestDocument = readRequestDocument(versionCreateInit);

    expect(requestDocument).toEqual({
      data: {
        type: 'subscriptionVersions',
        relationships: { subscription: { data: { type: 'subscriptions', id: 'sub1' } } },
      },
    });

    const documentAt = documentValueAt(readRequestDocument(localizationInit), [
      'data',
      'relationships',
    ]);

    expect(documentAt).toEqual({ version: { data: { type: 'subscriptionVersions', id: 'sv2' } } });
  }

  it(
    'creates the subscription draft version first when the subscription has none',
    createsTheSubscriptionDraftVersionFirstWhenTheSubscriptionHasNone,
  );

  async function omitsDescriptionOnAGroupLocalizationGroupsCarryANameOnly() {
    const serialized = JSON.stringify({
      data: [{ id: 'gv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
      fakeResponse(
        201,
        JSON.stringify({
          data: { id: 'gl1', attributes: { locale: 'en-US', name: 'Pro Tiers' } },
        }),
      ),
    );
    await client.createSubscriptionGroupLocalization('group1', {
      locale: 'en-US',
      name: 'Pro Tiers',
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes']);

    expect(documentAt).toEqual({
      locale: 'en-US',
      name: 'Pro Tiers',
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'version', 'data'])).toEqual({
      type: 'subscriptionGroupVersions',
      id: 'gv1',
    });
    expect(documentValueAt(requestDocument, ['data', 'attributes'])).not.toHaveProperty(
      'description',
    );
  }

  it(
    'omits description on a group localization (groups carry a name only)',
    omitsDescriptionOnAGroupLocalizationGroupsCarryANameOnly,
  );

  async function resolvesASubscriptionPricePointByExactCustomerPrice() {
    const serialized = JSON.stringify({
      data: [
        { id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } },
        { id: 'pp2', attributes: { customerPrice: '9.99', territory: 'USA' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const point = await client.findSubscriptionPricePoint('sub1', 'USA', 9.99);

    expect(point).toEqual({ id: 'pp2', customerPrice: '9.99', territory: 'USA' });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/subscriptions/sub1/pricePoints?filter[territory]=USA');
  }

  it(
    'resolves a subscription price point by exact customer price',
    resolvesASubscriptionPricePointByExactCustomerPrice,
  );

  async function returnsNullWhenNoPricePointMatchesTheRequestedAmount() {
    const serialized = JSON.stringify({
      data: [{ id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.findSubscriptionPricePoint('sub1', 'USA', 9.99)).toBeNull();
  }

  it(
    'returns null when no price point matches the requested amount',
    returnsNullWhenNoPricePointMatchesTheRequestedAmount,
  );

  async function setsASubscriptionPriceByLinkingTheResolvedPricePoint() {
    const serialized = JSON.stringify({ data: { id: 'spr1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createSubscriptionPrice('sub1', 'pp2');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'type']);

    expect(documentAt).toBe('subscriptionPrices');
    expect(documentValueAt(requestDocument, ['data', 'relationships'])).toMatchObject({
      subscription: { data: { type: 'subscriptions', id: 'sub1' } },
      subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: 'pp2' } },
    });
  }

  it(
    'sets a subscription price by linking the resolved price point',
    setsASubscriptionPriceByLinkingTheResolvedPricePoint,
  );

  async function buildsAnIAPPriceScheduleWithABaseTerritoryAndAPieceIdIncludedPrice() {
    const serialized = JSON.stringify({ data: { id: 'sched1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createInAppPurchasePriceSchedule('iap1', 'USA', 'pp9');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'type']);

    expect(documentAt).toBe('inAppPurchasePriceSchedules');
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
  }

  it(
    'builds an IAP price schedule with a base territory and a temp-id included price',
    buildsAnIAPPriceScheduleWithABaseTerritoryAndAPieceIdIncludedPrice,
  );

  async function reportsAnUnpricedInAppPurchaseWhenThePriceScheduleRelationshipIsEmpty404() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.inAppPurchaseHasPrice('iap1')).toBe(false);

    // Must hit the /v2/inAppPurchases/{id}/... relationship path - the bare /v1 inAppPurchasesV2/{id} form 404s for real.
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toBe(
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/iap1/iapPriceSchedule',
    );
  }

  it(
    'reports an unpriced in-app purchase when the price-schedule relationship is empty/404',
    reportsAnUnpricedInAppPurchaseWhenThePriceScheduleRelationshipIsEmpty404,
  );

  async function readsIAPLocalizationsFromTheDraftVersionNotTheDeprecatedParentCollection() {
    const serialized = JSON.stringify({
      data: [{ id: 'iapv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'loc1',
              attributes: { locale: 'en-US', name: 'Lifetime', description: 'Forever access' },
            },
          ],
        }),
      ),
    );

    const locs = await client.listInAppPurchaseLocalizations('iap1');

    expect(locs).toEqual([
      { id: 'loc1', locale: 'en-US', name: 'Lifetime', description: 'Forever access' },
    ]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toBe(
      'https://api.appstoreconnect.apple.com/v2/inAppPurchases/iap1/versions?limit=200',
    );

    const string = String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]);

    expect(string).toBe(
      'https://api.appstoreconnect.apple.com/v1/inAppPurchaseVersions/iapv1/localizations?limit=200',
    );
  }

  it(
    'reads IAP localizations from the draft version, not the deprecated parent collection',
    readsIAPLocalizationsFromTheDraftVersionNotTheDeprecatedParentCollection,
  );

  async function listsNoIAPLocalizationsAndMakesNoLocalizationReadWhenTheProductHasNoVersionAtAll() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listInAppPurchaseLocalizations('iap1')).toEqual([]);
    expect(fetchMock.mock.calls).toHaveLength(1);
  }

  it(
    'lists no IAP localizations and makes no localization read when the product has no version at all',
    listsNoIAPLocalizationsAndMakesNoLocalizationReadWhenTheProductHasNoVersionAtAll,
  );

  async function listsTheNewestApprovedVersionWhenTheProductHasNoDraftSoAnApprovedProductIsNotShownEmpty() {
    const serialized = JSON.stringify({
      data: [
        { id: 'iapv1', attributes: { state: 'APPROVED', version: 1 } },
        { id: 'iapv2', attributes: { state: 'APPROVED', version: 2 } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [{ id: 'loc2', attributes: { locale: 'en-US', name: 'Lifetime' } }],
        }),
      ),
    );
    expect(await client.listInAppPurchaseLocalizations('iap1')).toEqual([
      { id: 'loc2', locale: 'en-US', name: 'Lifetime' },
    ]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toBe(
      'https://api.appstoreconnect.apple.com/v1/inAppPurchaseVersions/iapv2/localizations?limit=200',
    );
  }

  it(
    'lists the newest approved version when the product has no draft, so an approved product is not shown empty',
    listsTheNewestApprovedVersionWhenTheProductHasNoDraftSoAnApprovedProductIsNotShownEmpty,
  );

  async function readsASubscriptionFixtureFromItsDraftVersionIntoTheRowsTheSyncDiffCompares() {
    const serialized = JSON.stringify({
      data: [{ id: 'sv1', attributes: { state: 'PREPARE_FOR_SUBMISSION', version: 1 } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'sl1',
              attributes: { locale: 'en-US', name: 'Pro', description: 'All features' },
            },
            { id: 'sl2', attributes: { locale: 'he', name: 'מקצועי', description: null } },
          ],
        }),
      ),
    );
    expect(await client.listSubscriptionLocalizations('sub1')).toEqual([
      { id: 'sl1', locale: 'en-US', name: 'Pro', description: 'All features' },
      { id: 'sl2', locale: 'he', name: 'מקצועי' },
    ]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toBe(
      'https://api.appstoreconnect.apple.com/v1/subscriptionVersions/sv1/localizations?limit=200',
    );
  }

  it(
    'reads a subscription fixture from its draft version into the rows the sync diff compares',
    readsASubscriptionFixtureFromItsDraftVersionIntoTheRowsTheSyncDiffCompares,
  );

  async function listsBundleIdCapabilitiesWithoutALimitParamTheRelatedEndpointRejectsIt() {
    const serialized = JSON.stringify({
      data: [{ id: 'cap1', attributes: { capabilityType: 'PUSH_NOTIFICATIONS' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const caps = await client.listBundleIdCapabilities('bundle1');

    expect(caps).toEqual([{ id: 'cap1', capabilityType: 'PUSH_NOTIFICATIONS' }]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const url = String(arrayElement[0]);

    expect(url).toContain('/bundleIds/bundle1/bundleIdCapabilities');
    expect(url).not.toContain('limit');
    expect(url).toContain('fields[bundleIdCapabilities]=capabilityType,settings');
  }

  it(
    'lists bundle id capabilities without a limit param (the related endpoint rejects it)',
    listsBundleIdCapabilitiesWithoutALimitParamTheRelatedEndpointRejectsIt,
  );

  const OFFER_PRICES = [
    { territory: 'ISR', pricePointId: 'pp-isr' },
    { territory: 'USA', pricePointId: 'pp-usa' },
  ];

  function expectInlinePriceIds(requestInit: RequestInit) {
    const requestDocument = readRequestDocument(requestInit);

    for (const [index, localId] of ['${price-0}', '${price-1}'].entries()) {
      const documentAt = documentValueAt(requestDocument, [
        'data',
        'relationships',
        'prices',
        'data',
        index,
        'id',
      ]);

      expect(documentAt).toBe(localId);
      expect(documentValueAt(requestDocument, ['included', index, 'id'])).toBe(localId);
    }
  }
  async function createsAnOfferCodeCampaignWithLocalIdInlinePriceIds() {
    const serialized = JSON.stringify({ data: { id: 'offer-1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expectInlinePriceIds(arrayElement[1]);
  }

  it(
    'creates an offer-code campaign with ${local-id} inline price ids',
    createsAnOfferCodeCampaignWithLocalIdInlinePriceIds,
  );

  async function createsAPromotionalOfferWithLocalIdInlinePriceIds() {
    const serialized = JSON.stringify({ data: { id: 'promo-1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createPromotionalOffer({
      subscriptionId: 'sub-1',
      name: 'Come back',
      offerCode: 'come_back',
      duration: 'ONE_MONTH',
      offerMode: 'PAY_AS_YOU_GO',
      numberOfPeriods: 1,
      prices: OFFER_PRICES,
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expectInlinePriceIds(arrayElement[1]);
  }

  it(
    'creates a promotional offer with ${local-id} inline price ids',
    createsAPromotionalOfferWithLocalIdInlinePriceIds,
  );

  async function createsAWinBackOfferWithLocalIdInlinePriceIds() {
    const serialized = JSON.stringify({ data: { id: 'win-back-1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expectInlinePriceIds(arrayElement[1]);
  }

  it(
    'creates a win-back offer with ${local-id} inline price ids',
    createsAWinBackOfferWithLocalIdInlinePriceIds,
  );
}

describe('AppStoreConnectClient - product catalog', describeAppStoreConnectClientProductCatalog);
function describeAppStoreConnectClientExportCompliance() {
  async function resolvesABuildSIdAndExportComplianceAnswerByBuildNumber() {
    const serialized = JSON.stringify({ data: [{ id: 'app1', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');

    expect(arrayElement[0]).toContain('/builds?filter[app]=app1&filter[version]=9');
  }

  it(
    "resolves a build's id and export-compliance answer by build number",
    resolvesABuildSIdAndExportComplianceAnswerByBuildNumber,
  );

  async function reportsNullUsesNonExemptEncryptionWhenTheBuildHasnTAnsweredYet() {
    const serialized = JSON.stringify({ data: [{ id: 'app1', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ data: [{ id: 'build9', attributes: {} }] })),
      );
    expect(await client.findBuild('com.example.hello', 9)).toEqual({
      id: 'build9',
      usesNonExemptEncryption: null,
    });
  }

  it(
    "reports null usesNonExemptEncryption when the build hasn't answered yet",
    reportsNullUsesNonExemptEncryptionWhenTheBuildHasnTAnsweredYet,
  );

  async function returnsNullForFindBuildWhenTheAppPieceIsMissing() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.findBuild('com.example.missing', 9)).toBeNull();
  }

  it(
    'returns null for findBuild when the app record is missing',
    returnsNullForFindBuildWhenTheAppPieceIsMissing,
  );

  async function pATCHesTheBuildSUsesNonExemptEncryptionAttribute() {
    const serialized = JSON.stringify({ data: { id: 'build9', attributes: {} } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.setBuildUsesNonExemptEncryption('build9', false);

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(url);

    expect(asString).toContain('/builds/build9');
    expect(init.method).toBe('PATCH');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({
      data: { type: 'builds', id: 'build9', attributes: { usesNonExemptEncryption: false } },
    });
  }

  it(
    "PATCHes the build's usesNonExemptEncryption attribute",
    pATCHesTheBuildSUsesNonExemptEncryptionAttribute,
  );

  async function listsAnAppSEncryptionDeclarationsWithTheirReviewPiece() {
    const serialized = JSON.stringify({ data: [{ id: 'app1', attributes: {} }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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
  }

  it(
    "lists an app's encryption declarations with their review state",
    listsAnAppSEncryptionDeclarationsWithTheirReviewPiece,
  );

  async function linksABuildToADeclarationViaTheRelationshipsEndpoint() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.linkBuildToDeclaration('decl1', 'build9');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(url);

    expect(asString).toContain('/appEncryptionDeclarations/decl1/relationships/builds');
    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({ data: [{ type: 'builds', id: 'build9' }] });
  }

  it(
    'links a build to a declaration via the relationships endpoint',
    linksABuildToADeclarationViaTheRelationshipsEndpoint,
  );
}

describe(
  'AppStoreConnectClient - export compliance',
  describeAppStoreConnectClientExportCompliance,
);
function describeAppStoreConnectClientListingLocalizations() {
  async function picksTheEditableAppStoreVersionIgnoringALiveOne() {
    const serialized = JSON.stringify({
      data: [
        { id: 'v-live', attributes: { appStoreState: 'READY_FOR_SALE' } },
        { id: 'v-edit', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getEditableVersionId('app1')).toBe('v-edit');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/apps/app1/appStoreVersions');
  }

  it(
    'picks the editable App Store version, ignoring a live one',
    picksTheEditableAppStoreVersionIgnoringALiveOne,
  );

  async function returnsNullWhenNoAppStoreVersionIsEditable() {
    const serialized = JSON.stringify({
      data: [{ id: 'v-live', attributes: { appStoreState: 'READY_FOR_SALE' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getEditableVersionId('app1')).toBeNull();
  }

  it(
    'returns null when no App Store version is editable',
    returnsNullWhenNoAppStoreVersionIsEditable,
  );

  async function picksTheEditableAppPieceByPiece() {
    const serialized = JSON.stringify({
      data: [
        { id: 'ai-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
        { id: 'ai-edit', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getEditableAppInfoId('app1')).toBe('ai-edit');
  }

  it('picks the editable appInfo by state', picksTheEditableAppPieceByPiece);

  async function readsTheLiveAppPieceAndVersionWhenNothingIsEditable() {
    const serialized = JSON.stringify({
      data: [
        { id: 'ai-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
        { id: 'ai-review', attributes: { state: 'WAITING_FOR_REVIEW' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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
  }

  it(
    'reads the live appInfo and version when nothing is editable',
    readsTheLiveAppPieceAndVersionWhenNothingIsEditable,
  );

  async function readsAPreOrderVersionAsTheLiveOne() {
    const serialized = JSON.stringify({
      data: [{ id: 'v-preorder', attributes: { appStoreState: 'PREORDER_READY_FOR_SALE' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getCurrentVersionId('app1')).toBe('v-preorder');
  }

  it('reads a pre-order version as the live one', readsAPreOrderVersionAsTheLiveOne);

  async function prefersTheEditableAppPieceAndVersionOverTheLiveOnes() {
    const serialized = JSON.stringify({
      data: [
        { id: 'ai-live', attributes: { state: 'READY_FOR_DISTRIBUTION' } },
        { id: 'ai-edit', attributes: { state: 'PREPARE_FOR_SUBMISSION' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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
  }

  it(
    'prefers the editable appInfo and version over the live ones',
    prefersTheEditableAppPieceAndVersionOverTheLiveOnes,
  );

  async function listsVersionLocalizationsKeepingOnlyPresentNonEmptyFields() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listVersionLocalizations('v-edit')).toEqual([
      { id: 'vl1', locale: 'en-US', fields: { description: 'Copy', keywords: 'a,b' } },
    ]);
  }

  it(
    'lists version localizations, keeping only present non-empty fields',
    listsVersionLocalizationsKeepingOnlyPresentNonEmptyFields,
  );

  async function readsANullPrivacyChoicesUrlAsAnUnsetAccountDeletionURL() {
    const serialized = JSON.stringify({
      data: [
        { id: 'ail-en', attributes: { locale: 'en-US', privacyChoicesUrl: null } },
        {
          id: 'ail-he',
          attributes: { locale: 'he', privacyChoicesUrl: 'https://example.com/delete' },
        },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listAccountDeletionUrls('ai-edit')).toEqual([
      { locale: 'en-US', url: '' },
      { locale: 'he', url: 'https://example.com/delete' },
    ]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/appInfos/ai-edit/appInfoLocalizations');
  }

  it(
    'reads a null privacyChoicesUrl as an unset account-deletion URL',
    readsANullPrivacyChoicesUrlAsAnUnsetAccountDeletionURL,
  );

  async function omitsNullPromotionalPieceProductDescriptionAndWhatToTestCopy() {
    const serialized = JSON.stringify({
      data: [{ id: 'cpl1', attributes: { locale: 'en-US', promotionalText: null } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
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
  }

  it(
    'omits null promotional text, product description and What to Test copy',
    omitsNullPromotionalPieceProductDescriptionAndWhatToTestCopy,
  );

  async function omitsNullOptionalFieldsFromInAppEventsAndTheirLocalizations() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');

    expect(arrayElement[0]).toContain('/appEvents/ev1/localizations?');
  }

  it(
    'omits null optional fields from in-app events and their localizations',
    omitsNullOptionalFieldsFromInAppEventsAndTheirLocalizations,
  );

  async function pOSTsANewVersionLocalizationWithTheAppStoreVersionRelationship() {
    const serialized = JSON.stringify({ data: { id: 'vl-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createVersionLocalization('v-edit', 'fr-FR', { description: 'Texte' });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(url);

    expect(asString).toContain('/appStoreVersionLocalizations');
    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({
      data: {
        type: 'appStoreVersionLocalizations',
        attributes: { locale: 'fr-FR', description: 'Texte' },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: 'v-edit' } } },
      },
    });
  }

  it(
    'POSTs a new version localization with the appStoreVersion relationship',
    pOSTsANewVersionLocalizationWithTheAppStoreVersionRelationship,
  );

  async function pATCHesOnlyTheChangedFieldsOnAnAppLevelLocalization() {
    const serialized = JSON.stringify({ data: { id: 'ail1', attributes: {} } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.updateAppInfoLocalization('ail1', { name: 'New' });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(url);

    expect(asString).toContain('/appInfoLocalizations/ail1');
    expect(init.method).toBe('PATCH');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({
      data: { type: 'appInfoLocalizations', id: 'ail1', attributes: { name: 'New' } },
    });
  }

  it(
    'PATCHes only the changed fields on an app-level localization',
    pATCHesOnlyTheChangedFieldsOnAnAppLevelLocalization,
  );
}

describe(
  'AppStoreConnectClient - listing localizations',
  describeAppStoreConnectClientListingLocalizations,
);
function describeAppStoreConnectClientTestFlightBetaGroupsTesters() {
  async function createsAnExternalBetaGroupWithTheAppRelationship() {
    const serialized = JSON.stringify({
      data: { id: 'bg1', attributes: { name: 'External Testers' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const group = await client.createBetaGroup('app1', 'External Testers');

    expect(group).toEqual({ id: 'bg1', name: 'External Testers' });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/betaGroups');
    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'betaGroups',
        attributes: { name: 'External Testers' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  }

  it(
    'creates an external beta group with the app relationship',
    createsAnExternalBetaGroupWithTheAppRelationship,
  );

  async function listsBetaGroupsDroppingANamelessPieceAndSurfacingInternalPublicLink() {
    const serialized = JSON.stringify({
      data: [
        {
          id: 'bg1',
          attributes: { name: 'External', isInternalGroup: false, publicLink: 'https://tf/x' },
        },
        { id: 'bg2', attributes: { name: 'Team', isInternalGroup: true } },
        { id: 'bg3', attributes: {} },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listBetaGroups('app1')).toEqual([
      { id: 'bg1', name: 'External', isInternal: false, publicLink: 'https://tf/x' },
      { id: 'bg2', name: 'Team', isInternal: true },
    ]);

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/apps/app1/betaGroups');
  }

  it(
    'lists beta groups, dropping a nameless row and surfacing internal/public-link',
    listsBetaGroupsDroppingANamelessPieceAndSurfacingInternalPublicLink,
  );

  async function findsABetaGroupByNameCaseInsensitively() {
    const serialized = JSON.stringify({
      data: [{ id: 'bg1', attributes: { name: 'External Testers' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect((await client.findBetaGroupByName('app1', 'external testers'))?.id).toBe('bg1');
  }

  it('finds a beta group by name case-insensitively', findsABetaGroupByNameCaseInsensitively);

  async function createsATesterWithTheBetaGroupsRelationshipTheInviteSendingPath() {
    const serialized = JSON.stringify({
      data: { id: 't1', attributes: { email: 'a@x.com', firstName: 'Dana', state: 'INVITED' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const tester = await client.createBetaTester('bg1', { email: 'a@x.com', firstName: 'Dana' });

    expect(tester).toMatchObject({
      id: 't1',
      email: 'a@x.com',
      firstName: 'Dana',
      state: 'INVITED',
    });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/betaTesters');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'betaTesters',
        attributes: { email: 'a@x.com', firstName: 'Dana' },
        relationships: { betaGroups: { data: [{ type: 'betaGroups', id: 'bg1' }] } },
      },
    });
  }

  it(
    'creates a tester with the betaGroups relationship (the invite-sending path)',
    createsATesterWithTheBetaGroupsRelationshipTheInviteSendingPath,
  );

  async function keepsAPublicLinkTesterWithANullEmailAndOmitsNullNames() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listBetaTestersInGroup('bg1')).toEqual([
      { id: 't-public', email: '', state: 'INSTALLED' },
      { id: 't-invited', email: 'a@x.com', state: 'INVITED' },
    ]);
  }

  it(
    'keeps a public-link tester with a null email and omits null names',
    keepsAPublicLinkTesterWithANullEmailAndOmitsNullNames,
  );

  async function findsATesterByEmailViaTheFilterMatchingCaseInsensitively() {
    const serialized = JSON.stringify({ data: [{ id: 't1', attributes: { email: 'A@X.com' } }] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect((await client.findBetaTesterByEmail('a@x.com'))?.id).toBe('t1');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/betaTesters?filter[email]=a%40x.com');
  }

  it(
    'finds a tester by email via the filter, matching case-insensitively',
    findsATesterByEmailViaTheFilterMatchingCaseInsensitively,
  );

  async function bulkAddsExistingTestersToAGroupViaTheRelationshipEndpoint() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.addTestersToGroup('bg1', ['t1', 't2']);

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/betaGroups/bg1/relationships/betaTesters');
    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({
      data: [
        { type: 'betaTesters', id: 't1' },
        { type: 'betaTesters', id: 't2' },
      ],
    });
  }

  it(
    'bulk-adds existing testers to a group via the relationship endpoint',
    bulkAddsExistingTestersToAGroupViaTheRelationshipEndpoint,
  );

  async function removesTestersFromAGroupWithADELETECarryingTheRelationshipPiece() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.removeTestersFromGroup('bg1', ['t1']);

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/betaGroups/bg1/relationships/betaTesters');
    expect(init.method).toBe('DELETE');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({ data: [{ type: 'betaTesters', id: 't1' }] });
  }

  it(
    'removes testers from a group with a DELETE carrying the relationship body',
    removesTestersFromAGroupWithADELETECarryingTheRelationshipPiece,
  );
}

describe(
  'AppStoreConnectClient - TestFlight beta groups + testers',
  describeAppStoreConnectClientTestFlightBetaGroupsTesters,
);
function describeAppStoreConnectClientCustomerReviews() {
  async function listsReviewsWithIncludePieceComputingAnsweredFromThePieceRelationship() {
    const page2 = 'https://api.appstoreconnect.apple.com/v1/apps/app1/customerReviews?cursor=P2';
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const firstUrl = String(arrayElement[0]);

    expect(firstUrl).toContain('/apps/app1/customerReviews?include=response&sort=-createdDate');
    expect(firstUrl).toContain('filter[rating]=5');
    expect(firstUrl).toContain('filter[territory]=USA');

    // Page 2 follows the absolute cursor verbatim - no /v1/v1 double-prefix.
    const asString = String(expectArrayElement(fetchMock.mock.calls, 1, 'mock call')[0]);

    expect(asString).toBe(page2);
  }

  it(
    'lists reviews with include=response, computing `answered` from the response relationship',
    listsReviewsWithIncludePieceComputingAnsweredFromThePieceRelationship,
  );

  async function returnsNullForAReviewWithNoDeveloperPieceApple404s() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getCustomerReviewResponse('r1')).toBeNull();
  }

  it(
    'returns null for a review with no developer response (Apple 404s)',
    returnsNullForAReviewWithNoDeveloperPieceApple404s,
  );

  async function createsReplacesAPieceWithTheReviewRelationship() {
    const serialized = JSON.stringify({
      data: { id: 'resp1', attributes: { responseBody: 'Thanks!', state: 'PENDING_PUBLISH' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const reviewResponse = await client.createCustomerReviewResponse('r1', 'Thanks!');

    expect(reviewResponse).toEqual({
      id: 'resp1',
      responseBody: 'Thanks!',
      state: 'PENDING_PUBLISH',
    });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/customerReviewResponses');
    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: 'Thanks!' },
        relationships: { review: { data: { type: 'customerReviews', id: 'r1' } } },
      },
    });
  }

  it(
    'creates/replaces a response with the review relationship',
    createsReplacesAPieceWithTheReviewRelationship,
  );

  async function deletesAPieceById() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.deleteCustomerReviewResponse('resp1');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('DELETE');
    expect(url).toContain('/customerReviewResponses/resp1');
  }

  it('deletes a response by id', deletesAPieceById);
}

describe('AppStoreConnectClient - customer reviews', describeAppStoreConnectClientCustomerReviews);
function describeAppStoreConnectClientReports() {
  async function downloadsASalesReportWithTheRightFiltersAndGzipAcceptHeader() {
    const fakeBinary = fakeBinaryResponse(200, 'gzip-bytes');

    fetchMock.mockResolvedValueOnce(fakeBinary);

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
  }

  it(
    'downloads a sales report with the right filters and gzip Accept header',
    downloadsASalesReportWithTheRightFiltersAndGzipAcceptHeader,
  );

  async function defaultsTheFinanceReportTypeToFINANCEDETAIL() {
    const fakeBinary = fakeBinaryResponse(200, 'fin');

    fetchMock.mockResolvedValueOnce(fakeBinary);
    await client.getFinanceReport({
      vendorNumber: '12345678',
      reportDate: '2026-05',
      regionCode: 'ZZ',
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const path = String(arrayElement[0]);

    expect(path).toContain('/financeReports?');
    expect(path).toContain('filter[regionCode]=ZZ');
    expect(path).toContain('filter[reportType]=FINANCE_DETAIL');
  }

  it(
    'defaults the finance report type to FINANCE_DETAIL',
    defaultsTheFinanceReportTypeToFINANCEDETAIL,
  );

  async function surfacesAppleSNoSalesDetailOnAReport404() {
    const serialized = JSON.stringify({
      errors: [{ detail: 'There were no sales for the date specified.' }],
    });
    const fakeBinary = fakeBinaryResponse(404, '', serialized);

    fetchMock.mockResolvedValueOnce(fakeBinary);
    await expect(
      client.getSalesReport({
        vendorNumber: '1',
        frequency: 'DAILY',
        reportType: 'SALES',
        reportSubType: 'SUMMARY',
        reportDate: '2026-06-01',
      }),
    ).rejects.toThrow(/404.*no sales/);
  }

  it("surfaces Apple's 'no sales' detail on a report 404", surfacesAppleSNoSalesDetailOnAReport404);

  async function createsAnAnalyticsReportRequestWithTheAppRelationship() {
    const serialized = JSON.stringify({
      data: { id: 'req1', attributes: { accessType: 'ONGOING' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const request = await client.createAnalyticsReportRequest('app1', 'ONGOING');

    expect(request).toEqual({ id: 'req1', accessType: 'ONGOING' });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/analyticsReportRequests');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'analyticsReportRequests',
        attributes: { accessType: 'ONGOING' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  }

  it(
    'creates an analytics report request with the app relationship',
    createsAnAnalyticsReportRequestWithTheAppRelationship,
  );

  async function filtersReportsByCategoryAndInstancesByGranularityDate() {
    const serialized = JSON.stringify({
      data: [{ id: 'rep1', attributes: { name: 'App Sessions', category: 'APP_USAGE' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toContain(
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
  }

  it(
    'filters reports by category and instances by granularity/date',
    filtersReportsByCategoryAndInstancesByGranularityDate,
  );

  async function listsSegmentsDroppingAnyWithoutAUrlAndDownloadsOneUnauthenticated() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const segments = await client.listAnalyticsReportSegments('inst1');

    expect(segments).toEqual([
      { id: 'seg1', url: 'https://store.example/seg1.gz', checksum: 'abc', sizeInBytes: 10 },
    ]);

    const fakeBinary = fakeBinaryResponse(200, 'segment-gzip');

    fetchMock.mockResolvedValueOnce(fakeBinary);

    const bytes = await client.downloadAnalyticsSegment('https://store.example/seg1.gz');

    expect(bytes.toString()).toBe('segment-gzip');

    // Presigned URL -> no init (and therefore no Authorization), so the storage backend doesn't 400 on dual auth.
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');

    expect(arrayElement[1]).toBeUndefined();
  }

  it(
    'lists segments (dropping any without a url) and downloads one unauthenticated',
    listsSegmentsDroppingAnyWithoutAUrlAndDownloadsOneUnauthenticated,
  );
}

describe('AppStoreConnectClient - reports', describeAppStoreConnectClientReports);
function describeAppLevelReleaseAttributes() {
  async function resolvesTheEditableAppPieceAndItsCurrentCategoryIds() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const appInformation = await client.getAppInfo('app1');
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain(
      '/apps/app1/appInfos?include=primaryCategory,secondaryCategory',
    );
    expect(appInformation).toEqual({
      id: 'editable',
      state: 'PREPARE_FOR_SUBMISSION',
      primaryCategoryId: 'PRODUCTIVITY',
      secondaryCategoryId: 'BUSINESS',
    });
  }

  it(
    'resolves the editable app info and its current category ids',
    resolvesTheEditableAppPieceAndItsCurrentCategoryIds,
  );

  async function pATCHesOnlyTheCategoriesProvidedAsAppCategoriesRelationships() {
    const serialized = JSON.stringify({ data: { id: 'editable', attributes: {} } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.updateAppInfoCategories('editable', { primaryCategoryId: 'GAMES' });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appInfos/editable');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, [
      'data',
      'relationships',
      'primaryCategory',
      'data',
    ]);

    expect(documentAt).toEqual({
      type: 'appCategories',
      id: 'GAMES',
    });
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'secondaryCategory']),
    ).toBeUndefined();
  }

  it(
    'PATCHes only the categories provided, as appCategories relationships',
    pATCHesOnlyTheCategoriesProvidedAsAppCategoriesRelationships,
  );

  async function pATCHesSecondaryCategoryToNullWhenClearingTheStaleSecondaryCategory() {
    const serialized = JSON.stringify({ data: { id: 'editable', attributes: {} } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.updateAppInfoCategories('editable', { secondaryCategoryId: null });

    const [, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, [
      'data',
      'relationships',
      'secondaryCategory',
      'data',
    ]);

    expect(documentAt).toBeNull();
  }

  it(
    'PATCHes secondaryCategory to null when clearing the stale secondary category',
    pATCHesSecondaryCategoryToNullWhenClearingTheStaleSecondaryCategory,
  );

  async function readsAnAgeRatingDeclarationAndTreatsA404AsNone() {
    const serialized = JSON.stringify({
      data: { id: 'age1', attributes: { violenceCartoonOrFantasy: 'NONE' } },
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getAgeRatingDeclaration('editable')).toEqual({
      id: 'age1',
      attributes: { violenceCartoonOrFantasy: 'NONE' },
    });
    fetchMock.mockResolvedValueOnce(
      fakeResponse(404, JSON.stringify({ errors: [{ title: 'Not Found' }] })),
    );
    expect(await client.getAgeRatingDeclaration('editable')).toBeNull();
  }

  it(
    'reads an age-rating declaration and treats a 404 as none',
    readsAnAgeRatingDeclarationAndTreatsA404AsNone,
  );

  async function pATCHesAgeRatingAnswersVerbatim() {
    const serialized = JSON.stringify({ data: { id: 'age1', attributes: {} } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.updateAgeRatingDeclaration('age1', {
      gambling: false,
      violenceRealistic: 'INFREQUENT',
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data']);

    expect(documentAt).toEqual({
      type: 'ageRatingDeclarations',
      id: 'age1',
      attributes: { gambling: false, violenceRealistic: 'INFREQUENT' },
    });
  }

  it('PATCHes age-rating answers verbatim', pATCHesAgeRatingAnswersVerbatim);

  async function matchesAnAppPricePointByTerritoryAndCustomerPrice() {
    const serialized = JSON.stringify({
      data: [
        { id: 'pp1', attributes: { customerPrice: '4.99', territory: 'USA' } },
        { id: 'pp2', attributes: { customerPrice: '9.99', territory: 'USA' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const point = await client.findAppPricePoint('app1', 'USA', 9.99);
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/apps/app1/appPricePoints?filter[territory]=USA');
    expect(point).toEqual({ id: 'pp2', customerPrice: '9.99', territory: 'USA' });
  }

  it(
    'matches an app price point by territory and customer price',
    matchesAnAppPricePointByTerritoryAndCustomerPrice,
  );

  async function readsTheOpenIntervalManualAppPriceAndSkipsScheduledFuturePrices() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getCurrentAppPrice('app1', 'USA')).toBe('9.99');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain(
      '/apps/app1/appPriceSchedule/manualPrices?include=appPricePoint',
    );
  }

  it(
    'reads the open-interval manual app price and skips scheduled future prices',
    readsTheOpenIntervalManualAppPriceAndSkipsScheduledFuturePrices,
  );

  async function returnsNullForTheCurrentAppPriceWhenTheScheduleIsAbsent404() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getCurrentAppPrice('app1', 'USA')).toBeNull();
  }

  it(
    'returns null for the current app price when the schedule is absent (404)',
    returnsNullForTheCurrentAppPriceWhenTheScheduleIsAbsent404,
  );

  async function buildsAnAppPriceScheduleWithABaseTerritoryAndAPieceIdIncludedPrice() {
    const serialized = JSON.stringify({ data: { id: 'sched1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAppPriceSchedule('app1', 'USA', 'pp2');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/appPriceSchedules');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data', 'type']);

    expect(documentAt).toBe('appPriceSchedules');
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
  }

  it(
    'builds an app price schedule with a base territory and a temp-id included price',
    buildsAnAppPriceScheduleWithABaseTerritoryAndAPieceIdIncludedPrice,
  );

  async function findsTheEditableAppStoreVersionAndSkipsFrozenOnes() {
    const serialized = JSON.stringify({
      data: [
        { id: 'v-live', attributes: { appVersionState: 'READY_FOR_DISTRIBUTION' } },
        {
          id: 'v-edit',
          attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', copyright: null },
        },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.findEditableAppStoreVersion('app1', 'IOS')).toEqual({
      id: 'v-edit',
      copyright: '',
    });

    const requestUrl = expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0];

    expect(requestUrl).toContain('/apps/app1/appStoreVersions?filter[platform]=IOS');
    expect(requestUrl).toContain('copyright');
  }

  it(
    'finds the editable App Store version and skips frozen ones',
    findsTheEditableAppStoreVersionAndSkipsFrozenOnes,
  );

  async function readsTheEditableVersionSCopyright() {
    const serialized = JSON.stringify({
      data: [
        {
          id: 'v-edit',
          attributes: { appVersionState: 'PREPARE_FOR_SUBMISSION', copyright: '2026 Acme' },
        },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.findEditableAppStoreVersion('app1', 'IOS')).toEqual({
      id: 'v-edit',
      copyright: '2026 Acme',
    });
  }

  it("reads the editable version's copyright", readsTheEditableVersionSCopyright);

  async function sendsCopyrightInTheAppStoreVersionPATCH() {
    const serialized = JSON.stringify({ data: { id: 'v-edit' } });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.updateAppStoreVersion('v-edit', {
      releaseType: 'AFTER_APPROVAL',
      copyright: '2026 Acme',
    });

    const patchCall = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(patchCall[0]).toContain('/appStoreVersions/v-edit');

    const patchBody = readRequestDocument(patchCall[1]);
    const documentAt = documentValueAt(patchBody, ['data', 'attributes']);

    expect(documentAt).toEqual({
      releaseType: 'AFTER_APPROVAL',
      copyright: '2026 Acme',
    });
  }

  it('sends copyright in the App Store version PATCH', sendsCopyrightInTheAppStoreVersionPATCH);

  async function returnsNullWhenNoAppStoreVersionIsEditable2() {
    const serialized = JSON.stringify({
      data: [{ id: 'v-live', attributes: { appVersionState: 'REPLACED_WITH_NEW_VERSION' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.findEditableAppStoreVersion('app1', 'IOS')).toBeNull();
  }

  it(
    'returns null when no App Store version is editable',
    returnsNullWhenNoAppStoreVersionIsEditable2,
  );

  async function readsReviewDetailsCreatesThemWithTheVersionRelationshipAndPatchesUpdates() {
    const serialized = JSON.stringify({
      data: { id: 'rd1', attributes: { contactEmail: 'a@b.co' } },
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    const createBody = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(createBody, [
      'data',
      'relationships',
      'appStoreVersion',
      'data',
    ]);

    expect(documentAt).toEqual({
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
  }

  it(
    'reads review details, creates them with the version relationship, and patches updates',
    readsReviewDetailsCreatesThemWithTheVersionRelationshipAndPatchesUpdates,
  );

  async function returnsNullReviewDetailsOnA404() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getAppStoreReviewDetail('v-edit')).toBeNull();
  }

  it('returns null review details on a 404', returnsNullReviewDetailsOnA404);
}

describe('app-level release attributes', describeAppLevelReleaseAttributes);
describe('AppStoreConnectClient - app availability', () => {
  async function readsAvailableTerritoriesOnlyWhenTheTerritoryRelationshipIsPresent() {
    const serialized = JSON.stringify({
      data: {
        id: 'availability-1',
        attributes: { availableInNewTerritories: true },
      },
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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
  }

  it(
    'reads available territories only when the territory relationship is present',
    readsAvailableTerritoriesOnlyWhenTheTerritoryRelationshipIsPresent,
  );

  async function returnsNullWhenTheAppHasNoAvailabilitySingleton() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);
    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(client.getAppAvailability('app-1')).resolves.toBeNull();
  }

  it(
    'returns null when the app has no availability singleton',
    returnsNullWhenTheAppHasNoAvailabilitySingleton,
  );

  async function createsTheSingletonWithPOSTAndTheCompleteInlineTerritorySet() {
    const serialized = JSON.stringify({ data: { id: 'availability-1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAppAvailability('app-1', {
      availableInNewTerritories: false,
      territories: ['GBR', 'USA'],
    });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'create availability call');

    expect(url).toBe('https://api.appstoreconnect.apple.com/v2/appAvailabilities');
    expect(init.method).toBe('POST');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({
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
  }

  it(
    'creates the singleton with POST and the complete inline territory set',
    createsTheSingletonWithPOSTAndTheCompleteInlineTerritorySet,
  );
  it('PATCHes only changed territory rows when the singleton already exists', async () => {
    function mockImplementationUrl5(_url: string | URL, init?: RequestInit) {
      if (init?.method == 'GET') {
        const serialized = JSON.stringify({
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
        });
        const fakeReply = fakeResponse(200, serialized);

        return Promise.resolve(fakeReply);
      }

      const fakeReply = fakeResponse(204, '');

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationUrl5);
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

  async function acceptsAnEmptyDesiredSetAndDisablesEveryCurrentlyAvailableTerritory() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(fakeResponse(204, ''));
    await client.updateAppAvailabilityTerritories('availability-1', []);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 1, 'clear territory call');

    expect(url).toBe('https://api.appstoreconnect.apple.com/v1/territoryAvailabilities/row-usa');
    expect(init.method).toBe('PATCH');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes']);

    expect(documentAt).toEqual({
      available: false,
    });
  }

  it(
    'accepts an empty desired set and disables every currently available territory',
    acceptsAnEmptyDesiredSetAndDisablesEveryCurrentlyAvailableTerritory,
  );

  async function failsBeforePATCHingWhenAppleOmitsADesiredTerritoryPiece() {
    const serialized = JSON.stringify({
      data: [
        {
          id: 'row-usa',
          attributes: { available: true },
          relationships: { territory: { data: { id: 'USA' } } },
        },
      ],
      links: {},
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(
      client.updateAppAvailabilityTerritories('availability-1', ['USA', 'GBR']),
    ).rejects.toMatchObject({
      _tag: 'AscAvailabilityUpdateError',
      message: 'Apple did not return updatable availability rows for: GBR.',
      missingTerritories: ['GBR'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }

  it(
    'fails before PATCHing when Apple omits a desired territory row',
    failsBeforePATCHingWhenAppleOmitsADesiredTerritoryPiece,
  );
  it('never POSTs a second singleton when updating an existing availability', async () => {
    function mockImplementationUrl6(_url: string | URL, init?: RequestInit) {
      if (init?.method == 'GET') {
        const serialized = JSON.stringify({
          data: [
            {
              id: 'row-usa',
              attributes: { available: true },
              relationships: { territory: { data: { id: 'USA' } } },
            },
          ],
          links: {},
        });
        const fakeReply = fakeResponse(200, serialized);

        return Promise.resolve(fakeReply);
      }

      if (init?.method == 'PATCH') {
        const fakeReply = fakeResponse(204, '');
        return Promise.resolve(fakeReply);
      }

      const serialized = JSON.stringify({ errors: [{ title: 'unexpected' }] });
      const fakeReply = fakeResponse(500, serialized);

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationUrl6);
    await client.updateAppAvailabilityTerritories('availability-1', []);

    const methods = fetchMock.mock.calls.map(([, requestInit]) => {
      if (requestInit?.method == null) return 'GET';

      return requestInit.method;
    });

    expect(methods).not.toContain('POST');
    expect(methods).toContain('PATCH');

    const createSingletonCalls = fetchMock.mock.calls.filter(([requestUrl, requestInit]) => {
      if (requestInit?.method != 'POST') return false;

      return String(requestUrl).includes('/v2/appAvailabilities');
    });

    expect(createSingletonCalls).toHaveLength(0);
  });
});
function describeAppClips() {
  async function listsDefaultExperiencesWithTheVersionEachReleasesWithFromTheRelationship() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const experiences = await client.listAppClipDefaultExperiences('clip-1');
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/appClips/clip-1/appClipDefaultExperiences');
    expect(expectArrayElement(fetchMock.mock.calls, 0, 'mock call')[0]).toContain(
      'include=releaseWithAppStoreVersion',
    );
    expect(experiences).toEqual([
      { id: 'exp-1', action: 'OPEN', versionId: 'ver-1' },
      { id: 'exp-2' },
    ]);
  }

  it(
    'lists default experiences with the version each releases with (from the relationship)',
    listsDefaultExperiencesWithTheVersionEachReleasesWithFromTheRelationship,
  );

  async function createsADefaultExperienceWithTheAppClipVersionRelationshipsAndTheAction() {
    const serialized = JSON.stringify({ data: { id: 'exp-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const created = await client.createAppClipDefaultExperience('clip-1', 'ver-1', 'VIEW');
    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('POST');
    expect(url).toContain('/appClipDefaultExperiences');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes', 'action']);

    expect(documentAt).toBe('VIEW');
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
  }

  it(
    'creates a default experience with the appClip + version relationships and the action',
    createsADefaultExperienceWithTheAppClipVersionRelationshipsAndTheAction,
  );

  async function omitsTheAttributesBlockWhenNoActionIsGivenOnCreate() {
    const serialized = JSON.stringify({ data: { id: 'exp-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAppClipDefaultExperience('clip-1', 'ver-1');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes']);

    expect(documentAt).toBeUndefined();
  }

  it(
    'omits the attributes block when no action is given on create',
    omitsTheAttributesBlockWhenNoActionIsGivenOnCreate,
  );

  async function createsACardLocalizationWithLocaleSubtitleUnderTheExperience() {
    const serialized = JSON.stringify({ data: { id: 'loc-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAppClipDefaultExperienceLocalization('exp-1', 'en-US', 'Order now');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/appClipDefaultExperienceLocalizations');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes']);

    expect(documentAt).toEqual({
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
  }

  it(
    'creates a card localization with locale + subtitle under the experience',
    createsACardLocalizationWithLocaleSubtitleUnderTheExperience,
  );
}

describe('App Clips', describeAppClips);
function describeEUAlternativeDistribution() {
  async function listsAuthorizedDistributionDomainsWithTheirReferenceNames() {
    const serialized = JSON.stringify({
      data: [
        {
          id: 'd1',
          attributes: { domain: 'downloads.acme.com', referenceName: 'Acme Downloads' },
        },
        { id: 'd2', attributes: { domain: 'cdn.acme.com' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const domains = await client.listAlternativeDistributionDomains();
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/alternativeDistributionDomains?limit=200');
    expect(domains).toEqual([
      { id: 'd1', domain: 'downloads.acme.com', referenceName: 'Acme Downloads' },
      { id: 'd2', domain: 'cdn.acme.com' },
    ]);
  }

  it(
    'lists authorized distribution domains with their reference names',
    listsAuthorizedDistributionDomainsWithTheirReferenceNames,
  );

  async function createsADistributionDomainWithTheDomainReferenceName() {
    const serialized = JSON.stringify({ data: { id: 'd-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createAlternativeDistributionDomain('cdn.acme.com', 'Acme CDN');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('POST');
    expect(url).toContain('/alternativeDistributionDomains');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data']);

    expect(documentAt).toEqual({
      type: 'alternativeDistributionDomains',
      attributes: { domain: 'cdn.acme.com', referenceName: 'Acme CDN' },
    });
  }

  it(
    'creates a distribution domain with the domain + reference name',
    createsADistributionDomainWithTheDomainReferenceName,
  );

  async function registersThePackageSigningPublicKey() {
    const serialized = JSON.stringify({ data: { id: 'k-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const created = await client.createAlternativeDistributionKey(
      '-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----',
    );
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'type']);

    expect(documentAt).toBe('alternativeDistributionKeys');
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'publicKey'])).toContain(
      'BEGIN PUBLIC KEY',
    );
    expect(created).toEqual({ id: 'k-new' });
  }

  it('registers the package-signing public key', registersThePackageSigningPublicKey);
}

describe('EU alternative distribution', describeEUAlternativeDistribution);
function describeApplePayWalletIdentifiers() {
  async function listsMerchantIdsWithTheirIdentifierName() {
    const serialized = JSON.stringify({
      data: [
        { id: 'm1', attributes: { identifier: 'merchant.com.acme.app', name: 'Acme Pay' } },
        { id: 'm2', attributes: { identifier: 'merchant.com.acme.b2b' } },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const merchantIds = await client.listMerchantIds();
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/merchantIds?limit=200');
    expect(merchantIds).toEqual([
      { id: 'm1', identifier: 'merchant.com.acme.app', name: 'Acme Pay' },
      { id: 'm2', identifier: 'merchant.com.acme.b2b' },
    ]);
  }

  it('lists merchant ids with their identifier + name', listsMerchantIdsWithTheirIdentifierName);

  async function registersAMerchantIdWithNameIdentifier() {
    const serialized = JSON.stringify({ data: { id: 'm-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createMerchantId('merchant.com.acme.app', 'Acme Pay');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('POST');
    expect(url).toContain('/merchantIds');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data']);

    expect(documentAt).toEqual({
      type: 'merchantIds',
      attributes: { name: 'Acme Pay', identifier: 'merchant.com.acme.app' },
    });
  }

  it('registers a merchant id with name + identifier', registersAMerchantIdWithNameIdentifier);

  async function registersAPassTypeIdWithNameIdentifier() {
    const serialized = JSON.stringify({ data: { id: 'p-new', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createPassTypeId('pass.com.acme.coupon', 'Acme Coupon');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/passTypeIds');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data']);

    expect(documentAt).toEqual({
      type: 'passTypeIds',
      attributes: { name: 'Acme Coupon', identifier: 'pass.com.acme.coupon' },
    });
  }

  it('registers a pass type id with name + identifier', registersAPassTypeIdWithNameIdentifier);
}

describe('Apple Pay / Wallet identifiers', describeApplePayWalletIdentifiers);
function describeGameCenter() {
  async function returnsNullWhenTheAppHasNoGameCenterDetailYet404() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getGameCenterDetail('app-1')).toBeNull();

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/apps/app-1/gameCenterDetail');
  }

  it(
    'returns null when the app has no Game Center detail yet (404)',
    returnsNullWhenTheAppHasNoGameCenterDetailYet404,
  );

  async function enablesGameCenterByCreatingADetailWithTheAppRelationship() {
    const serialized = JSON.stringify({ data: { id: 'gc-1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const detail = await client.createGameCenterDetail('app-1');
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'relationships', 'app', 'data']);

    expect(documentAt).toEqual({
      type: 'apps',
      id: 'app-1',
    });
    expect(detail).toEqual({ id: 'gc-1' });
  }

  it(
    'enables Game Center by creating a detail with the app relationship',
    enablesGameCenterByCreatingADetailWithTheAppRelationship,
  );

  async function listsAchievementsAndLeaderboardsThroughTheNonDeprecatedV2RelationshipPaths() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: [] })));
    await client.listGameCenterAchievements('gc-1');
    await client.listGameCenterLeaderboards('gc-1');

    const [achievementsUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const [leaderboardsUrl] = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');

    expect(achievementsUrl).toContain('/gameCenterDetails/gc-1/gameCenterAchievementsV2?');
    expect(leaderboardsUrl).toContain('/gameCenterDetails/gc-1/gameCenterLeaderboardsV2?');
  }

  it(
    'lists achievements and leaderboards through the non-deprecated V2 relationship paths',
    listsAchievementsAndLeaderboardsThroughTheNonDeprecatedV2RelationshipPaths,
  );

  async function createsAV2AchievementWithAnInlineVersionAndReturnsTheRealVersionId() {
    const serialized = JSON.stringify({
      data: {
        id: 'ach-1',
        relationships: {
          versions: { data: [{ type: 'gameCenterAchievementVersions', id: 'ver-real' }] },
        },
      },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

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
    const documentAt = documentValueAt(requestDocument, [
      'data',
      'relationships',
      'versions',
      'data',
      0,
      'id',
    ]);

    expect(documentAt).toBe('${version-0}');
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
  }

  it(
    'creates a V2 achievement with an inline version and returns the real version id',
    createsAV2AchievementWithAnInlineVersionAndReturnsTheRealVersionId,
  );

  async function returnsANullVersionIdWhenAppleSCreatePieceOmitsTheVersionsRelationship() {
    const serialized = JSON.stringify({ data: { id: 'ach-2', relationships: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const createdResource = await client.createGameCenterAchievement('gc-1', {
      referenceName: 'x',
      vendorIdentifier: 'x',
      points: 1,
      showBeforeEarned: false,
      repeatable: false,
    });

    expect(createdResource.versionId).toBeNull();
  }

  it(
    "returns a null version id when Apple's create response omits the versions relationship",
    returnsANullVersionIdWhenAppleSCreatePieceOmitsTheVersionsRelationship,
  );

  async function attachesAnAchievementLocalizationToTheVersion() {
    const serialized = JSON.stringify({ data: { id: 'loc-1', attributes: {} } });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.createGameCenterAchievementLocalization('ver-real', {
      locale: 'en-US',
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    });

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toContain('/v2/gameCenterAchievementLocalizations');

    const requestDocument = readRequestDocument(init);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes']);

    expect(documentAt).toEqual({
      locale: 'en-US',
      name: 'First Win',
      beforeEarnedDescription: 'Win a game',
      afterEarnedDescription: 'You won!',
    });
    expect(documentValueAt(requestDocument, ['data', 'relationships', 'version', 'data'])).toEqual({
      type: 'gameCenterAchievementVersions',
      id: 'ver-real',
    });
  }

  it(
    'attaches an achievement localization to the version',
    attachesAnAchievementLocalizationToTheVersion,
  );

  async function createsAV2LeaderboardWithItsAttributesAndAnInlineVersion() {
    const serialized = JSON.stringify({
      data: {
        id: 'lb-1',
        relationships: {
          versions: { data: [{ type: 'gameCenterLeaderboardVersions', id: 'lv-real' }] },
        },
      },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const createdResource = await client.createGameCenterLeaderboard('gc-1', {
      referenceName: 'High Score',
      vendorIdentifier: 'high_score',
      defaultFormatter: 'INTEGER',
      submissionType: 'BEST_SCORE',
      scoreSortType: 'DESC',
    });
    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);
    const documentAt = documentValueAt(requestDocument, ['data', 'attributes', 'defaultFormatter']);

    expect(documentAt).toBe('INTEGER');
    expect(documentValueAt(requestDocument, ['data', 'attributes', 'scoreSortType'])).toBe('DESC');
    expect(
      documentValueAt(requestDocument, ['data', 'relationships', 'versions', 'data', 0, 'id']),
    ).toBe('${version-0}');
    expect(documentValueAt(requestDocument, ['included', 0])).toEqual({
      type: 'gameCenterLeaderboardVersions',
      id: '${version-0}',
    });
    expect(createdResource).toEqual({ id: 'lb-1', versionId: 'lv-real' });
  }

  it(
    'creates a V2 leaderboard with its attributes and an inline version',
    createsAV2LeaderboardWithItsAttributesAndAnInlineVersion,
  );
}

describe('Game Center', describeGameCenter);
function describeDescribeErrors() {
  function joinsAppleSErrorDetailsFallingBackToTitles() {
    const serialized = JSON.stringify({ errors: [{ detail: 'd1' }, { title: 't2' }] });
    const errors = describeErrors(serialized);
    expect(errors).toBe('d1; t2');
  }

  it(
    "joins Apple's error details, falling back to titles",
    joinsAppleSErrorDetailsFallingBackToTitles,
  );

  function returnsThePiecePieceWhenItIsnTJSONAndAPlaceholderWhenEmpty() {
    const errors = describeErrors('plain text failure');
    expect(errors).toBe('plain text failure');
    expect(describeErrors('')).toBe('no response body');
  }

  it(
    "returns the raw body when it isn't JSON, and a placeholder when empty",
    returnsThePiecePieceWhenItIsnTJSONAndAPlaceholderWhenEmpty,
  );

  function includesAppleSAssociatedValidationErrorsWithTheirResourcePath() {
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
    const errors = describeErrors(requestDocument);

    expect(errors).toBe(
      "This resource cannot be reviewed, please check associated errors to see why.; associated /v1/appInfos/info1: You must provide a value for the relationship 'primaryCategory'.; associated /v1/appEncryptionDeclarations/decl1: You must answer the regulated medical device declaration.",
    );
  }

  it(
    "includes Apple's associated validation errors with their resource path",
    includesAppleSAssociatedValidationErrorsWithTheirResourcePath,
  );
}

describe('describeErrors', describeDescribeErrors);
function describeParseErrorCodes() {
  function extractsAppleSMachineReadableErrorCodes() {
    const requestDocument = JSON.stringify({
      errors: [{ code: 'FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED' }, { code: 'X' }],
    });
    const errorCodes = parseErrorCodes(requestDocument);

    expect(errorCodes).toEqual(['FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED', 'X']);
  }

  it("extracts Apple's machine-readable error codes", extractsAppleSMachineReadableErrorCodes);

  function returnsAnEmptyListForANonJSONOrErrorlessPiece() {
    const errorCodes = parseErrorCodes('not json');
    expect(errorCodes).toEqual([]);
    const serialized = JSON.stringify({ data: [] });
    expect(parseErrorCodes(serialized)).toEqual([]);
  }

  it(
    'returns an empty list for a non-JSON or errorless body',
    returnsAnEmptyListForANonJSONOrErrorlessPiece,
  );
}

describe('parseErrorCodes', describeParseErrorCodes);
function describeClockSkewHint() {
  // A fixed reference instant so the skew math is deterministic regardless of when the suite runs.
  const APPLE_DATE = 'Sun, 15 Jun 2026 12:00:00 GMT';
  const APPLE_MS = Date.parse(APPLE_DATE);

  function flagsAFastMacClockWithTheDriftAndTheResyncCommand() {
    const hint = clockSkewHint({
      appleDate: APPLE_DATE,
      nowMs: APPLE_MS + 5 * 60000,
      platform: 'darwin',
    });

    expect(hint).toContain('~5 minutes');
    expect(hint).toContain('sudo sntp -sS time.apple.com');
  }

  it(
    'flags a fast Mac clock with the drift and the resync command',
    flagsAFastMacClockWithTheDriftAndTheResyncCommand,
  );

  function flagsASlowClockTooDriftIsAbsoluteInSecondsUnderTwoMinutes() {
    const hint = clockSkewHint({
      appleDate: APPLE_DATE,
      nowMs: APPLE_MS - 90000,
      platform: 'darwin',
    });

    expect(hint).toContain('~90 seconds');
  }

  it(
    'flags a slow clock too (drift is absolute), in seconds under two minutes',
    flagsASlowClockTooDriftIsAbsoluteInSecondsUnderTwoMinutes,
  );

  function staysSilentWhenTheDriftIsWithinTolerance() {
    expect(
      clockSkewHint({ appleDate: APPLE_DATE, nowMs: APPLE_MS + 30000, platform: 'darwin' }),
    ).toBe('');
  }

  it('stays silent when the drift is within tolerance', staysSilentWhenTheDriftIsWithinTolerance);

  function staysSilentOffMacOSEvenWithAWildClockNoSntpSpamOnOtherPlatforms() {
    const wild = APPLE_MS + 60 * 60000;
    expect(clockSkewHint({ appleDate: APPLE_DATE, nowMs: wild, platform: 'linux' })).toBe('');
    expect(clockSkewHint({ appleDate: APPLE_DATE, nowMs: wild, platform: 'win32' })).toBe('');
  }

  it(
    'stays silent off macOS, even with a wild clock - no sntp spam on other platforms',
    staysSilentOffMacOSEvenWithAWildClockNoSntpSpamOnOtherPlatforms,
  );

  function staysSilentWhenAppleSentNoUsableDateHeader() {
    expect(
      clockSkewHint({ appleDate: null, nowMs: APPLE_MS + 60 * 60000, platform: 'darwin' }),
    ).toBe('');
    expect(clockSkewHint({ appleDate: 'not-a-date', nowMs: APPLE_MS, platform: 'darwin' })).toBe(
      '',
    );
  }

  it(
    'stays silent when Apple sent no usable Date header',
    staysSilentWhenAppleSentNoUsableDateHeader,
  );
}

describe('clockSkewHint', describeClockSkewHint);
function describeAppStoreConnectClient401ClockSkewEnrichment() {
  async function appendsTheResyncHintWhenA401CoincidesWithASkewedClockOnMacOS() {
    client = new AppStoreConnectClient(makeKey(), 'darwin');

    const skewedDate = new Date(Date.now() + 10 * 60000).toUTCString();

    function mockImplementationPiece3() {
      const serialized = JSON.stringify({ errors: [{ detail: 'token expired' }] });
      const fakeReply = fakeResponse(401, serialized, {
        date: skewedDate,
      });

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationPiece3);
    await expect(client.assertReady()).rejects.toThrow(
      /401.*token expired.*sudo sntp -sS time\.apple\.com/,
    );
  }

  it(
    'appends the resync hint when a 401 coincides with a skewed clock (on macOS)',
    appendsTheResyncHintWhenA401CoincidesWithASkewedClockOnMacOS,
  );

  async function surfacesOnlyAppleS401DetailWhenTheClockIsFineNoFalseAlarm() {
    client = new AppStoreConnectClient(makeKey(), 'darwin');

    function mockImplementationPiece4() {
      const serialized = JSON.stringify({ errors: [{ detail: 'token expired' }] });
      const fakeReply = fakeResponse(401, serialized, {
        date: new Date().toUTCString(),
      });

      return Promise.resolve(fakeReply);
    }

    fetchMock.mockImplementation(mockImplementationPiece4);

    let message = '';

    try {
      await client.assertReady();
    } catch (error) {
      if (error instanceof Error) message = error.message;
      else message = String(error);
    }

    expect(message).toContain('token expired');
    expect(message).not.toContain('sudo sntp');
  }

  it(
    "surfaces only Apple's 401 detail when the clock is fine - no false alarm",
    surfacesOnlyAppleS401DetailWhenTheClockIsFineNoFalseAlarm,
  );
}

describe(
  'AppStoreConnectClient - 401 clock-skew enrichment',
  describeAppStoreConnectClient401ClockSkewEnrichment,
);
function describeAppStoreConnectClientAppStoreReleaseLifecycle() {
  async function listsRecentBuildsWithProcessingPieceAndExpiryNewestUploadFirst() {
    const serialized = JSON.stringify({
      data: [{ id: 'b1', attributes: { version: '42', processingState: 'VALID', expired: false } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const builds = await client.listBuilds('app1');

    expect(builds[0]).toEqual({
      id: 'b1',
      version: '42',
      processingState: 'VALID',
      expired: false,
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain('/builds?filter[app]=app1&sort=-uploadedDate');
  }

  it(
    'lists recent builds with processing state and expiry, newest upload first',
    listsRecentBuildsWithProcessingPieceAndExpiryNewestUploadFirst,
  );

  async function readsEachBuildSMarketingVersionFromItsIncludedPreReleaseVersion() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const promotedBuild = await client.findBuildByVersion('app1', 591);

    expect(promotedBuild).toEqual({
      id: 'b591',
      version: '591',
      processingState: 'VALID',
      expired: false,
      marketingVersion: '6.11.77',
    });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(arrayElement[0]).toContain(
      'filter[version]=591&sort=-uploadedDate&limit=1&fields[builds]=version,processingState,uploadedDate,expired,preReleaseVersion&include=preReleaseVersion',
    );
  }

  it(
    "reads each build's marketing version from its included pre-release version",
    readsEachBuildSMarketingVersionFromItsIncludedPreReleaseVersion,
  );

  async function declaresExportComplianceWithAPATCHToTheBuild() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.setBuildUsesNonExemptEncryption('b1', false);

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('PATCH');
    expect(url).toContain('/builds/b1');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: { type: 'builds', id: 'b1', attributes: { usesNonExemptEncryption: false } },
    });
  }

  it(
    'declares export compliance with a PATCH to the build',
    declaresExportComplianceWithAPATCHToTheBuild,
  );

  async function createsAnAppStoreVersionWithTheAppRelationshipAndReleaseType() {
    const serialized = JSON.stringify({
      data: {
        id: 'v1',
        attributes: { versionString: '1.2.0', appStoreState: 'PREPARE_FOR_SUBMISSION' },
      },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: '1.2.0', releaseType: 'AFTER_APPROVAL' },
        relationships: { app: { data: { type: 'apps', id: 'app1' } } },
      },
    });
  }

  it(
    'creates an App Store version with the app relationship and release type',
    createsAnAppStoreVersionWithTheAppRelationshipAndReleaseType,
  );

  async function attachesABuildViaTheRelationshipsBuildPATCH() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.selectBuildForVersion('v1', 'b1');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appStoreVersions/v1/relationships/build');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toEqual({ data: { type: 'builds', id: 'b1' } });
  }

  it(
    'attaches a build via the relationships/build PATCH',
    attachesABuildViaTheRelationshipsBuildPATCH,
  );

  async function opensAReviewSubmissionAddsTheVersionAsAnPieceAndSubmitsIt() {
    const serialized = JSON.stringify({
      data: { id: 'rs1', attributes: { state: 'READY_FOR_REVIEW' } },
    });
    const fakeReply = fakeResponse(201, serialized);

    fetchMock
      .mockResolvedValueOnce(fakeReply)
      .mockResolvedValueOnce(
        fakeResponse(201, JSON.stringify({ data: { id: 'item1', attributes: {} } })),
      )
      .mockResolvedValueOnce(fakeResponse(204, ''));

    const submission = await client.createReviewSubmission('app1', 'IOS');

    expect(submission).toEqual({ id: 'rs1', state: 'READY_FOR_REVIEW' });
    await client.addReviewSubmissionItem('rs1', 'v1');
    await client.submitReviewSubmission('rs1');

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const requestDocument = readRequestDocument(arrayElement[1]);

    expect(requestDocument).toMatchObject({
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
  }

  it(
    'opens a review submission, adds the version as an item, and submits it',
    opensAReviewSubmissionAddsTheVersionAsAnPieceAndSubmitsIt,
  );

  async function returnsNullForAPhasedReleaseThatDoesnTExist404OrEmptyRelationship() {
    const serialized = JSON.stringify({ errors: [{ title: 'Not Found' }] });
    const fakeReply = fakeResponse(404, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.getPhasedRelease('v1')).toBeNull();
    fetchMock.mockResolvedValueOnce(fakeResponse(200, JSON.stringify({ data: null })));
    expect(await client.getPhasedRelease('v2')).toBeNull();
  }

  it(
    "returns null for a phased release that doesn't exist (404 or empty relationship)",
    returnsNullForAPhasedReleaseThatDoesnTExist404OrEmptyRelationship,
  );

  async function propagatesANon404FailureOnAnOptionalReadInsteadOfSwallowingItAsAbsent() {
    // The shared 404-as-absent path (getOptional) must only catch 404s - any other status is a real failure
    // that has to surface, not be misread as "no phased release". A 403 is non-retryable (isRetryableAscError
    // covers only 429/5xx), so it rejects on the first attempt with no backoff and still carries the status.
    const serialized = JSON.stringify({ errors: [{ title: 'Forbidden' }] });
    const fakeReply = fakeResponse(403, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await expect(client.getPhasedRelease('v3')).rejects.toThrow(/403/);
  }

  it(
    "propagates a non-404 failure on an optional read instead of swallowing it as 'absent'",
    propagatesANon404FailureOnAnOptionalReadInsteadOfSwallowingItAsAbsent,
  );

  async function steersAPhasedReleaseWithAPiecePATCH() {
    const fakeReply = fakeResponse(204, '');

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.updatePhasedRelease('ph1', 'PAUSE');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(init.method).toBe('PATCH');
    expect(url).toContain('/appStoreVersionPhasedReleases/ph1');

    const requestDocument = readRequestDocument(init);

    expect(requestDocument).toMatchObject({
      data: {
        type: 'appStoreVersionPhasedReleases',
        id: 'ph1',
        attributes: { phasedReleaseState: 'PAUSE' },
      },
    });
  }

  it('steers a phased release with a state PATCH', steersAPhasedReleaseWithAPiecePATCH);
}

describe(
  'AppStoreConnectClient - App Store release lifecycle',
  describeAppStoreConnectClientAppStoreReleaseLifecycle,
);
function describeAppStoreConnectClientTestFlightBetaFeedback() {
  async function parsesCrashSubmissionsAndResolvesTheBuildVersionFromTheIncludedBuilds() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

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
    const asString = String(url);

    expect(asString).toContain('/apps/app1/betaFeedbackCrashSubmissions?include=build');

    const string = String(url);

    expect(string).toContain('sort=-createdDate');
  }

  it(
    'parses crash submissions and resolves the build version from the included builds',
    parsesCrashSubmissionsAndResolvesTheBuildVersionFromTheIncludedBuilds,
  );

  async function parsesScreenshotSubmissionsKeepingOnlyAttachmentsWithAUsableURL() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const shots = await client.listBetaFeedbackScreenshotSubmissions('app1');

    expect(shots).toEqual([
      {
        id: 's1',
        buildVersion: '7',
        screenshots: [{ url: 'https://a/1.png', width: 100, height: 200 }],
      },
    ]);
  }

  it(
    'parses screenshot submissions, keeping only attachments with a usable URL',
    parsesScreenshotSubmissionsKeepingOnlyAttachmentsWithAUsableURL,
  );

  async function omitsTheNullCommentEmailAndDeviceFieldsOfAnAnonymousSubmission() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.listBetaFeedbackScreenshotSubmissions('app1')).toEqual([
      { id: 's2', createdDate: '2026-06-21T00:00:00Z', screenshots: [] },
    ]);
  }

  it(
    'omits the null comment, email and device fields of an anonymous submission',
    omitsTheNullCommentEmailAndDeviceFieldsOfAnAnonymousSubmission,
  );

  async function pushesFilterBuildWhenABuildIdIsGiven() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    await client.listBetaFeedbackCrashSubmissions('app1', { buildId: 'b9' });

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toContain('filter[build]=b9');
  }

  it('pushes filter[build] when a build id is given', pushesFilterBuildWhenABuildIdIsGiven);

  async function downloadsAScreenshotFromItsPresignedURLWithoutAnAuthorizationHeader() {
    const fakeBinary = fakeBinaryResponse(200, 'imgbytes');

    fetchMock.mockResolvedValueOnce(fakeBinary);

    const bytes = await client.downloadBetaFeedbackScreenshot('https://apple.example/shot.png');

    expect(bytes.toString()).toBe('imgbytes');

    const [url, init] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');

    expect(url).toBe('https://apple.example/shot.png');
    expect(init).toBeUndefined();
  }

  it(
    'downloads a screenshot from its presigned URL without an Authorization header',
    downloadsAScreenshotFromItsPresignedURLWithoutAnAuthorizationHeader,
  );
}

describe(
  'AppStoreConnectClient - TestFlight beta feedback',
  describeAppStoreConnectClientTestFlightBetaFeedback,
);
function describeFindBundleIdExactIdentifierNotSubstring291() {
  async function selectsTheExactIdentifierWhenTheSubstringFilterAlsoReturnsChildBundleIds() {
    // Apple's filter[identifier] is a substring match, so a query for the main bundle also returns its
    // widget - and it can come back first. The exact row must win, never data[0].
    const serialized = JSON.stringify({
      data: [
        { id: 'widget-res', attributes: { identifier: 'com.example.sampleapp.widget' } },
        {
          id: 'main-res',
          attributes: { identifier: 'com.example.sampleapp', seedId: 'TEAM01' },
        },
      ],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

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
  }

  it(
    'selects the exact identifier when the substring filter also returns child bundle ids',
    selectsTheExactIdentifierWhenTheSubstringFilterAlsoReturnsChildBundleIds,
  );

  async function returnsNullWhenOnlySubstringSiblingsPieceTheBundleItselfIsUnregistered() {
    const serialized = JSON.stringify({
      data: [{ id: 'widget-res', attributes: { identifier: 'com.example.sampleapp.widget' } }],
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);
    expect(await client.findBundleId('com.example.sampleapp')).toBeNull();
  }

  it(
    'returns null when only substring siblings match (the bundle itself is unregistered)',
    returnsNullWhenOnlySubstringSiblingsPieceTheBundleItselfIsUnregistered,
  );
}

describe(
  'findBundleId - exact identifier, not substring (#291)',
  describeFindBundleIdExactIdentifierNotSubstring291,
);

describe('AppStoreConnectClient - app store versions', () => {
  async function readsTheAttachedBuildIdFromTheBuildRelationshipAndAsksAppleForIt() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const versions = await client.listAppStoreVersions('app1', 'IOS');
    const [requestUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(requestUrl);

    expect(asString).toContain(
      'fields[appStoreVersions]=versionString,appStoreState,releaseType,build',
    );

    const arrayElement = expectArrayElement(versions, 0, 'version');

    expect(arrayElement.attachedBuildId).toBe('b-42');
    expect(expectArrayElement(versions, 1, 'version').attachedBuildId).toBeUndefined();
  }

  it(
    'reads the attached build id from the build relationship, and asks Apple for it',
    readsTheAttachedBuildIdFromTheBuildRelationshipAndAsksAppleForIt,
  );

  async function readsTheAttachedBuildNumberAndProcessingPieceFromTheIncludedBuild() {
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const versions = await client.listAppStoreVersions('app1', 'IOS');
    const arrayElement = expectArrayElement(versions, 0, 'version');

    expect(arrayElement).toMatchObject({
      attachedBuildNumber: '42',
      attachedBuildProcessingState: 'VALID',
    });
  }

  it(
    'reads the attached build number and processing state from the included build',
    readsTheAttachedBuildNumberAndProcessingPieceFromTheIncludedBuild,
  );

  it('keeps each attached build number when the versions span two pages', async () => {
    const page2Url =
      'https://api.appstoreconnect.apple.com/v1/apps/app1/appStoreVersions?cursor=page-2';
    const serialized = JSON.stringify({
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
    });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply).mockResolvedValueOnce(
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

    const arrayElement = expectArrayElement(fetchMock.mock.calls, 1, 'mock call');
    const asString = String(arrayElement[0]);

    expect(asString).toBe(page2Url);
  });

  async function asksAppleForTheBuildOfOneMarketingVersionNewestUploadFirst() {
    const serialized = JSON.stringify({ data: [] });
    const fakeReply = fakeResponse(200, serialized);

    fetchMock.mockResolvedValueOnce(fakeReply);

    const storeBuild = await client.findBuildByVersion('app1', 9, '1.2.0');

    const [requestUrl] = expectArrayElement(fetchMock.mock.calls, 0, 'mock call');
    const asString = String(requestUrl);

    expect(asString).toContain(
      'filter[version]=9&filter[preReleaseVersion.version]=1.2.0&sort=-uploadedDate&limit=1',
    );
    expect(storeBuild).toBeNull();
  }

  it(
    'asks Apple for the build of one marketing version, newest upload first',
    asksAppleForTheBuildOfOneMarketingVersionNewestUploadFirst,
  );
});
