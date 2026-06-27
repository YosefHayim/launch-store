import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { parseServiceAccount } from './playClient.js';
import { ServiceAccountTokenSource } from './serviceAccountToken.js';

/** A real RSA PKCS#8 key so `jose` can actually sign the assertion. */
function makeAccount() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return parseServiceAccount(
    JSON.stringify({
      client_email: 'launch@proj.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      private_key_id: 'kid-123',
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
  );
}

function fakeResponse(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: () => Promise.resolve(body) };
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload!, 'base64url').toString());
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServiceAccountTokenSource', () => {
  it('mints a JWT-bearer assertion carrying the configured scope', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
    );
    const source = new ServiceAccountTokenSource(
      makeAccount(),
      'https://www.googleapis.com/auth/somescope',
    );

    expect(await source.token()).toBe('tok');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const assertion = (init.body as URLSearchParams).get('assertion')!;
    const payload = decodeJwtPayload(assertion);
    expect(payload['scope']).toBe('https://www.googleapis.com/auth/somescope');
    expect(payload['iss']).toBe('launch@proj.iam.gserviceaccount.com');
    expect(payload['aud']).toBe('https://oauth2.googleapis.com/token');
  });

  it('caches the token across calls (one exchange for back-to-back reads)', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
    );
    const source = new ServiceAccountTokenSource(makeAccount(), 'scope');

    await source.token();
    await source.token();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it('coalesces concurrent callers into a single exchange', async () => {
    fetchMock.mockResolvedValueOnce(
      fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
    );
    const source = new ServiceAccountTokenSource(makeAccount(), 'scope');

    const [first, second] = await Promise.all([source.token(), source.token()]);
    expect(first).toBe('tok');
    expect(second).toBe('tok');
    // Both callers share the one in-flight mint instead of each hitting the token endpoint.
    expect(fetchMock.mock.calls).toHaveLength(1);
  });

  it('re-mints after a failed exchange instead of caching the rejection', async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse(500, 'boom'))
      .mockResolvedValueOnce(
        fakeResponse(200, JSON.stringify({ access_token: 'tok', expires_in: 3600 })),
      );
    const source = new ServiceAccountTokenSource(makeAccount(), 'scope');

    await expect(source.token()).rejects.toThrow(/500/);
    expect(await source.token()).toBe('tok'); // the in-flight guard cleared, so a retry mints fresh
    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it("surfaces Google's error on a failed exchange", async () => {
    fetchMock.mockResolvedValueOnce(fakeResponse(400, JSON.stringify({ error: 'invalid_grant' })));
    const source = new ServiceAccountTokenSource(makeAccount(), 'scope');

    await expect(source.token()).rejects.toThrow(/invalid_grant/);
  });
});
