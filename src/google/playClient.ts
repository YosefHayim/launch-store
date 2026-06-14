/**
 * Google Play Developer API client — the Android twin of {@link AppStoreConnectClient}.
 *
 * Authenticates with a service-account key (the JSON Google Cloud issues) using the OAuth2 JWT-bearer
 * flow: it signs a short-lived RS256 assertion with the account's private key and exchanges it for an
 * access token, exactly as Google's docs require — no password, no interactive consent. That one key
 * drives every Play read Launch needs (latest `versionCode`, track/release status, "does this app
 * exist") plus the error mapping that turns a raw API rejection into an actionable message.
 *
 * Like Apple's missing `POST /v1/apps`, the Play API deliberately CANNOT create an app record — that
 * stays a Play Console UI step. {@link GooglePlayClient.assertAppExists} failing is how Launch detects
 * it's missing. The binary upload stays with fastlane `supply` (it owns the resumable AAB upload), but
 * this client now also **writes** the Play product surface (in-app products, subscriptions, reviews,
 * tracks) directly — see ADR `docs/adr/0001-store-crud-parity.md`, which supersedes the reads-only
 * stance of `docs/plan-android.md` decision 7. Edit-scoped writes (tracks, listings) go through
 * {@link GooglePlayClient.withEdit}, which opens a transactional edit, applies changes, then commits.
 *
 * @see https://developers.google.com/android-publisher
 */

import { SignJWT, importPKCS8 } from "jose";

const BASE_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const OAUTH_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
/** Google rejects assertions older than an hour; 50 minutes leaves comfortable margin. */
const ASSERTION_TTL_SECONDS = 50 * 60;

/**
 * The fields Launch reads out of a Play service-account JSON key.
 *
 * A subset of Google's key file: the robot account's email (the JWT issuer), its PKCS#8 private key
 * (PEM, with real newlines once JSON-parsed), and the token endpoint to exchange the assertion at.
 * `privateKeyId` becomes the JWT `kid` when present. Validated by {@link parseServiceAccount}.
 */
export interface ServiceAccount {
  /** Robot account address, e.g. `launch@my-proj.iam.gserviceaccount.com` — the JWT `iss`/`sub`. */
  clientEmail: string;
  /** PKCS#8 private key PEM used to sign the RS256 assertion. */
  privateKey: string;
  /** OAuth2 token endpoint (`token_uri`); defaults to Google's standard endpoint when absent. */
  tokenUri: string;
  /** Key id (`private_key_id`); set as the JWT `kid` so Google can pick the right public key. */
  privateKeyId?: string;
}

/** A cached OAuth2 access token plus the epoch-seconds instant it stops being usable. */
interface CachedToken {
  value: string;
  expiresAt: number;
}

/** One release within a Play track, as the API returns it (the slice Launch reads). */
export interface PlayRelease {
  /** Human release name, e.g. `1.0.0 (12)`. */
  name?: string;
  /** Version codes bundled into this release. */
  versionCodes?: string[];
  /** `draft` | `inProgress` | `halted` | `completed`. */
  status?: string;
  /** Staged-rollout fraction (0–1) when `status` is `inProgress`. */
  userFraction?: number;
}

/** Raised when a package has no Play app record (or the service account can't reach it). */
export class PlayAppNotFoundError extends Error {
  constructor(packageName: string, detail: string) {
    super(
      `No reachable Play app for ${packageName} — ${detail}. Create it once in Play Console ` +
        `(the API can't), and grant the service account access under Users & Permissions.`,
    );
    this.name = "PlayAppNotFoundError";
  }
}

/**
 * Parse and validate a Play service-account JSON key into a {@link ServiceAccount}.
 *
 * Accepts the file Google Cloud downloads verbatim. Throws a clear, actionable error when the JSON is
 * malformed or missing the two fields Launch can't work without (`client_email`, `private_key`), so a
 * wrong-file import fails up front rather than deep inside a token exchange.
 */
export function parseServiceAccount(json: string): ServiceAccount {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("Service-account key is not valid JSON. Pass the JSON file Google Cloud issued.");
  }
  const clientEmail = typeof raw["client_email"] === "string" ? raw["client_email"] : "";
  const privateKey = typeof raw["private_key"] === "string" ? raw["private_key"] : "";
  if (!clientEmail || !privateKey) {
    throw new Error(
      "Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account " +
        "JSON key (not an OAuth client or an API key).",
    );
  }
  return {
    clientEmail,
    privateKey,
    tokenUri: typeof raw["token_uri"] === "string" ? raw["token_uri"] : "https://oauth2.googleapis.com/token",
    ...(typeof raw["private_key_id"] === "string" ? { privateKeyId: raw["private_key_id"] } : {}),
  };
}

/** Client bound to one Play service account. */
export class GooglePlayClient {
  private cached: CachedToken | null = null;

  constructor(private readonly account: ServiceAccount) {}

