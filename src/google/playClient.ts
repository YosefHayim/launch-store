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
 * Region snapshot the subscriptions monetization API pins prices against — a required query parameter on
 * every subscription/offer write. `2022/02` is Google's current published version; bump it here if Google
 * retires it (the API rejects an unsupported value with an actionable message).
 */
const REGIONS_VERSION = "2022/02";

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

/** A price in a currency's micro-units — Play's money shape (`priceMicros` + ISO `currency`). */
export interface PlayMoney {
  priceMicros?: string;
  currency?: string;
}

/**
 * A Play in-app **managed product** (`inappproducts`) — the slice Launch reconciles. `purchaseType` is
 * `managedUser` for one-time products (subscriptions use a separate API). `listings` is keyed by locale.
 */
export interface InAppProductResource {
  sku: string;
  status?: string;
  purchaseType?: string;
  defaultLanguage?: string;
  defaultPrice?: PlayMoney;
  /** Region code (e.g. `US`) → price. */
  prices?: Record<string, PlayMoney>;
  /** Locale (e.g. `en-US`) → listing copy. */
  listings?: Record<string, { title?: string; description?: string }>;
}

/**
 * Money in the **subscriptions** monetization API. Unlike {@link PlayMoney} (in-app products, which use
 * `priceMicros`), subscriptions express amounts as whole `units` plus `nanos` (billionths) alongside the
 * ISO currency — Google's standard `Money` type. `units: "1", nanos: 990000000` is 1.99.
 */
export interface PlayMoneyUnits {
  currencyCode: string;
  /** Whole units of the currency, as a string integer (Google encodes int64 as a string). */
  units: string;
  /** Fractional units in billionths (0–999,999,999). */
  nanos: number;
}

/** One locale's store copy for a Play subscription (`languageCode` is the natural key). */
export interface SubscriptionListing {
  languageCode: string;
  title: string;
  description: string;
  benefits?: string[];
}

/** Per-region price + new-subscriber availability for a base plan. */
export interface RegionalBasePlanConfig {
  regionCode: string;
  newSubscriberAvailability?: boolean;
  price?: PlayMoneyUnits;
}

/** Auto-renewing base-plan settings; `billingPeriodDuration` is an ISO-8601 duration like `P1M`. */
export interface AutoRenewingBasePlanType {
  billingPeriodDuration: string;
}

/**
 * One billing plan under a subscription. `state` (DRAFT/ACTIVE/INACTIVE) is read-only — Launch flips a
 * fresh base plan live with the separate activate endpoint, not by writing this field.
 */
export interface BasePlan {
  basePlanId: string;
  state?: string;
  autoRenewingBasePlanType?: AutoRenewingBasePlanType;
  regionalConfigs?: RegionalBasePlanConfig[];
  offerTags?: { tag: string }[];
}

/** A Play subscription product (`monetization.subscriptions`) — the product, its listings, and base plans. */
export interface SubscriptionResource {
  packageName?: string;
  productId: string;
  basePlans?: BasePlan[];
  listings?: SubscriptionListing[];
}

/** Offer-level new-subscriber availability for one region (must be a subset of the base plan's regions). */
export interface RegionalSubscriptionOfferConfig {
  regionCode: string;
  newSubscriberAvailability?: boolean;
}

/** One region's pricing inside an offer phase: either a fixed `price` or `free` (an empty object). */
export interface OfferPhaseRegionalConfig {
  regionCode: string;
  price?: PlayMoneyUnits;
  free?: Record<string, never>;
}

/** One phase of a subscription offer — e.g. a free trial or an introductory price for N billing periods. */
export interface SubscriptionOfferPhase {
  /** How many billing periods this phase repeats for. */
  recurrenceCount: number;
  /** Phase length as an ISO-8601 duration (e.g. `P1W`); omitted when it tracks the base plan's period. */
  duration?: string;
  regionalConfigs: OfferPhaseRegionalConfig[];
}

/**
 * A subscription offer (`monetization.subscriptions.basePlans.offers`). `state` is read-only (activated
 * via the separate endpoint). Every region in {@link SubscriptionOfferResource.regionalConfigs} must also
 * appear in each phase's `regionalConfigs`, or Play rejects the offer.
 */
