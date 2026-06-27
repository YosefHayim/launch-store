/**
 * Scope-parameterized OAuth2 token source for a Google service account — the shared JWT-bearer engine
 * behind every Google API client Launch talks to.
 *
 * Google's service-account flow signs a short-lived RS256 assertion with the account's private key and
 * exchanges it for an access token (no password, no interactive consent). The *only* thing that varies
 * per API is the OAuth **scope**: `androidpublisher` for the Play Developer API, `playdeveloperreporting`
 * for the vitals/reporting API. This class isolates that single difference so {@link GooglePlayClient}
 * and the Play Developer Reporting client share one minting + caching path instead of copying it.
 *
 * @see https://developers.google.com/identity/protocols/oauth2/service-account
 */

import { SignJWT, importPKCS8 } from 'jose';
import type { ServiceAccount } from './playClient.js';

/** Google rejects assertions older than an hour; 50 minutes leaves comfortable margin. */
const ASSERTION_TTL_SECONDS = 50 * 60;

/** A cached OAuth2 access token plus the epoch-seconds instant it stops being usable. */
interface CachedToken {
  value: string;
  expiresAt: number;
}

/**
 * Mints and caches OAuth2 access tokens for one service account at one scope.
 *
 * One instance is bound to a single `(account, scope)` pair: construct a separate source per API
 * surface (the Play Developer API and the Play Developer Reporting API need different scopes). The
 * token is cached until ~60s before expiry, so back-to-back requests reuse one exchange.
 */
export class ServiceAccountTokenSource {
  private cached: CachedToken | null = null;
  /** A token exchange already in flight, shared by concurrent callers so we mint exactly once. */
  private inflight: Promise<string> | null = null;

  /**
   * @param account the parsed service-account key (issuer email, PKCS#8 private key, token endpoint)
   * @param scope the single OAuth2 scope this source mints tokens for, e.g.
   *   `https://www.googleapis.com/auth/androidpublisher`
   */
  constructor(
    private readonly account: ServiceAccount,
    private readonly scope: string,
  ) {}

  /**
   * Return a valid OAuth2 access token, minting one via the JWT-bearer grant only when the cache is
   * empty or stale. Concurrent callers (e.g. `play-reports vitals` querying crash + ANR in parallel)
   * coalesce onto a single in-flight exchange instead of each hitting Google's token endpoint.
   */
  async token(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.expiresAt - 60 > now) return this.cached.value;
    this.inflight ??= this.mint(now).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Perform the JWT-bearer exchange and populate the cache. Callers reach this only through {@link token}. */
  private async mint(now: number): Promise<string> {
    const privateKey = await importPKCS8(this.account.privateKey, 'RS256');
    const assertion = await new SignJWT({ scope: this.scope })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(this.account.privateKeyId ? { kid: this.account.privateKeyId } : {}),
      })
      .setIssuer(this.account.clientEmail)
      .setSubject(this.account.clientEmail)
      .setAudience(this.account.tokenUri)
      .setIssuedAt(now)
      .setExpirationTime(now + ASSERTION_TTL_SECONDS)
      .sign(privateKey);

    const response = await fetch(this.account.tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Google token exchange failed (${response.status}): ${describeTokenError(text)}`,
      );
    }
    const token = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new Error('Google token exchange returned no access_token.');
    this.cached = { value: token.access_token, expiresAt: now + (token.expires_in ?? 3600) };
    return token.access_token;
  }
}

/** Pull Google's `error`/`error_description` out of a failed token exchange, falling back to raw text. */
function describeTokenError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: string; error_description?: string };
    return parsed.error_description ?? parsed.error ?? body;
  } catch {
    return body.length > 0 ? body : 'no response body';
  }
}