  /** Mint (and cache) an OAuth2 access token via the JWT-bearer grant. */
  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.expiresAt - 60 > now) return this.cached.value;

    const privateKey = await importPKCS8(this.account.privateKey, "RS256");
    const assertion = await new SignJWT({ scope: OAUTH_SCOPE })
      .setProtectedHeader({
        alg: "RS256",
        typ: "JWT",
        ...(this.account.privateKeyId ? { kid: this.account.privateKeyId } : {}),
      })
      .setIssuer(this.account.clientEmail)
      .setSubject(this.account.clientEmail)
      .setAudience(this.account.tokenUri)
      .setIssuedAt(now)
      .setExpirationTime(now + ASSERTION_TTL_SECONDS)
      .sign(privateKey);

    const response = await fetch(this.account.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Google token exchange failed (${response.status}): ${describePlayErrors(text)}`);
    }
    const token = JSON.parse(text) as { access_token?: string; expires_in?: number };
    if (!token.access_token) throw new Error("Google token exchange returned no access_token.");
    this.cached = { value: token.access_token, expiresAt: now + (token.expires_in ?? 3600) };
    return token.access_token;
  }

  /**
   * Issue an authenticated request and parse the JSON body. On failure it surfaces Google's own error
   * `message` (e.g. a sensitive-permission rejection) instead of a bare status code, so the CLI can
   * show an actionable message — the Play twin of App Store Connect's `describeErrors`.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Google Play ${method} ${path} failed (${response.status}): ${describePlayErrors(text)}`);
    }
    return JSON.parse(text) as T;
  }

  /** Open a transactional edit (no changes committed); returns its id. A 404 means the app doesn't exist. */
  private async createEdit(packageName: string): Promise<string> {
    const { id } = await this.request<{ id: string }>("POST", `/applications/${encodeURIComponent(packageName)}/edits`);
    return id;
  }

  /** Commit an edit, applying every change made inside it atomically. */
  private async commitEdit(packageName: string, editId: string): Promise<void> {
    await this.request<unknown>("POST", `/applications/${encodeURIComponent(packageName)}/edits/${editId}:commit`);
  }

  /** Abandon an edit so no transaction is left dangling (best-effort; callers ignore failures). */
  private async deleteEdit(packageName: string, editId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/applications/${encodeURIComponent(packageName)}/edits/${editId}`);
  }

  /** Open a throwaway edit for a read, run `read`, then always abandon it (reads never commit). */
  private async withReadEdit<T>(packageName: string, read: (editId: string) => Promise<T>): Promise<T> {
    const editId = await this.createEdit(packageName);
    try {
      return await read(editId);
    } finally {
      await this.deleteEdit(packageName, editId).catch(() => undefined);
    }
  }

  /**
   * Run edit-scoped **writes** transactionally: open an edit, apply changes via `apply`, then COMMIT so
   * they land atomically. On any error the edit is abandoned (rolled back) so a partial change never
   * lands. This is the write twin of {@link withReadEdit} and the foundation the edit-based Play
   * reconcilers (tracks, testers, country availability, listings) build on. Returns whatever `apply`
   * returns. The Play API requires every track/listing change to live inside such an edit.
   */
  async withEdit<T>(packageName: string, apply: (editId: string) => Promise<T>): Promise<T> {
    const editId = await this.createEdit(packageName);
    try {
      const result = await apply(editId);
      await this.commitEdit(packageName, editId);
      return result;
    } catch (error) {
      await this.deleteEdit(packageName, editId).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Return the highest `versionCode` already uploaded for an app, or 0 if none exist yet. The caller
   * bumps this for the next upload (parallels {@link AppStoreConnectClient.getLatestBuildNumber}).
   */
  async getLatestVersionCode(packageName: string): Promise<number> {
    return this.withReadEdit(packageName, async (editId) => {
      const { bundles } = await this.request<{ bundles?: { versionCode?: number }[] }>(
        "GET",
        `/applications/${encodeURIComponent(packageName)}/edits/${editId}/bundles`,
      );
      const codes = (bundles ?? []).map((bundle) => bundle.versionCode ?? 0);
      return codes.length > 0 ? Math.max(...codes) : 0;
    });
  }

  /** Read the releases currently on a track (for status reporting); empty array when the track is unused. */
  async getTrackReleases(packageName: string, track: string): Promise<PlayRelease[]> {
    return this.withReadEdit(packageName, async (editId) => {
      const { releases } = await this.request<{ releases?: PlayRelease[] }>(
        "GET",
        `/applications/${encodeURIComponent(packageName)}/edits/${editId}/tracks/${encodeURIComponent(track)}`,
      );
      return releases ?? [];
    });
  }

  /**
   * Confirm the service account can reach the app's Play record, throwing {@link PlayAppNotFoundError}
   * when it can't — the detect-and-deep-link probe for `launch doctor` (Play can't create the app).
   */
  async assertAppExists(packageName: string): Promise<void> {
    let editId: string;
    try {
      editId = await this.createEdit(packageName);
    } catch (error) {
      throw new PlayAppNotFoundError(packageName, error instanceof Error ? error.message : String(error));
    }
    await this.deleteEdit(packageName, editId).catch(() => undefined);
  }
}

/**
 * Extract Google's human-readable error detail from a failed-response body, falling back to raw text.
 * Recognizes the sensitive/high-risk permission rejection and appends the fix, so the CLI doesn't just
 * echo a 403 — it tells you the release was blocked on a permission declaration.
 */
export function describePlayErrors(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string } | string;
      error_description?: string;
    };
    const error = parsed.error;
    const message =
      (typeof error === "string" ? error : (error?.message ?? error?.status)) ?? parsed.error_description ?? "";
    if (message) {
      if (/permission|sensitive|high.?risk|declaration/i.test(message)) {
        return `${message} — a sensitive/high-risk permission likely needs pre-approval (a Permissions Declaration) in Play Console before this release is accepted.`;
      }
      return message;
    }
  } catch {
    /* not JSON — fall through */
  }
  return body.length > 0 ? body : "no response body";
}