export interface SubscriptionOfferResource {
  packageName?: string;
  productId?: string;
  basePlanId?: string;
  offerId: string;
  state?: string;
  phases: SubscriptionOfferPhase[];
  regionalConfigs: RegionalSubscriptionOfferConfig[];
  offerTags?: { tag: string }[];
}

/**
 * One Play customer review, flattened from the API's `comments[]` shape into the slice Launch shows. A
 * Play review nests the user's comment and any developer reply under `comments`; this lifts the rating,
 * text, and reply to the top level. `answered` is true when a developer reply already exists.
 *
 * NOTE: the Play reviews API only returns reviews that have **text** and were created/updated in roughly
 * the **last week**, and replies are allowed only within that window — surfaced as a Play error otherwise.
 */
export interface PlayReview {
  reviewId: string;
  authorName?: string;
  /** Star rating 1–5 (0 if the review carries no user comment). */
  rating: number;
  /** The user's review text, in the requested translation language when one was passed. */
  text?: string;
  reviewerLanguage?: string;
  device?: string;
  appVersionName?: string;
  /** ISO-8601 timestamp the user last edited the review. */
  lastModified?: string;
  /** Whether a developer reply already exists (the Play twin of a review being "answered"). */
  answered: boolean;
  /** The current developer reply text, when one exists. */
  developerReply?: string;
}

/** Outcome of replying to a review: the stored reply text and when it was last edited. */
export interface PlayReplyResult {
  replyText: string;
  /** ISO-8601 timestamp Play recorded for the reply. */
  lastEdited?: string;
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

/** Google's epoch-seconds timestamp; lifted to ISO-8601 for display. */
interface PlayTimestamp {
  seconds?: string;
  nanos?: number;
}

/** Raw `userComment` from the reviews API — the subset Launch reads. */
interface RawUserComment {
  text?: string;
  starRating?: number;
  reviewerLanguage?: string;
  device?: string;
  appVersionName?: string;
  lastModified?: PlayTimestamp;
}

/** Raw `developerComment` (the existing reply) from the reviews API. */
interface RawDeveloperComment {
  text?: string;
  lastModified?: PlayTimestamp;
}

/** One entry in a review's `comments[]`: either the user's comment or the developer's reply. */
interface RawReviewComment {
  userComment?: RawUserComment;
  developerComment?: RawDeveloperComment;
}

/** Raw review as the API returns it, before flattening into {@link PlayReview}. */
interface RawReview {
  reviewId: string;
  authorName?: string;
  comments?: RawReviewComment[];
}

/** Lift Google's epoch-seconds timestamp to ISO-8601, or undefined when absent. */
function timestampToIso(timestamp: PlayTimestamp | undefined): string | undefined {
  return timestamp?.seconds ? new Date(Number(timestamp.seconds) * 1000).toISOString() : undefined;
}

/** Flatten a raw review's nested comments into the {@link PlayReview} slice Launch shows. */
function normalizeReview(raw: RawReview): PlayReview {
  const user = raw.comments?.find((comment) => comment.userComment)?.userComment;
  const developer = raw.comments?.find((comment) => comment.developerComment)?.developerComment;
  const review: PlayReview = {
    reviewId: raw.reviewId,
    rating: user?.starRating ?? 0,
    answered: developer !== undefined,
  };
  if (raw.authorName) review.authorName = raw.authorName;
  if (user?.text) review.text = user.text;
  if (user?.reviewerLanguage) review.reviewerLanguage = user.reviewerLanguage;
  if (user?.device) review.device = user.device;
  if (user?.appVersionName) review.appVersionName = user.appVersionName;
  const lastModified = timestampToIso(user?.lastModified);
  if (lastModified) review.lastModified = lastModified;
  if (developer?.text) review.developerReply = developer.text;
  return review;
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

  /**
   * List the app's in-app **managed products** (`inappproducts`). Not edit-scoped — the products API is a
   * direct CRUD surface (unlike tracks/listings). Pages through Google's token pagination in full.
   */
  async listInAppProducts(packageName: string): Promise<InAppProductResource[]> {
    const products: InAppProductResource[] = [];
    let token: string | undefined;
    do {
      const query = token ? `?token=${encodeURIComponent(token)}` : "";
      const page = await this.request<{
        inappproduct?: InAppProductResource[];
        tokenPagination?: { nextPageToken?: string };
      }>("GET", `/applications/${encodeURIComponent(packageName)}/inappproducts${query}`);
      products.push(...(page.inappproduct ?? []));
      token = page.tokenPagination?.nextPageToken;
    } while (token);
    return products;
  }

  /** Create a new in-app managed product (POST). The product's `sku` lives in the body. */
  async insertInAppProduct(packageName: string, product: InAppProductResource): Promise<void> {
    await this.request<unknown>("POST", `/applications/${encodeURIComponent(packageName)}/inappproducts`, {
      ...product,
      packageName,
    });
  }

  /** Update an existing in-app managed product by SKU (PUT). */
  async updateInAppProduct(packageName: string, product: InAppProductResource): Promise<void> {
    await this.request<unknown>(
      "PUT",
      `/applications/${encodeURIComponent(packageName)}/inappproducts/${encodeURIComponent(product.sku)}`,
      { ...product, packageName },
    );
  }

  /** Base path for an app's subscription monetization resources. */
  private subscriptionsPath(packageName: string): string {
    return `/applications/${encodeURIComponent(packageName)}/subscriptions`;
  }

  /** List the app's subscription products (`monetization.subscriptions`), paging in full. */
  async listSubscriptions(packageName: string): Promise<SubscriptionResource[]> {
    const subscriptions: SubscriptionResource[] = [];
    let token: string | undefined;
    do {
      const query = token ? `?pageToken=${encodeURIComponent(token)}` : "";
      const page = await this.request<{ subscriptions?: SubscriptionResource[]; nextPageToken?: string }>(
        "GET",
        `${this.subscriptionsPath(packageName)}${query}`,
      );
      subscriptions.push(...(page.subscriptions ?? []));
      token = page.nextPageToken;
    } while (token);
    return subscriptions;
  }

  /**
   * Create a subscription with its base plans (which Play creates in DRAFT — activate them separately).
   * `regionsVersion.version` is required; the product id rides both the query and the body.
   */
  async createSubscription(packageName: string, subscription: SubscriptionResource): Promise<void> {
    const query = `?productId=${encodeURIComponent(subscription.productId)}&regionsVersion.version=${REGIONS_VERSION}`;
    await this.request<unknown>("POST", `${this.subscriptionsPath(packageName)}${query}`, {
      ...subscription,
      packageName,
    });
  }

  /**
   * Patch a subscription's masked fields (PATCH with an `updateMask` — Play requires field-level updates).
   * The masked fields are *replaced* by what's in `subscription`, so the reconciler sends a merged value
   * (e.g. existing listings + the changed ones) to stay additive.
   */
  async patchSubscription(packageName: string, subscription: SubscriptionResource, updateMask: string): Promise<void> {
    const query = `?updateMask=${encodeURIComponent(updateMask)}&regionsVersion.version=${REGIONS_VERSION}`;
    await this.request<unknown>(
      "PATCH",
      `${this.subscriptionsPath(packageName)}/${encodeURIComponent(subscription.productId)}${query}`,
      { ...subscription, packageName },
    );
  }

  /** Activate a base plan (DRAFT → ACTIVE), making it purchasable. Idempotent on an already-active plan. */
  async activateBasePlan(packageName: string, productId: string, basePlanId: string): Promise<void> {
    await this.request<unknown>(
      "POST",
      `${this.subscriptionsPath(packageName)}/${encodeURIComponent(productId)}/basePlans/${encodeURIComponent(basePlanId)}:activate`,
      { packageName, productId, basePlanId },
    );
  }

  /** List the offers on one base plan, paging in full. */
  async listSubscriptionOffers(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Promise<SubscriptionOfferResource[]> {
    const base = `${this.subscriptionsPath(packageName)}/${encodeURIComponent(productId)}/basePlans/${encodeURIComponent(basePlanId)}/offers`;
    const offers: SubscriptionOfferResource[] = [];
    let token: string | undefined;
    do {
      const query = token ? `?pageToken=${encodeURIComponent(token)}` : "";
      const page = await this.request<{ subscriptionOffers?: SubscriptionOfferResource[]; nextPageToken?: string }>(
        "GET",
        `${base}${query}`,
      );
      offers.push(...(page.subscriptionOffers ?? []));
      token = page.nextPageToken;
    } while (token);
    return offers;
  }

  /** Create a subscription offer (in DRAFT — activate it separately). `regionsVersion.version` is required. */
  async createSubscriptionOffer(packageName: string, offer: SubscriptionOfferResource): Promise<void> {
    const productId = offer.productId ?? "";
    const basePlanId = offer.basePlanId ?? "";
    const base = `${this.subscriptionsPath(packageName)}/${encodeURIComponent(productId)}/basePlans/${encodeURIComponent(basePlanId)}/offers`;
    const query = `?offerId=${encodeURIComponent(offer.offerId)}&regionsVersion.version=${REGIONS_VERSION}`;
    await this.request<unknown>("POST", `${base}${query}`, { ...offer, packageName });
  }

  /** Activate a subscription offer (DRAFT → ACTIVE), making it available. */
  async activateSubscriptionOffer(
    packageName: string,
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Promise<void> {
    const base = `${this.subscriptionsPath(packageName)}/${encodeURIComponent(productId)}/basePlans/${encodeURIComponent(basePlanId)}/offers/${encodeURIComponent(offerId)}:activate`;
    await this.request<unknown>("POST", base, { packageName, productId, basePlanId, offerId });
  }

  /**
   * List the app's customer reviews (flattened to {@link PlayReview}), paging in full. `translationLanguage`
   * asks Play to machine-translate review text into that BCP-47 language. Only reviews with text from the
   * last ~week are returned — a Play platform limit, not Launch's.
   */
  async listReviews(packageName: string, options: { translationLanguage?: string } = {}): Promise<PlayReview[]> {
    const reviews: PlayReview[] = [];
    let token: string | undefined;
    do {
      const params = new URLSearchParams();
      if (options.translationLanguage) params.set("translationLanguage", options.translationLanguage);
      if (token) params.set("token", token);
      const query = params.toString() ? `?${params.toString()}` : "";
      const page = await this.request<{ reviews?: RawReview[]; tokenPagination?: { nextPageToken?: string } }>(
        "GET",
        `/applications/${encodeURIComponent(packageName)}/reviews${query}`,
      );
      for (const raw of page.reviews ?? []) reviews.push(normalizeReview(raw));
      token = page.tokenPagination?.nextPageToken;
    } while (token);
    return reviews;
  }

  /** Fetch one review by id (flattened to {@link PlayReview}), or null when it doesn't exist / is too old. */
  async getReview(packageName: string, reviewId: string): Promise<PlayReview | null> {
    try {
      const raw = await this.request<RawReview>(
        "GET",
        `/applications/${encodeURIComponent(packageName)}/reviews/${encodeURIComponent(reviewId)}`,
      );
      return normalizeReview(raw);
    } catch (error) {
      if (error instanceof Error && error.message.includes("(404)")) return null;
      throw error;
    }
  }

  /**
   * Post (or replace) the public developer reply to a review. Play's reply endpoint is an upsert — it
   * edits an existing reply in place — and only accepts reviews from the last ~week.
   */
  async replyToReview(packageName: string, reviewId: string, replyText: string): Promise<PlayReplyResult> {
    const response = await this.request<{ result?: { replyText?: string; lastEdited?: PlayTimestamp } }>(
      "POST",
      `/applications/${encodeURIComponent(packageName)}/reviews/${encodeURIComponent(reviewId)}:reply`,
      { replyText },
    );
    const result: PlayReplyResult = { replyText: response.result?.replyText ?? replyText };
    const lastEdited = timestampToIso(response.result?.lastEdited);
    if (lastEdited) result.lastEdited = lastEdited;
    return result;
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
