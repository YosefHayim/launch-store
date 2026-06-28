/**
 * App Store Connect API client.
 *
 * Authenticates with the App Store Connect API key (the `.p8`) by minting a short-lived ES256 JWT,
 * exactly as Apple's docs require — no password, no 2FA. This one key drives every Apple
 * interaction Launch needs: reading build numbers, and the "Certificates, Identifiers & Profiles"
 * automation (register a bundle id, create a distribution certificate from a CSR, create/download a
 * provisioning profile) that replaces the trips you'd otherwise make through the Developer website.
 *
 * Note Apple's API deliberately has NO endpoint to create a new app *record* — that one step stays
 * in the App Store Connect UI. {@link getAppId} returning null is how Launch detects it's missing.
 *
 * @see https://developer.apple.com/documentation/appstoreconnectapi
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { SignJWT, importPKCS8 } from 'jose';
import type { AscKey } from '../core/types.js';
import type { components } from '../core/asc/schema.js';
import { highestVersion } from '../core/version.js';
import { withRetry } from '../core/asyncPool.js';
import type {
  AccessibilityDeclarationResource,
  AccessibilitySupport,
  AgeRatingDeclarationResource,
  AgeRatingValue,
  AlternativeDistributionDomainResource,
  AlternativeDistributionKeyResource,
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
  AppAvailabilityResource,
  AppClipActionValue,
  AppClipDefaultExperienceResource,
  AppClipLocalizationResource,
  AppClipResource,
  AppEventLocalizationInput,
  AppEventLocalizationResource,
  AppEventResource,
  AppInfoResource,
  AppStoreReviewDetailResource,
  AppStoreVersionLocalizationResource,
  AppStoreVersionResource,
  BetaAppReviewSubmissionResource,
  BetaBuildLocalizationResource,
  BetaFeedbackCrashSubmissionResource,
  BetaFeedbackQuery,
  BetaFeedbackScreenshotSubmissionResource,
  BetaFeedbackSubmissionResource,
  BetaGroupResource,
  BetaReviewState,
  BetaTesterResource,
  BuildResource,
  BundleIdCapabilityResource,
  BundleIdResource,
  CapabilitySetting,
  CertificateResource,
  CustomerReviewResource,
  CustomerReviewResponseResource,
  CustomProductPageLocalizationResource,
  CustomProductPageResource,
  CustomProductPageVersionResource,
  DeviceFamily,
  DeviceResource,
  EncryptionDeclarationResource,
  ExperimentTreatmentResource,
  FinanceReportQuery,
  GameCenterAchievementCreate,
  GameCenterAchievementResource,
  GameCenterDetailResource,
  GameCenterLeaderboardCreate,
  GameCenterLeaderboardResource,
  InAppPurchaseResource,
  IntroductoryOfferCreate,
  IntroductoryOfferResource,
  LeaderboardFormatter,
  ListingLocalization,
  LocalizationResource,
  MerchantIdResource,
  NewAppEvent,
  NewUserInvitation,
  OfferCodeCreate,
  OfferCodeResource,
  PassTypeIdResource,
  PhasedReleaseResource,
  PreviewResource,
  PreviewSetResource,
  PricePointResource,
  ProfileResource,
  PromotedPurchaseCreate,
  PromotedPurchaseResource,
  PromotionalOfferCreate,
  PromotionalOfferResource,
  ReviewScreenshotResource,
  ReviewSubmissionResource,
  SalesReportQuery,
  SandboxTesterResource,
  ScreenshotResource,
  ScreenshotSetResource,
  SubscriptionGroupResource,
  SubscriptionResource,
  UserInvitationResource,
  UserResource,
  VersionExperimentResource,
  WinBackOfferCreate,
  WinBackOfferResource,
} from './ascResources.js';
import { ACCESSIBILITY_SUPPORT_KEYS } from './ascResources.js';
export * from './ascResources.js';

/** Scheme + host of the App Store Connect API; most resources hang off `/v1`, a few newer ones off `/v2`. */
const API_ORIGIN = 'https://api.appstoreconnect.apple.com';
const BASE_URL = `${API_ORIGIN}/v1`;
const AUDIENCE = 'appstoreconnect-v1';
/** Apple rejects tokens whose lifetime exceeds 20 minutes; stay safely under it. */
const TOKEN_TTL_SECONDS = 19 * 60;
/**
 * Clock drift past which a 401 is annotated as a likely clock problem. Tokens are signed for
 * {@link TOKEN_TTL_SECONDS} (19 min) against Apple's 20-minute ceiling, so a clock running more than
 * ~1 minute fast pushes `exp` past that ceiling and Apple rejects the token; a clock far behind makes
 * it look already-expired. 60s is that tight forward bound — above HTTP `Date` granularity (1s) and
 * network jitter, so the hint won't fire on noise.
 */
const CLOCK_SKEW_TOLERANCE_SECONDS = 60;

/**
 * Certificate type to create/reuse. `DISTRIBUTION` is Apple's modern unified "Apple Distribution"
 * identity, valid for App Store submission; its codesign identity is named `Apple Distribution`.
 */
export const DISTRIBUTION_CERT_TYPE = 'DISTRIBUTION';
/** Codesign identity name that pairs with {@link DISTRIBUTION_CERT_TYPE}. */
export const DISTRIBUTION_CERT_NAME = 'Apple Distribution';
/**
 * Provisioning profile type for App Store / TestFlight distribution — the **iOS default**. tvOS, macOS,
 * and visionOS resolve their own profile type via `appStoreProfileType()` in `core/platform.ts` and pass
 * it to {@link AppStoreConnectClient.createAppStoreProfile}; this constant is the default that keeps the
 * iOS path unchanged.
 */
export const APP_STORE_PROFILE_TYPE = 'IOS_APP_STORE';
/** Provisioning profile type for ad-hoc (install-link) distribution — the iOS default; tvOS/visionOS map their own via `core/platform.ts` (macOS has no ad-hoc type). */
export const AD_HOC_PROFILE_TYPE = 'IOS_APP_ADHOC';
/** The App Store Connect signing-profile type written when creating a profile (e.g. `IOS_APP_STORE`, `TVOS_APP_STORE`, `MAC_APP_STORE`). */
type ProvisioningProfileType = NonNullable<
  NonNullable<components['schemas']['Profile']['attributes']>['profileType']
>;
/**
 * The error code App Store Connect returns on *any* authenticated request when a required legal
 * agreement is unsigned or expired — the Apple Developer Program License Agreement, the Paid Applications
 * Agreement, or its banking/tax forms. Apple exposes no agreements-status endpoint, so this 403 code is
 * the only programmatic signal that the account's agreements need attention (see {@link
 * AppStoreConnectClient.checkRequiredAgreements}). Matched as a substring of Apple's `FORBIDDEN.<code>`.
 */
export const REQUIRED_AGREEMENTS_ERROR_CODE = 'REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED';
/** Platform value Apple expects when registering a device for ad-hoc distribution. */
const IOS_DEVICE_PLATFORM = 'IOS';

/**
 * App Store version states in which listing metadata is still editable, so `launch sync` may write
 * localizations into that version. A live `READY_FOR_SALE` (or in-review) version is intentionally left
 * alone. See {@link AppStoreConnectClient.getEditableVersionId}.
 */
const EDITABLE_VERSION_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'METADATA_REJECTED',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'INVALID_BINARY',
]);
/** App-info states in which the app-level listing (name/subtitle/privacy URL) is still editable. */
const EDITABLE_APPINFO_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
]);
/** ASC `appInfoLocalizations` attribute keys Launch manages (app-level — persists across versions). */
const APP_INFO_LISTING_FIELDS = ['name', 'subtitle', 'privacyPolicyUrl'] as const;
/** ASC `appStoreVersionLocalizations` attribute keys Launch manages (version-level — per release). */
const VERSION_LISTING_FIELDS = [
  'description',
  'keywords',
  'whatsNew',
  'promotionalText',
  'supportUrl',
  'marketingUrl',
] as const;

/** One App Store Connect API error, as returned in the `errors` array of a failed response. */
interface AscError {
  status: string;
  code: string;
  title: string;
  detail?: string;
}

/**
 * A non-2xx response from the App Store Connect API. Carries the HTTP `status` so callers can tell a
 * transient failure (429 rate-limit, 5xx) apart from a permanent 4xx, while the message preserves
 * Apple's human-readable `detail`. `codes` holds Apple's machine-readable error codes (the `code` field of
 * each entry in the `errors` array, e.g. `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`) so a caller
 * can branch on a specific failure structurally instead of string-matching the message. Extends Error, so
 * existing `rejects.toThrow(/…/)` assertions hold.
 */
export class AscRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codes: readonly string[] = [],
  ) {
    super(message);
    this.name = 'AscRequestError';
  }
}

/** Whether an error is a transient App Store Connect failure worth retrying (HTTP 429 or any 5xx). */
export function isRetryableAscError(error: unknown): boolean {
  return error instanceof AscRequestError && (error.status === 429 || error.status >= 500);
}

/** Apple's raw `accessibilityDeclarations` attribute bag — the support flags plus the family/state metadata. Internal to the read path. */
interface AccessibilityDeclarationAttributes extends AccessibilitySupport {
  deviceFamily?: DeviceFamily;
  state?: AccessibilityDeclarationResource['state'];
}

interface ResourceList<A> {
  data: { id: string; attributes: A }[];
}
interface ResourceSingle<A> {
  data: { id: string; attributes: A };
}

/**
 * One page of a paginated collection: the page's `data` plus Apple's `links.next` — an absolute URL
 * to the following page, present only while more pages remain. Consumed by {@link AppStoreConnectClient.requestAll}.
 */
interface PagedList<A> {
  data: { id: string; attributes: A }[];
  links?: { next?: string };
}

/**
 * One chunk Apple wants PUT to its upload CDN, taken from a reservation's `uploadOperations`. The URL is
 * presigned (no Authorization header of ours), and `requestHeaders` must be sent verbatim. A screenshot
 * is usually a single operation; large assets are split across several with `offset`/`length`.
 */
interface UploadOperation {
  method?: string;
  url: string;
  length?: number;
  offset?: number;
  requestHeaders?: { name?: string; value?: string }[];
}

/** A reserved asset (screenshot / review screenshot): its new id plus the chunks to PUT before committing. */
interface AssetReservation {
  data: { id: string; attributes: { uploadOperations?: UploadOperation[] } };
}

/** Lowercase-hex MD5 of an asset's bytes — the `sourceFileChecksum` Apple verifies at commit time. */
function md5Hex(bytes: Buffer): string {
  return createHash('md5').update(bytes).digest('hex');
}

/**
 * Pick the given keys out of a localization's raw attributes, keeping only present, non-empty strings.
 * Apple returns empty fields as `null` or `""`; both are dropped so a diff treats "unset" uniformly.
 */
function pickListingFields(
  attributes: Record<string, unknown>,
  keys: readonly string[],
): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.length > 0) fields[key] = value;
  }
  return fields;
}

/** Keep only the nine `supports*` booleans from a raw accessibility-declaration attribute bag (dropping `deviceFamily` / `state`). */
function pickAccessibilitySupport(attributes: Partial<AccessibilitySupport>): AccessibilitySupport {
  const support: AccessibilitySupport = {};
  for (const key of ACCESSIBILITY_SUPPORT_KEYS) {
    const value = attributes[key];
    if (typeof value === 'boolean') support[key] = value;
  }
  return support;
}

/**
 * One page of `/customerReviews`, fetched with `include=response` so each row's `relationships.response`
 * linkage is present — that's how {@link CustomerReviewResource.answered} is computed without a per-review
 * call. Kept separate from {@link PagedList} because {@link AppStoreConnectClient.requestAll} drops
 * relationships, and the answered flag needs them.
 */
interface CustomerReviewPage {
  data: {
    id: string;
    attributes: {
      rating?: number;
      title?: string;
      body?: string;
      reviewerNickname?: string;
      territory?: string;
      createdDate?: string;
    };
    relationships?: { response?: { data?: { id: string } | null } };
  }[];
  links?: { next?: string };
}

/**
 * One page of an app's beta-feedback submissions (crash or screenshot), read with `include=build` so
 * each row's build *version* can be resolved from the page's `included` builds without a per-row call.
 * Kept separate from {@link PagedList} because {@link AppStoreConnectClient.requestAll} drops both the
 * `included` sidebar and the `build` relationship linkage this needs. The `screenshots` attribute is
 * present only on the screenshot resource; crashes simply omit it.
 */
interface BetaFeedbackPage {
  data: {
    id: string;
    attributes?: {
      createdDate?: string;
      comment?: string;
      email?: string;
      deviceModel?: string;
      osVersion?: string;
      screenshots?: { url?: string; width?: number; height?: number }[];
    };
    relationships?: { build?: { data?: { id: string } | null } };
  }[];
  included?: { type: string; id: string; attributes?: { version?: string } }[];
  links?: { next?: string };
}

/** One normalized beta-feedback row before the crash/screenshot readers split off their public shapes. */
interface BetaFeedbackRow {
  base: BetaFeedbackSubmissionResource;
  screenshots: { url: string; width?: number; height?: number }[];
}

/**
 * One page of an app's `territoryAvailabilities`, read with each row's `territory` relationship intact
 * (which {@link AppStoreConnectClient.requestAll} drops) — the territory resource id is the territory code
 * (`USA`, `GBR`) the availability applies to. Kept as a named interface so the paginating read isn't
 * self-referential (TS7022).
 */
interface TerritoryAvailabilityPage {
  data: {
    id: string;
    attributes?: { available?: boolean };
    relationships?: { territory?: { data?: { id: string } | null } };
  }[];
  links?: { next?: string };
}

/**
 * One page of `/apps/{id}/promotedPurchases`, read with each row's product `relationships` intact (which
 * {@link AppStoreConnectClient.requestAll} drops) — the linkage is how a promoted purchase is matched to
 * a config `productId`. Kept as a named interface so the paginating read isn't self-referential (TS7022).
 */
interface PromotedPurchasePage {
  data: {
    id: string;
    attributes?: { enabled?: boolean; visibleForAllUsers?: boolean };
    relationships?: {
      inAppPurchaseV2?: { data?: { id: string } | null };
      subscription?: { data?: { id: string } | null };
    };
  }[];
  links?: { next?: string };
}

/**
 * One page of an App Clip's `appClipDefaultExperiences`, read with each row's `releaseWithAppStoreVersion`
 * relationship intact (which {@link AppStoreConnectClient.requestAll} drops) — that linkage is how an
 * experience is matched to the editable App Store version being reconciled.
 */
interface AppClipExperiencePage {
  data: {
    id: string;
    attributes?: { action?: string };
    relationships?: { releaseWithAppStoreVersion?: { data?: { id: string } | null } };
  }[];
  links?: { next?: string };
}

/**
 * App / version / app-info states in which Apple still accepts metadata edits (categories, age rating,
 * review details). Once a version is past these (e.g. `WAITING_FOR_REVIEW`, `PENDING_DEVELOPER_RELEASE`)
 * those fields are frozen, so the reconciler picks the editable record and errors loudly when none exists.
 */
const EDITABLE_METADATA_STATES = new Set<string>([
  'PREPARE_FOR_SUBMISSION',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

/** Client bound to one App Store Connect API key. */
export class AppStoreConnectClient {
  constructor(private readonly key: AscKey) {}

  /** Mint a short-lived bearer token for the API. */
  private async token(): Promise<string> {
    const privateKey = await importPKCS8(this.key.p8, 'ES256');
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.key.keyId, typ: 'JWT' })
      .setIssuer(this.key.issuerId)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + TOKEN_TTL_SECONDS)
      .setAudience(AUDIENCE)
      .sign(privateKey);
  }

  /**
   * Issue an authenticated request and parse the JSON body. On failure it surfaces Apple's own
   * error `detail` (e.g. "A required agreement is missing") instead of a bare status code, so the
   * CLI can show an actionable message.
   *
   * `pathOrUrl` is either a path relative to {@link BASE_URL} (e.g. `/devices?limit=200`) or an
   * already-absolute URL — Apple's pagination `links.next` is absolute and already carries `/v1`, so
   * {@link requestAll} passes it through verbatim. Re-prefixing such a URL with BASE_URL is exactly
   * the `/v1/v1/...` double-prefix bug that breaks naive clients once a collection spans pages.
   */
  private async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    // Transparent backoff on Apple's transient failures (429 rate-limit / 5xx). A fresh token is
    // minted per attempt, so a retry that straddles the 19-minute TTL re-signs rather than 401s.
    return withRetry(() => this.requestOnce<T>(method, pathOrUrl, body), {
      isRetryable: isRetryableAscError,
    });
  }

  /** A single (un-retried) authenticated request — the retry wrapper lives in {@link request}. */
  private async requestOnce<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      // A 401 most often means a wrong/expired token — but the sneaky cause is a skewed local clock,
      // since `exp`/`iat` are signed off it. Apple's `Date` header is the authoritative reference.
      const hint =
        response.status === 401
          ? clockSkewHint({
              appleDate: response.headers.get('date'),
              nowMs: Date.now(),
              platform: process.platform,
            })
          : '';
      throw new AscRequestError(
        `App Store Connect ${method} ${pathOrUrl} failed (${response.status}): ${describeErrors(text)}${hint}`,
        response.status,
        parseErrorCodes(text),
      );
    }
    return JSON.parse(text) as T;
  }

  /** Build an absolute URL for a `/v2` resource — a few newer collections (in-app purchases) live there. */
  private v2(path: string): string {
    return `${API_ORIGIN}/v2${path}`;
  }

  /**
   * GET every page of a paginated collection, following Apple's absolute `links.next` URLs verbatim
   * until the cursor runs out. Apple caps a page at 200 and links the rest; reading only the first
   * page silently truncates large collections (a team's devices, an app's version history), so any
   * "list all" call routes through here rather than a single `limit=200` read.
   */
  // A is the caller-specified attributes shape of the returned rows; no argument infers it, so the param is required.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  private async requestAll<A>(path: string): Promise<{ id: string; attributes: A }[]> {
    const all: { id: string; attributes: A }[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: PagedList<A> = await this.request<PagedList<A>>('GET', next);
      all.push(...page.data);
      next = page.links?.next;
    }
    return all;
  }

  /**
   * Run a read that may legitimately find nothing, mapping App Store Connect's `404` to `null` while
   * letting every other error propagate. Apple returns 404 for an absent optional record — a version's
   * phased release, an app's age-rating or availability declaration, a not-yet-created Game Center
   * detail — so this is the one place the "404 means absent, anything else is a real failure" policy
   * lives. Callers wrap their `request`/map expression in the thunk instead of each re-implementing the
   * `instanceof AscRequestError && status === 404` guard (and risking swallowing a non-404 by getting it wrong).
   */
  private async getOptional<T>(load: () => Promise<T>): Promise<T | null> {
    try {
      return await load();
    } catch (error) {
      if (error instanceof AscRequestError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * POST a JSON:API resource and return its raw `{ id, attributes }`. Owns the `{ data: … }` request
   * envelope so a create reads as the resource it builds: the caller passes the member `type` plus its
   * `attributes` (and optional `relationships`), then maps the returned attributes onto its public
   * `*Resource` shape. `path` may be relative (`/bundleIds`) or an absolute `/v2` URL from {@link v2}.
   */
  // A is the caller-specified attributes shape of the created resource; no argument infers it, so the param is required.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  private async createResource<A = unknown>(
    path: string,
    member: { type: string; attributes?: object; relationships?: object },
  ): Promise<{ id: string; attributes: A }> {
    const { data } = await this.request<ResourceSingle<A>>('POST', path, { data: member });
    return data;
  }

  /**
   * PATCH a JSON:API resource. Owns the `{ data: { type, id, attributes } }` envelope every update
   * shares; Apple's update responses are ignored here (callers re-read when they need the new state).
   */
  private async updateResource(
    path: string,
    member: { type: string; id: string; attributes: object },
  ): Promise<void> {
    await this.request<unknown>('PATCH', path, { data: member });
  }

  /** DELETE a JSON:API resource at `path` — the no-body counterpart of {@link createResource}. */
  private async deleteResource(path: string): Promise<void> {
    await this.request<unknown>('DELETE', path);
  }

  /** Resolve the internal App Store Connect app id for a bundle identifier, or null if no record exists. */
  async getAppId(bundleId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ bundleId: string }>>(
      'GET',
      `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
    );
    return data[0]?.id ?? null;
  }

  /**
   * Return the highest build number already uploaded for an app, or 0 if none exist yet.
   * The caller bumps this by one for the next upload.
   */
  async getLatestBuildNumber(bundleId: string): Promise<number> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return 0;
    const { data } = await this.request<ResourceList<{ version: string }>>(
      'GET',
      `/builds?filter[app]=${appId}&sort=-version&limit=1&fields[builds]=version`,
    );
    const latest = data[0]?.attributes.version;
    const parsed = latest ? Number.parseInt(latest, 10) : 0;
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Return the highest marketing version (`CFBundleShortVersionString`) already on App Store Connect
   * for an app — folding both submitted App Store versions and TestFlight pre-release versions — or
   * null when the app has none yet (or no record exists). The caller suggests the next bump from this,
   * so a developer never silently reuses or guesses a version. Compared numerically (see
   * {@link highestVersion}) rather than trusting Apple's lexical sort, which mis-orders `1.10.0`.
   */
  async getLatestMarketingVersion(bundleId: string): Promise<string | null> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return null;
    const [appStore, preRelease] = await Promise.all([
      this.requestAll<{ versionString: string }>(
        `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=versionString&limit=200`,
      ),
      this.requestAll<{ version: string }>(
        `/apps/${appId}/preReleaseVersions?fields[preReleaseVersions]=version&limit=200`,
      ),
    ]);
    return highestVersion([
      ...appStore.map((entry) => entry.attributes.versionString),
      ...preRelease.map((entry) => entry.attributes.version),
    ]);
  }

  /** Poll a freshly uploaded build's processing state (e.g. `PROCESSING`, `VALID`, `INVALID`). */
  async getBuildProcessingState(bundleId: string, buildNumber: number): Promise<string | null> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return null;
    const { data } = await this.request<ResourceList<{ processingState: string }>>(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=processingState`,
    );
    return data[0]?.attributes.processingState ?? null;
  }

  /**
   * Resolve a specific uploaded build by its build number, returning its ASC id plus the current
   * export-compliance answer (`usesNonExemptEncryption`: `true`/`false` once answered, `null` while
   * unanswered). Null when no build with that number exists yet (e.g. still ingesting after upload).
   * The id is what {@link setBuildUsesNonExemptEncryption} and {@link linkBuildToDeclaration} act on.
   */
  async findBuild(
    bundleId: string,
    buildNumber: number,
  ): Promise<{ id: string; usesNonExemptEncryption: boolean | null } | null> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return null;
    const { data } = await this.request<ResourceList<{ usesNonExemptEncryption: boolean | null }>>(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=usesNonExemptEncryption`,
    );
    const build = data[0];
    return build
      ? { id: build.id, usesNonExemptEncryption: build.attributes.usesNonExemptEncryption ?? null }
      : null;
  }

  /**
   * Answer a build's export-compliance question directly via its `usesNonExemptEncryption` attribute —
   * the one-call path for the common "no / only-exempt encryption" case (`false`), so App Store Connect
   * stops re-prompting on every upload. Apple accepts this only before the build is submitted for review.
   */
  async setBuildUsesNonExemptEncryption(buildId: string, value: boolean): Promise<void> {
    await this.updateResource(`/builds/${buildId}`, {
      type: 'builds',
      id: buildId,
      attributes: { usesNonExemptEncryption: value },
    });
  }

  /**
   * Resolve the app's current **editable** `appInfo` (the container for app-level listing copy — name,
   * subtitle, privacy URL — that persists across versions), or null when none is in an editable state.
   * A live app keeps a read-only `READY_FOR_DISTRIBUTION` appInfo we must never PATCH.
   */
  async getEditableAppInfoId(appId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ state?: string; appStoreState?: string }>>(
      'GET',
      `/apps/${appId}/appInfos?fields[appInfos]=state,appStoreState&limit=20`,
    );
    const editable = data.find((info) => {
      const state = info.attributes.state ?? info.attributes.appStoreState;
      return state !== undefined && EDITABLE_APPINFO_STATES.has(state);
    });
    return editable?.id ?? null;
  }

  /** List the app-level listing localizations (name/subtitle/privacy URL) under an `appInfo`. */
  async listAppInfoLocalizations(appInfoId: string): Promise<ListingLocalization[]> {
    const data = await this.requestAll<Record<string, unknown>>(
      `/appInfos/${appInfoId}/appInfoLocalizations?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      locale: typeof entry.attributes['locale'] === 'string' ? entry.attributes['locale'] : '',
      fields: pickListingFields(entry.attributes, APP_INFO_LISTING_FIELDS),
    }));
  }

  /**
   * Each locale's account-deletion URL under an `appInfo`, read from the dedicated `privacyChoicesUrl`
   * attribute (the field App Store Connect surfaces under "App Privacy → Account Deletion"). Apple requires
   * it for any app that lets users create an account, so the readiness layer checks its presence. Returned
   * per locale, the empty string where the locale leaves it unset — separate from {@link listAppInfoLocalizations}
   * so the listing-sync field set (name/subtitle/privacy policy) stays untouched.
   */
  async listAccountDeletionUrls(appInfoId: string): Promise<{ locale: string; url: string }[]> {
    const data = await this.requestAll<{ locale?: string; privacyChoicesUrl?: string }>(
      `/appInfos/${appInfoId}/appInfoLocalizations?limit=200&fields[appInfoLocalizations]=locale,privacyChoicesUrl`,
    );
    return data.map((entry) => ({
      locale: entry.attributes.locale ?? '',
      url: entry.attributes.privacyChoicesUrl ?? '',
    }));
  }

  /** Create a missing app-level listing locale. `fields` must include `name` (Apple requires it). */
  async createAppInfoLocalization(
    appInfoId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.createResource('/appInfoLocalizations', {
      type: 'appInfoLocalizations',
      attributes: { locale, ...fields },
      relationships: { appInfo: { data: { type: 'appInfos', id: appInfoId } } },
    });
  }

  /** Patch changed fields on an existing app-level listing locale (locale itself is immutable). */
  async updateAppInfoLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.updateResource(`/appInfoLocalizations/${localizationId}`, {
      type: 'appInfoLocalizations',
      id: localizationId,
      attributes: fields,
    });
  }

  /**
   * List an app's existing App Encryption Declarations (all states) — the reuse candidates for a build
   * that uses non-exempt encryption. Returns `[]` when the app has none or has no ASC record yet.
   */
  async listEncryptionDeclarations(bundleId: string): Promise<EncryptionDeclarationResource[]> {
    const appId = await this.getAppId(bundleId);
    if (!appId) return [];
    const data = await this.requestAll<{ appEncryptionDeclarationState: string }>(
      `/apps/${appId}/appEncryptionDeclarations?fields[appEncryptionDeclarations]=appEncryptionDeclarationState&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      state: entry.attributes.appEncryptionDeclarationState,
    }));
  }

  /**
   * Attach a build to an existing App Encryption Declaration, reusing that one-time, document-backed
   * answer instead of submitting a fresh declaration per build (Apple returns `204 No Content`).
   */
  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    await this.request<unknown>(
      'POST',
      `/appEncryptionDeclarations/${declarationId}/relationships/builds`,
      {
        data: [{ type: 'builds', id: buildId }],
      },
    );
  }

  /**
   * Resolve the app's current **editable** App Store version (the one whose listing copy — description,
   * keywords, what's new, … — can still be changed), or null when only a live/in-review version exists.
   */
  async getEditableVersionId(appId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ appStoreState: string }>>(
      'GET',
      `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=appStoreState&limit=20`,
    );
    const editable = data.find((version) =>
      EDITABLE_VERSION_STATES.has(version.attributes.appStoreState),
    );
    return editable?.id ?? null;
  }

  /** List the version-level listing localizations (description/keywords/whatsNew/…) under a version. */
  async listVersionLocalizations(versionId: string): Promise<ListingLocalization[]> {
    const data = await this.requestAll<Record<string, unknown>>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      locale: typeof entry.attributes['locale'] === 'string' ? entry.attributes['locale'] : '',
      fields: pickListingFields(entry.attributes, VERSION_LISTING_FIELDS),
    }));
  }

  /** Create a missing version-level listing locale (Apple requires only `locale`). */
  async createVersionLocalization(
    versionId: string,
    locale: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.createResource('/appStoreVersionLocalizations', {
      type: 'appStoreVersionLocalizations',
      attributes: { locale, ...fields },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  }

  /** Patch changed fields on an existing version-level listing locale (locale itself is immutable). */
  async updateVersionLocalization(
    localizationId: string,
    fields: Record<string, string>,
  ): Promise<void> {
    await this.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: fields,
    });
  }

  /**
   * List an app's App Clips (read-only — a clip is created by uploading a build with an App Clip target).
   * The reconciler matches a config entry to a clip by its own `bundleId`.
   */
  async listAppClips(appId: string): Promise<AppClipResource[]> {
    const data = await this.requestAll<{ bundleId?: string }>(`/apps/${appId}/appClips?limit=200`);
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.bundleId ? { bundleId: entry.attributes.bundleId } : {}),
    }));
  }

  /**
   * List a clip's default experiences with each one's card `action` and the App Store version it releases
   * with — the version linkage lets the reconciler pick the experience for the version being prepared.
   */
  async listAppClipDefaultExperiences(
    appClipId: string,
  ): Promise<AppClipDefaultExperienceResource[]> {
    const all: AppClipDefaultExperienceResource[] = [];
    let next: string | undefined =
      `/appClips/${appClipId}/appClipDefaultExperiences` +
      `?include=releaseWithAppStoreVersion&fields[appClipDefaultExperiences]=action,releaseWithAppStoreVersion&limit=200`;
    while (next) {
      const page: AppClipExperiencePage = await this.request<AppClipExperiencePage>('GET', next);
      for (const entry of page.data) {
        all.push({
          id: entry.id,
          ...(entry.attributes?.action ? { action: entry.attributes.action } : {}),
          ...(entry.relationships?.releaseWithAppStoreVersion?.data?.id
            ? { versionId: entry.relationships.releaseWithAppStoreVersion.data.id }
            : {}),
        });
      }
      next = page.links?.next;
    }
    return all;
  }

  /** Create a clip's default experience for an editable version, optionally setting the card action. */
  async createAppClipDefaultExperience(
    appClipId: string,
    versionId: string,
    action?: AppClipActionValue,
  ): Promise<{ id: string }> {
    const body: components['schemas']['AppClipDefaultExperienceCreateRequest'] = {
      data: {
        type: 'appClipDefaultExperiences',
        ...(action ? { attributes: { action } } : {}),
        relationships: {
          appClip: { data: { type: 'appClips', id: appClipId } },
          releaseWithAppStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    };
    const { data } = await this.request<ResourceSingle<{ action?: string }>>(
      'POST',
      '/appClipDefaultExperiences',
      body,
    );
    return { id: data.id };
  }

  /** PATCH a default experience's card call-to-action (`OPEN` / `VIEW` / `PLAY`). */
  async updateAppClipDefaultExperienceAction(
    experienceId: string,
    action: AppClipActionValue,
  ): Promise<void> {
    const body: components['schemas']['AppClipDefaultExperienceUpdateRequest'] = {
      data: { type: 'appClipDefaultExperiences', id: experienceId, attributes: { action } },
    };
    await this.request<unknown>('PATCH', `/appClipDefaultExperiences/${experienceId}`, body);
  }

  /** List a default experience's per-locale card localizations (locale + subtitle). */
  async listAppClipDefaultExperienceLocalizations(
    experienceId: string,
  ): Promise<AppClipLocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; subtitle?: string }>(
      `/appClipDefaultExperiences/${experienceId}/appClipDefaultExperienceLocalizations?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      locale: entry.attributes.locale ?? '',
      ...(entry.attributes.subtitle ? { subtitle: entry.attributes.subtitle } : {}),
    }));
  }

  /** Create a card localization (locale + subtitle) under a default experience. */
  async createAppClipDefaultExperienceLocalization(
    experienceId: string,
    locale: string,
    subtitle: string,
  ): Promise<void> {
    const body: components['schemas']['AppClipDefaultExperienceLocalizationCreateRequest'] = {
      data: {
        type: 'appClipDefaultExperienceLocalizations',
        attributes: { locale, subtitle },
        relationships: {
          appClipDefaultExperience: {
            data: { type: 'appClipDefaultExperiences', id: experienceId },
          },
        },
      },
    };
    await this.request<unknown>('POST', '/appClipDefaultExperienceLocalizations', body);
  }

  /** PATCH a card localization's subtitle (the locale itself is immutable). */
  async updateAppClipDefaultExperienceLocalization(
    localizationId: string,
    subtitle: string,
  ): Promise<void> {
    const body: components['schemas']['AppClipDefaultExperienceLocalizationUpdateRequest'] = {
      data: {
        type: 'appClipDefaultExperienceLocalizations',
        id: localizationId,
        attributes: { subtitle },
      },
    };
    await this.request<unknown>(
      'PATCH',
      `/appClipDefaultExperienceLocalizations/${localizationId}`,
      body,
    );
  }

  /** Cheap call that fails with a clear message when the account has an unsigned/expired agreement. */
  async assertReady(): Promise<void> {
    await this.request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
  }

  /**
   * Report whether the account's required legal agreements are signed and in effect. App Store Connect has
   * no agreements-status endpoint, so this makes one cheap authenticated read and classifies the outcome:
   * a clean response means the agreements are in effect; a 403 carrying
   * {@link REQUIRED_AGREEMENTS_ERROR_CODE} means the Developer Program License Agreement, the Paid
   * Applications Agreement, or its banking/tax forms are missing or expired (the API can't tell those
   * apart — all three surface as this one error). Any other failure is a real read error and is rethrown,
   * so a readiness probe records it as `errored` rather than silently reporting "agreements fine".
   */
  async checkRequiredAgreements(): Promise<boolean> {
    try {
      await this.request<ResourceList<unknown>>('GET', '/bundleIds?limit=1');
      return true;
    } catch (error) {
      if (
        error instanceof AscRequestError &&
        error.status === 403 &&
        error.codes.some((code) => code.includes(REQUIRED_AGREEMENTS_ERROR_CODE))
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Resolve this key's Apple Team ID — the bundle-id `seedId`, the only team identifier an API key
   * exposes (there is no org-name endpoint). Null when the account has registered no bundle ids yet.
   */
  async resolveTeamId(): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ seedId?: string }>>(
      'GET',
      '/bundleIds?limit=1&fields[bundleIds]=seedId',
    );
    return data[0]?.attributes.seedId ?? null;
  }

  /**
   * List the names of the apps this key can access — the recognizable signal for telling accounts
   * apart in the picker (an opaque Team ID alone isn't memorable). All pages, names only.
   */
  async listAppNames(): Promise<string[]> {
    const data = await this.requestAll<{ name?: string }>('/apps?fields[apps]=name&limit=200');
    return data
      .map((entry) => entry.attributes.name)
      .filter((name): name is string => Boolean(name));
  }

  /** Find a registered Bundle ID by its identifier, or null if it isn't registered yet. */
  async findBundleId(identifier: string): Promise<BundleIdResource | null> {
    const { data } = await this.request<ResourceList<{ identifier: string; seedId?: string }>>(
      'GET',
      `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=1`,
    );
    const first = data[0];
    if (!first) return null;
    return {
      id: first.id,
      identifier: first.attributes.identifier,
      seedId: first.attributes.seedId,
    };
  }

  /**
   * Register a new Bundle ID (App ID) so a build can be signed against it. The bundle-id platform defaults
   * to iOS — the value tvOS/visionOS also register under (their bundle ids are iOS-family); macOS callers
   * pass `MAC_OS` (computed by `toBundleIdPlatform` in `core/platform.ts`).
   */
  async createBundleId(
    identifier: string,
    name: string,
    bundleIdPlatform: components['schemas']['BundleIdPlatform'] = 'IOS',
  ): Promise<BundleIdResource> {
    const data = await this.createResource<{ identifier: string; seedId?: string }>('/bundleIds', {
      type: 'bundleIds',
      attributes: { identifier, name, platform: bundleIdPlatform },
    });
    return { id: data.id, identifier: data.attributes.identifier, seedId: data.attributes.seedId };
  }

  /** List distribution certificates, newest expiry first, for reuse before creating a new one. */
  async listDistributionCertificates(): Promise<CertificateResource[]> {
    const data = await this.requestAll<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>(`/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}&limit=200`);
    return data.map((entry) => ({
      id: entry.id,
      serialNumber: entry.attributes.serialNumber,
      certificateContent: entry.attributes.certificateContent,
      expirationDate: entry.attributes.expirationDate,
    }));
  }

  /** Create a distribution certificate from a PEM certificate-signing request. */
  async createCertificate(csrContent: string): Promise<CertificateResource> {
    const data = await this.createResource<{
      serialNumber: string;
      certificateContent: string;
      expirationDate?: string;
    }>('/certificates', {
      type: 'certificates',
      attributes: { csrContent, certificateType: DISTRIBUTION_CERT_TYPE },
    });
    return {
      id: data.id,
      serialNumber: data.attributes.serialNumber,
      certificateContent: data.attributes.certificateContent,
      expirationDate: data.attributes.expirationDate,
    };
  }

  /** Find a provisioning profile by exact name (Launch names its profiles deterministically). */
  async findProfileByName(name: string): Promise<ProfileResource | null> {
    const { data } = await this.request<
      ResourceList<{ name: string; uuid: string; profileContent: string }>
    >('GET', `/profiles?filter[name]=${encodeURIComponent(name)}&limit=1`);
    const first = data[0];
    if (!first) return null;
    return {
      id: first.id,
      name: first.attributes.name,
      uuid: first.attributes.uuid,
      profileContent: first.attributes.profileContent,
    };
  }

  /**
   * Create an App Store provisioning profile linking a bundle id to a distribution certificate. `profileType`
   * defaults to the iOS App Store profile; tvOS/macOS callers pass their own (`appStoreProfileType` in
   * `core/platform.ts`), so the type matches the platform the build targets.
   */
  async createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    profileType: ProvisioningProfileType = APP_STORE_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    const data = await this.createResource<{ name: string; uuid: string; profileContent: string }>(
      '/profiles',
      {
        type: 'profiles',
        attributes: { name, profileType },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } },
          certificates: { data: [{ type: 'certificates', id: certificateId }] },
        },
      },
    );
    return {
      id: data.id,
      name: data.attributes.name,
      uuid: data.attributes.uuid,
      profileContent: data.attributes.profileContent,
    };
  }

  /** Delete a provisioning profile (used when recreating one after issuing a new certificate). */
  async deleteProfile(id: string): Promise<void> {
    await this.deleteResource(`/profiles/${id}`);
  }

  /**
   * List every registered device, across all pages. An ad-hoc profile must enumerate the devices it
   * covers, and a real team easily exceeds Apple's 200-per-page cap — so this folds the whole
   * collection via {@link requestAll} rather than reading one page (the silent-truncation trap).
   */
  async listDevices(): Promise<DeviceResource[]> {
    const data = await this.requestAll<{ udid: string; name: string; status?: string }>(
      '/devices?limit=200',
    );
    return data.map((entry) => ({
      id: entry.id,
      udid: entry.attributes.udid,
      name: entry.attributes.name,
      status: entry.attributes.status,
    }));
  }

  /** Find a registered device by UDID (case-insensitive — Apple stores UDIDs lower-case), or null. */
  async findDeviceByUdid(udid: string): Promise<DeviceResource | null> {
    const wanted = udid.toLowerCase();
    return (
      (await this.listDevices()).find((device) => device.udid.toLowerCase() === wanted) ?? null
    );
  }

  /**
   * Register a device so ad-hoc builds can target it. Apple treats a known UDID idempotently (it
   * returns the existing entry rather than erroring), so callers can register-then-include safely.
   */
  async registerDevice(udid: string, name: string): Promise<DeviceResource> {
    const data = await this.createResource<{ udid: string; name: string; status?: string }>(
      '/devices',
      {
        type: 'devices',
        attributes: { udid, name, platform: IOS_DEVICE_PLATFORM },
      },
    );
    return {
      id: data.id,
      udid: data.attributes.udid,
      name: data.attributes.name,
      status: data.attributes.status,
    };
  }

  /**
   * Create an ad-hoc provisioning profile that ties a bundle id + distribution certificate to an
   * explicit device set — the install-link analog of {@link createAppStoreProfile}. The profile is
   * only valid for the `deviceIds` listed, so it must be recreated whenever the device set changes.
   */
  async createAdHocProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
    deviceIds: string[],
    profileType: ProvisioningProfileType = AD_HOC_PROFILE_TYPE,
  ): Promise<ProfileResource> {
    const data = await this.createResource<{ name: string; uuid: string; profileContent: string }>(
      '/profiles',
      {
        type: 'profiles',
        attributes: { name, profileType },
        relationships: {
          bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } },
          certificates: { data: [{ type: 'certificates', id: certificateId }] },
          devices: { data: deviceIds.map((id) => ({ type: 'devices', id })) },
        },
      },
    );
    return {
      id: data.id,
      name: data.attributes.name,
      uuid: data.attributes.uuid,
      profileContent: data.attributes.profileContent,
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  App Store Connect product catalog — capabilities, in-app purchases,      */
  /*  subscriptions, and pricing. Consumed by the `launch sync` reconciler     */
  /*  (core/ascSync.ts); none of this is needed by the build/sign path.        */
  /* ------------------------------------------------------------------------ */

  /** List the capabilities currently enabled on a bundle id (App ID), with their toggle settings. */
  async listBundleIdCapabilities(
    bundleIdResourceId: string,
  ): Promise<BundleIdCapabilityResource[]> {
    const data = await this.requestAll<{
      capabilityType?: string;
      settings?: CapabilitySetting[] | null;
    }>(
      // Apple's bundleIdCapabilities related endpoint rejects `limit` (400 "does not support this
      // parameter") unlike most collections; pagination still works through links.next in requestAll.
      `/bundleIds/${bundleIdResourceId}/bundleIdCapabilities?fields[bundleIdCapabilities]=capabilityType,settings`,
    );
    return data.flatMap((entry) =>
      entry.attributes.capabilityType
        ? [
            {
              id: entry.id,
              capabilityType: entry.attributes.capabilityType,
              ...(entry.attributes.settings ? { settings: entry.attributes.settings } : {}),
            },
          ]
        : [],
    );
  }

  /**
   * List the provisioning profiles attached to a bundle id, with their `.mobileprovision` bytes —
   * the read `launch adopt` uses to recover a shipping app's real capability values (app groups,
   * iCloud containers, merchant ids) from a profile's embedded entitlements. Unlike
   * {@link findProfileByName}, this matches on the bundle id rather than Launch's deterministic name,
   * so it finds profiles created in Xcode/the portal by an app onboarded before Launch.
   */
  async listProfilesForBundleId(bundleIdResourceId: string): Promise<ProfileResource[]> {
    const data = await this.requestAll<{ name?: string; uuid?: string; profileContent?: string }>(
      `/bundleIds/${bundleIdResourceId}/profiles?limit=200&fields[profiles]=name,uuid,profileContent`,
    );
    return data.flatMap((entry) =>
      entry.attributes.name && entry.attributes.uuid && entry.attributes.profileContent
        ? [
            {
              id: entry.id,
              name: entry.attributes.name,
              uuid: entry.attributes.uuid,
              profileContent: entry.attributes.profileContent,
            },
          ]
        : [],
    );
  }

  /** Enable a capability on a bundle id. The reconciler only calls this for a capability not already on. */
  async enableCapability(
    bundleIdResourceId: string,
    capabilityType: string,
  ): Promise<BundleIdCapabilityResource> {
    const data = await this.createResource<{ capabilityType?: string }>('/bundleIdCapabilities', {
      type: 'bundleIdCapabilities',
      attributes: { capabilityType },
      relationships: { bundleId: { data: { type: 'bundleIds', id: bundleIdResourceId } } },
    });
    return { id: data.id, capabilityType: data.attributes.capabilityType ?? capabilityType };
  }

  /** Disable a capability by its resource id (only reached under `--allow-destructive`). */
  async disableCapability(capabilityId: string): Promise<void> {
    await this.deleteResource(`/bundleIdCapabilities/${capabilityId}`);
  }

  // ── Sandbox testers: StoreKit testing accounts (`launch sandbox`) ─────────────────────────────────

  /** List the account's sandbox testers (the `/v2/sandboxTesters` collection), across all pages. */
  async listSandboxTesters(): Promise<SandboxTesterResource[]> {
    const data = await this.requestAll<{
      acAccountName?: string;
      firstName?: string;
      lastName?: string;
      territory?: string;
      applePayCompatible?: boolean;
      interruptPurchases?: boolean;
      subscriptionRenewalRate?: string;
    }>(this.v2('/sandboxTesters?limit=200'));
    return data.map((entry) => ({
      id: entry.id,
      acAccountName: entry.attributes.acAccountName ?? '',
      ...(entry.attributes.firstName ? { firstName: entry.attributes.firstName } : {}),
      ...(entry.attributes.lastName ? { lastName: entry.attributes.lastName } : {}),
      ...(entry.attributes.territory ? { territory: entry.attributes.territory } : {}),
      ...(entry.attributes.applePayCompatible !== undefined
        ? { applePayCompatible: entry.attributes.applePayCompatible }
        : {}),
      ...(entry.attributes.interruptPurchases !== undefined
        ? { interruptPurchases: entry.attributes.interruptPurchases }
        : {}),
      ...(entry.attributes.subscriptionRenewalRate
        ? { subscriptionRenewalRate: entry.attributes.subscriptionRenewalRate }
        : {}),
    }));
  }

  /** Clear the StoreKit purchase history for one or more sandbox testers (a single batched request). */
  async clearSandboxTesterPurchaseHistory(testerIds: string[]): Promise<void> {
    await this.createResource(this.v2('/sandboxTestersClearPurchaseHistoryRequest'), {
      type: 'sandboxTestersClearPurchaseHistoryRequest',
      relationships: {
        sandboxTesters: { data: testerIds.map((id) => ({ type: 'sandboxTesters', id })) },
      },
    });
  }

  /** List an app's in-app purchases (the `inAppPurchasesV2` collection), across all pages. */
  async listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]> {
    const data = await this.requestAll<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
      state?: string;
    }>(
      `/apps/${appId}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,name,inAppPurchaseType,state`,
    );
    return data.map((entry) => ({
      id: entry.id,
      productId: entry.attributes.productId ?? '',
      name: entry.attributes.name ?? '',
      inAppPurchaseType: entry.attributes.inAppPurchaseType ?? '',
      ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
    }));
  }

  /** Create an in-app purchase. Note the `/v2` path — IAP creation is one of Apple's few v2 endpoints. */
  async createInAppPurchase(
    appId: string,
    input: { productId: string; name: string; inAppPurchaseType: string },
  ): Promise<InAppPurchaseResource> {
    const data = await this.createResource<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
    }>(this.v2('/inAppPurchases'), {
      type: 'inAppPurchases',
      attributes: {
        productId: input.productId,
        name: input.name,
        inAppPurchaseType: input.inAppPurchaseType,
      },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return {
      id: data.id,
      productId: data.attributes.productId ?? input.productId,
      name: data.attributes.name ?? input.name,
      inAppPurchaseType: data.attributes.inAppPurchaseType ?? input.inAppPurchaseType,
    };
  }

  /** List the localizations already attached to an in-app purchase. */
  async listInAppPurchaseLocalizations(iapId: string): Promise<LocalizationResource[]> {
    // The relationship read lives under /v2/inAppPurchases/{id}/… — the bare /v1 inAppPurchasesV2/{id}
    // resource path 404s ("does not match a defined resource type"); only the collection is v1.
    return this.localizationsFrom(
      this.v2(`/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=200`),
    );
  }

  /** Create one locale's display copy for an in-app purchase. */
  async createInAppPurchaseLocalization(
    iapId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization(
      'inAppPurchaseLocalizations',
      'inAppPurchaseV2',
      'inAppPurchases',
      iapId,
      input,
    );
  }

  /** List an app's subscription groups. */
  async listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]> {
    const data = await this.requestAll<{ referenceName?: string }>(
      `/apps/${appId}/subscriptionGroups?limit=200&fields[subscriptionGroups]=referenceName`,
    );
    return data.flatMap((entry) =>
      entry.attributes.referenceName
        ? [{ id: entry.id, referenceName: entry.attributes.referenceName }]
        : [],
    );
  }

  /** Create a subscription group on an app. */
  async createSubscriptionGroup(
    appId: string,
    referenceName: string,
  ): Promise<SubscriptionGroupResource> {
    const data = await this.createResource<{ referenceName?: string }>('/subscriptionGroups', {
      type: 'subscriptionGroups',
      attributes: { referenceName },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return { id: data.id, referenceName: data.attributes.referenceName ?? referenceName };
  }

  /** List a subscription group's display-name localizations. */
  async listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]> {
    return this.localizationsFrom(
      `/subscriptionGroups/${groupId}/subscriptionGroupLocalizations?limit=200`,
    );
  }

  /** Create one locale's display name for a subscription group (groups carry a name only, no description). */
  async createSubscriptionGroupLocalization(
    groupId: string,
    input: { locale: string; name: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization(
      'subscriptionGroupLocalizations',
      'subscriptionGroup',
      'subscriptionGroups',
      groupId,
      input,
    );
  }

  /** List the subscriptions in a group. */
  async listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    const data = await this.requestAll<{
      productId?: string;
      name?: string;
      subscriptionPeriod?: string;
      state?: string;
    }>(
      `/subscriptionGroups/${groupId}/subscriptions?limit=200&fields[subscriptions]=productId,name,subscriptionPeriod,state`,
    );
    return data.map((entry) => ({
      id: entry.id,
      productId: entry.attributes.productId ?? '',
      name: entry.attributes.name ?? '',
      ...(entry.attributes.subscriptionPeriod
        ? { subscriptionPeriod: entry.attributes.subscriptionPeriod }
        : {}),
      ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
    }));
  }

  /** Create an auto-renewable subscription in a group. */
  async createSubscription(
    groupId: string,
    input: { productId: string; name: string; subscriptionPeriod: string; groupLevel: number },
  ): Promise<SubscriptionResource> {
    const data = await this.createResource<{ productId?: string; name?: string }>(
      '/subscriptions',
      {
        type: 'subscriptions',
        attributes: {
          productId: input.productId,
          name: input.name,
          subscriptionPeriod: input.subscriptionPeriod,
          groupLevel: input.groupLevel,
        },
        relationships: { group: { data: { type: 'subscriptionGroups', id: groupId } } },
      },
    );
    return {
      id: data.id,
      productId: data.attributes.productId ?? input.productId,
      name: data.attributes.name ?? input.name,
    };
  }

  /** List a subscription's display-copy localizations. */
  async listSubscriptionLocalizations(subscriptionId: string): Promise<LocalizationResource[]> {
    return this.localizationsFrom(
      `/subscriptions/${subscriptionId}/subscriptionLocalizations?limit=200`,
    );
  }

  /** Create one locale's display copy for a subscription. */
  async createSubscriptionLocalization(
    subscriptionId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization(
      'subscriptionLocalizations',
      'subscription',
      'subscriptions',
      subscriptionId,
      input,
    );
  }

  /** Whether a subscription already has at least one price set (so the reconciler skips re-pricing it). */
  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    const { data } = await this.request<ResourceList<unknown>>(
      'GET',
      `/subscriptions/${subscriptionId}/prices?limit=1`,
    );
    return data.length > 0;
  }

  /** Find the subscription price point in `territory` whose customer price equals `customerPrice`, or null. */
  async findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.requestAll<{ customerPrice?: string; territory?: string }>(
      `/subscriptions/${subscriptionId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  /** Set a subscription's price by linking it to a resolved price point (effective immediately). */
  async createSubscriptionPrice(subscriptionId: string, pricePointId: string): Promise<void> {
    await this.createResource('/subscriptionPrices', {
      type: 'subscriptionPrices',
      attributes: { preserveCurrentPrice: false },
      relationships: {
        subscription: { data: { type: 'subscriptions', id: subscriptionId } },
        subscriptionPricePoint: { data: { type: 'subscriptionPricePoints', id: pricePointId } },
      },
    });
  }

  /* ----------------------------------------------------------------------- */
  /*  Subscription offers — offer codes, promotional/introductory/win-back    */
  /*  offers, and promoted-purchase ordering. Consumed by `launch offers`     */
  /*  (core/offers.ts). Wire bodies are built from the generated #56 spec     */
  /*  types so the exact billing shapes are typecheck-enforced.               */
  /* ----------------------------------------------------------------------- */

  /** List a subscription's offer-code campaigns (the reconciler's `name`-keyed idempotency set). */
  async listSubscriptionOfferCodes(subscriptionId: string): Promise<OfferCodeResource[]> {
    const data = await this.requestAll<{ name?: string; active?: boolean }>(
      `/subscriptions/${subscriptionId}/offerCodes?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      name: entry.attributes.name ?? '',
      active: entry.attributes.active ?? false,
    }));
  }

  /** Create an offer-code campaign with its per-territory prices (temp-id + `included` inline pattern). */
  async createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
    const body: components['schemas']['SubscriptionOfferCodeCreateRequest'] = {
      data: {
        type: 'subscriptionOfferCodes',
        attributes: {
          name: input.name,
          customerEligibilities: input.customerEligibilities,
          offerEligibility: input.offerEligibility,
          duration: input.duration,
          offerMode: input.offerMode,
          numberOfPeriods: input.numberOfPeriods,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: 'subscriptionOfferCodePrices',
              id: `price-${index}`,
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: 'subscriptionOfferCodePrices',
        id: `price-${index}`,
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      })),
    };
    const { data } = await this.request<ResourceSingle<{ name?: string; active?: boolean }>>(
      'POST',
      '/subscriptionOfferCodes',
      body,
    );
    return {
      id: data.id,
      name: data.attributes.name ?? input.name,
      active: data.attributes.active ?? true,
    };
  }

  /** Deactivate an offer-code campaign (Apple only lets you toggle `active`, never edit the terms). */
  async deactivateOfferCode(offerCodeId: string): Promise<void> {
    const body: components['schemas']['SubscriptionOfferCodeUpdateRequest'] = {
      data: { type: 'subscriptionOfferCodes', id: offerCodeId, attributes: { active: false } },
    };
    await this.request<unknown>('PATCH', `/subscriptionOfferCodes/${offerCodeId}`, body);
  }

  /** Generate a batch of one-time-use codes under an offer-code campaign. */
  async createOfferCodeOneTimeUseBatch(
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void> {
    const body: components['schemas']['SubscriptionOfferCodeOneTimeUseCodeCreateRequest'] = {
      data: {
        type: 'subscriptionOfferCodeOneTimeUseCodes',
        attributes: { numberOfCodes, expirationDate },
        relationships: { offerCode: { data: { type: 'subscriptionOfferCodes', id: offerCodeId } } },
      },
    };
    await this.request<unknown>('POST', '/subscriptionOfferCodeOneTimeUseCodes', body);
  }

  /** Create a custom (shareable) code under an offer-code campaign, redeemable `numberOfCodes` times. */
  async createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> {
    const body: components['schemas']['SubscriptionOfferCodeCustomCodeCreateRequest'] = {
      data: {
        type: 'subscriptionOfferCodeCustomCodes',
        attributes: { customCode, numberOfCodes, ...(expirationDate ? { expirationDate } : {}) },
        relationships: { offerCode: { data: { type: 'subscriptionOfferCodes', id: offerCodeId } } },
      },
    };
    await this.request<unknown>('POST', '/subscriptionOfferCodeCustomCodes', body);
  }

  /** List a subscription's promotional offers (keyed by the StoreKit-facing `offerCode`). */
  async listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferResource[]> {
    const data = await this.requestAll<{ name?: string; offerCode?: string }>(
      `/subscriptions/${subscriptionId}/promotionalOffers?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      name: entry.attributes.name ?? '',
      offerCode: entry.attributes.offerCode ?? '',
    }));
  }

  /** Create a promotional offer with its per-territory prices. */
  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    const body: components['schemas']['SubscriptionPromotionalOfferCreateRequest'] = {
      data: {
        type: 'subscriptionPromotionalOffers',
        attributes: {
          duration: input.duration,
          name: input.name,
          numberOfPeriods: input.numberOfPeriods,
          offerCode: input.offerCode,
          offerMode: input.offerMode,
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: 'subscriptionPromotionalOfferPrices',
              id: `price-${index}`,
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: 'subscriptionPromotionalOfferPrices',
        id: `price-${index}`,
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      })),
    };
    const { data } = await this.request<ResourceSingle<{ name?: string; offerCode?: string }>>(
      'POST',
      '/subscriptionPromotionalOffers',
      body,
    );
    return {
      id: data.id,
      name: data.attributes.name ?? input.name,
      offerCode: data.attributes.offerCode ?? input.offerCode,
    };
  }

  /** List a subscription's introductory offers, keyed by territory (null = an all-territories offer). */
  async listIntroductoryOffers(subscriptionId: string): Promise<IntroductoryOfferResource[]> {
    const { data } = await this.request<{
      data: { id: string; relationships?: { territory?: { data?: { id: string } | null } } }[];
    }>('GET', `/subscriptions/${subscriptionId}/introductoryOffers?include=territory&limit=200`);
    return data.map((entry) => ({
      id: entry.id,
      territory: entry.relationships?.territory?.data?.id ?? null,
    }));
  }

  /** Create an introductory offer for one territory (or all territories when `territory`/`price` are null). */
  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
    const body: components['schemas']['SubscriptionIntroductoryOfferCreateRequest'] = {
      data: {
        type: 'subscriptionIntroductoryOffers',
        attributes: {
          duration: input.duration,
          offerMode: input.offerMode,
          numberOfPeriods: input.numberOfPeriods,
          ...(input.startDate ? { startDate: input.startDate } : {}),
          ...(input.endDate ? { endDate: input.endDate } : {}),
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          ...(input.territory
            ? { territory: { data: { type: 'territories', id: input.territory } } }
            : {}),
          ...(input.price
            ? {
                subscriptionPricePoint: {
                  data: { type: 'subscriptionPricePoints', id: input.price.pricePointId },
                },
              }
            : {}),
        },
      },
    };
    await this.request<unknown>('POST', '/subscriptionIntroductoryOffers', body);
  }

  /** List a subscription's win-back offers, keyed by the stable `offerId`. */
  async listWinBackOffers(subscriptionId: string): Promise<WinBackOfferResource[]> {
    const data = await this.requestAll<{ offerId?: string }>(
      `/subscriptions/${subscriptionId}/winBackOffers?limit=200`,
    );
    return data.map((entry) => ({ id: entry.id, offerId: entry.attributes.offerId ?? '' }));
  }

  /** Create a win-back offer with its lapsed-customer eligibility windows and per-territory prices. */
  async createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    const body: components['schemas']['WinBackOfferCreateRequest'] = {
      data: {
        type: 'winBackOffers',
        attributes: {
          referenceName: input.referenceName,
          offerId: input.offerId,
          duration: input.duration,
          offerMode: input.offerMode,
          periodCount: input.numberOfPeriods,
          customerEligibilityPaidSubscriptionDurationInMonths: input.eligiblePaidMonths,
          customerEligibilityTimeSinceLastSubscribedInMonths: {
            minimum: input.monthsSinceLastSubscribed.min,
            maximum: input.monthsSinceLastSubscribed.max,
          },
          ...(input.waitBetweenOffersMonths !== undefined
            ? { customerEligibilityWaitBetweenOffersInMonths: input.waitBetweenOffersMonths }
            : {}),
          startDate: input.startDate,
          ...(input.endDate ? { endDate: input.endDate } : {}),
          priority: input.priority,
          ...(input.promotionIntent ? { promotionIntent: input.promotionIntent } : {}),
        },
        relationships: {
          subscription: { data: { type: 'subscriptions', id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: 'winBackOfferPrices',
              id: `price-${index}`,
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: 'winBackOfferPrices',
        id: `price-${index}`,
        relationships: {
          territory: { data: { type: 'territories', id: price.territory } },
          subscriptionPricePoint: {
            data: { type: 'subscriptionPricePoints', id: price.pricePointId },
          },
        },
      })),
    };
    await this.request<unknown>('POST', '/winBackOffers', body);
  }

  /** List an app's promoted purchases in their current product-page order, with each one's product linkage. */
  async listPromotedPurchases(appId: string): Promise<PromotedPurchaseResource[]> {
    const all: PromotedPurchaseResource[] = [];
    let next: string | undefined = `/apps/${appId}/promotedPurchases?limit=200`;
    while (next) {
      const page: PromotedPurchasePage = await this.request<PromotedPurchasePage>('GET', next);
      for (const entry of page.data) {
        all.push({
          id: entry.id,
          inAppPurchaseId: entry.relationships?.inAppPurchaseV2?.data?.id ?? null,
          subscriptionId: entry.relationships?.subscription?.data?.id ?? null,
          enabled: entry.attributes?.enabled ?? false,
          visibleForAllUsers: entry.attributes?.visibleForAllUsers ?? false,
        });
      }
      next = page.links?.next;
    }
    return all;
  }

  /** Register a promoted purchase for one product (subscription or IAP) on an app. */
  async createPromotedPurchase(input: PromotedPurchaseCreate): Promise<PromotedPurchaseResource> {
    const body: components['schemas']['PromotedPurchaseCreateRequest'] = {
      data: {
        type: 'promotedPurchases',
        attributes: { visibleForAllUsers: input.visibleForAllUsers, enabled: input.enabled },
        relationships: {
          app: { data: { type: 'apps', id: input.appId } },
          ...(input.inAppPurchaseId
            ? { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: input.inAppPurchaseId } } }
            : {}),
          ...(input.subscriptionId
            ? { subscription: { data: { type: 'subscriptions', id: input.subscriptionId } } }
            : {}),
        },
      },
    };
    const { data } = await this.request<
      ResourceSingle<{ enabled?: boolean; visibleForAllUsers?: boolean }>
    >('POST', '/promotedPurchases', body);
    return {
      id: data.id,
      inAppPurchaseId: input.inAppPurchaseId ?? null,
      subscriptionId: input.subscriptionId ?? null,
      enabled: data.attributes.enabled ?? input.enabled,
      visibleForAllUsers: data.attributes.visibleForAllUsers ?? input.visibleForAllUsers,
    };
  }

  /** Replace the app's promoted-purchase ordering with `orderedIds` (the product-page display order). */
  async reorderPromotedPurchases(appId: string, orderedIds: string[]): Promise<void> {
    const body: components['schemas']['AppPromotedPurchasesLinkagesRequest'] = {
      data: orderedIds.map((id) => ({ type: 'promotedPurchases', id })),
    };
    await this.request<unknown>('PATCH', `/apps/${appId}/relationships/promotedPurchases`, body);
  }

  /** Whether an in-app purchase already has a price schedule (so the reconciler skips re-pricing it). */
  async inAppPurchaseHasPrice(iapId: string): Promise<boolean> {
    // No schedule yet reads as a 404 on some accounts — {@link getOptional} maps that to "unpriced".
    const schedule = await this.getOptional(() =>
      // Same v2 relationship path as the localizations read — the bare /v1 inAppPurchasesV2/{id} form 404s.
      this.request<{ data: { id: string } | null }>(
        'GET',
        this.v2(`/inAppPurchases/${iapId}/iapPriceSchedule`),
      ),
    );
    return schedule?.data != null;
  }

  /** Find the IAP price point in `territory` whose customer price equals `customerPrice`, or null. */
  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.requestAll<{ customerPrice?: string; territory?: string }>(
      this.v2(
        `/inAppPurchases/${iapId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
      ),
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  /**
   * Set an IAP's price by creating a price schedule anchored on a base territory's price point. The
   * relationship references a client-supplied temp id that the `included` price resource carries —
   * the JSON:API pattern Apple requires here — and a `baseTerritory` is mandatory (omitting it returns
   * Apple's `BASE_TERRITORY_INTERVAL_REQUIRED` 409).
   */
  async createInAppPurchasePriceSchedule(
    iapId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    // Apple's JSON:API inline creation requires the temp id wrapped as ${local-id} (a bare string 409s
    // "invalid format"); the same const feeds both the relationship and the included price so they match.
    const priceRef = '${launch-base-price}';
    await this.request<unknown>('POST', '/inAppPurchasePriceSchedules', {
      data: {
        type: 'inAppPurchasePriceSchedules',
        relationships: {
          inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'inAppPurchasePrices', id: priceRef }] },
        },
      },
      included: [
        {
          type: 'inAppPurchasePrices',
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } },
            inAppPurchasePricePoint: {
              data: { type: 'inAppPurchasePricePoints', id: pricePointId },
            },
          },
        },
      ],
    });
  }

  /* ------------------------------------------------------------------------ */
  /*  TestFlight management — beta groups + testers. Consumed by the           */
  /*  `launch testflight` command; independent of the build/sign path.         */
  /*  (Hand-typed JSON:API shapes; migrate to the generated spec types — #56.) */
  /* ------------------------------------------------------------------------ */

  /** List an app's TestFlight beta groups (internal + external), across all pages. */
  async listBetaGroups(appId: string): Promise<BetaGroupResource[]> {
    const data = await this.requestAll<{
      name?: string;
      isInternalGroup?: boolean;
      publicLink?: string | null;
    }>(`/apps/${appId}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,publicLink`);
    return data.flatMap((entry) =>
      entry.attributes.name
        ? [
            {
              id: entry.id,
              name: entry.attributes.name,
              ...(entry.attributes.isInternalGroup === undefined
                ? {}
                : { isInternal: entry.attributes.isInternalGroup }),
              ...(entry.attributes.publicLink ? { publicLink: entry.attributes.publicLink } : {}),
            },
          ]
        : [],
    );
  }

  /** Find an app's beta group by exact, case-insensitive name, or null when there's no such group. */
  async findBetaGroupByName(appId: string, name: string): Promise<BetaGroupResource | null> {
    const wanted = name.toLowerCase();
    return (
      (await this.listBetaGroups(appId)).find((group) => group.name.toLowerCase() === wanted) ??
      null
    );
  }

  /** Create an external beta group on an app — the bucket external testers are invited into. */
  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    const data = await this.createResource<{ name?: string }>('/betaGroups', {
      type: 'betaGroups',
      attributes: { name },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return { id: data.id, name: data.attributes.name ?? name };
  }

  /** List the testers in a beta group, across all pages. */
  async listBetaTestersInGroup(groupId: string): Promise<BetaTesterResource[]> {
    return this.betaTestersFrom(
      `/betaGroups/${groupId}/betaTesters?limit=200&fields[betaTesters]=email,firstName,lastName,state`,
    );
  }

  /**
   * Find a tester by email anywhere on the team, or null. Testers are team-scoped, so a hit here is the
   * person to link into a group rather than re-create; {@link createBetaTester} would otherwise 409.
   */
  async findBetaTesterByEmail(email: string): Promise<BetaTesterResource | null> {
    const wanted = email.toLowerCase();
    const data = await this.betaTestersFrom(
      `/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=1&fields[betaTesters]=email,firstName,lastName,state`,
    );
    return data.find((tester) => tester.email.toLowerCase() === wanted) ?? data[0] ?? null;
  }

  /**
   * Create a tester and add them to a beta group in one call — for an external group this sends the
   * TestFlight invite email. Use {@link addTestersToGroup} instead when the tester already exists on
   * the team (an existing email here returns Apple's 409).
   */
  async createBetaTester(
    groupId: string,
    input: { email: string; firstName?: string; lastName?: string },
  ): Promise<BetaTesterResource> {
    const data = await this.createResource<{
      email?: string;
      firstName?: string;
      lastName?: string;
      state?: string;
    }>('/betaTesters', {
      type: 'betaTesters',
      attributes: {
        email: input.email,
        ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
        ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
      },
      relationships: { betaGroups: { data: [{ type: 'betaGroups', id: groupId }] } },
    });
    return {
      id: data.id,
      email: data.attributes.email ?? input.email,
      ...(data.attributes.firstName ? { firstName: data.attributes.firstName } : {}),
      ...(data.attributes.lastName ? { lastName: data.attributes.lastName } : {}),
      ...(data.attributes.state ? { state: data.attributes.state } : {}),
    };
  }

  /** Add existing testers to a beta group in one relationship call (invites external testers). */
  async addTestersToGroup(groupId: string, testerIds: string[]): Promise<void> {
    await this.request<unknown>('POST', `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: 'betaTesters', id })),
    });
  }

  /** Remove testers from a beta group; they keep app access through any other group they're in. */
  async removeTestersFromGroup(groupId: string, testerIds: string[]): Promise<void> {
    await this.request<unknown>('DELETE', `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: 'betaTesters', id })),
    });
  }

  /** Shared GET → {@link BetaTesterResource}[] for any beta-tester collection (group members or a lookup). */
  private async betaTestersFrom(path: string): Promise<BetaTesterResource[]> {
    const data = await this.requestAll<{
      email?: string;
      firstName?: string;
      lastName?: string;
      state?: string;
    }>(path);
    return data.flatMap((entry) =>
      entry.attributes.email
        ? [
            {
              id: entry.id,
              email: entry.attributes.email,
              ...(entry.attributes.firstName ? { firstName: entry.attributes.firstName } : {}),
              ...(entry.attributes.lastName ? { lastName: entry.attributes.lastName } : {}),
              ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
            },
          ]
        : [],
    );
  }

  /**
   * Resolve the app's editable App Info — the record that owns App Store categories and the age-rating
   * declaration — with its current category ids. Apps can have a live + an editable App Info; we prefer
   * one in an editable {@link EDITABLE_METADATA_STATES editable state} and fall back to the first.
   * `include=primaryCategory,secondaryCategory` forces Apple to populate the relationship linkage so we
   * can read the current category ids without a second round-trip. Returns null when the app has none.
   */
  async getAppInfo(appId: string): Promise<AppInfoResource | null> {
    const { data } = await this.request<{
      data: {
        id: string;
        attributes?: { state?: string; appStoreState?: string };
        relationships?: {
          primaryCategory?: { data?: { id: string } | null };
          secondaryCategory?: { data?: { id: string } | null };
        };
      }[];
    }>('GET', `/apps/${appId}/appInfos?include=primaryCategory,secondaryCategory&limit=200`);
    if (data.length === 0) return null;
    const editable = data.find((info) =>
      EDITABLE_METADATA_STATES.has(info.attributes?.state ?? info.attributes?.appStoreState ?? ''),
    );
    const target = editable ?? data[0];
    if (!target) return null;
    const state = target.attributes?.state ?? target.attributes?.appStoreState;
    const primaryCategoryId = target.relationships?.primaryCategory?.data?.id;
    const secondaryCategoryId = target.relationships?.secondaryCategory?.data?.id;
    return {
      id: target.id,
      ...(state ? { state } : {}),
      ...(primaryCategoryId ? { primaryCategoryId } : {}),
      ...(secondaryCategoryId ? { secondaryCategoryId } : {}),
    };
  }

  /**
   * Set an App Info's primary/secondary App Store categories. Categories are JSON:API *relationships*
   * (type `appCategories`, id e.g. `PRODUCTIVITY`), not attributes; only the keys passed are sent, so
   * the reconciler can change one without clearing the other.
   */
  async updateAppInfoCategories(
    appInfoId: string,
    categories: { primaryCategoryId?: string; secondaryCategoryId?: string },
  ): Promise<void> {
    const relationships: Record<string, { data: { type: 'appCategories'; id: string } }> = {};
    if (categories.primaryCategoryId) {
      relationships['primaryCategory'] = {
        data: { type: 'appCategories', id: categories.primaryCategoryId },
      };
    }
    if (categories.secondaryCategoryId) {
      relationships['secondaryCategory'] = {
        data: { type: 'appCategories', id: categories.secondaryCategoryId },
      };
    }
    await this.request<unknown>('PATCH', `/appInfos/${appInfoId}`, {
      data: { type: 'appInfos', id: appInfoId, relationships },
    });
  }

  /** Read an App Info's age-rating declaration (its current answers), or null when none exists yet. */
  async getAgeRatingDeclaration(appInfoId: string): Promise<AgeRatingDeclarationResource | null> {
    return this.getOptional(async () => {
      const { data } = await this.request<{
        data: { id: string; attributes?: Record<string, AgeRatingValue> } | null;
      }>('GET', `/appInfos/${appInfoId}/ageRatingDeclaration`);
      return data ? { id: data.id, attributes: data.attributes ?? {} } : null;
    });
  }

  /** Update an age-rating declaration with the given answers (only the supplied keys are changed). */
  async updateAgeRatingDeclaration(
    declarationId: string,
    attributes: Record<string, AgeRatingValue>,
  ): Promise<void> {
    await this.updateResource(`/ageRatingDeclarations/${declarationId}`, {
      type: 'ageRatingDeclarations',
      id: declarationId,
      attributes,
    });
  }

  /**
   * List an app's accessibility declarations — at most one live (`DRAFT`/`PUBLISHED`) per device family,
   * plus any `REPLACED` history a prior publish left behind. Returns [] when the app has none yet. Rows
   * Apple returns without a `deviceFamily` are dropped, since the family is the reconcile key.
   */
  async listAccessibilityDeclarations(appId: string): Promise<AccessibilityDeclarationResource[]> {
    const rows = await this.requestAll<AccessibilityDeclarationAttributes>(
      `/apps/${appId}/accessibilityDeclarations?limit=200`,
    );
    return rows.flatMap((row) =>
      row.attributes.deviceFamily
        ? [
            {
              id: row.id,
              deviceFamily: row.attributes.deviceFamily,
              state: row.attributes.state ?? 'DRAFT',
              support: pickAccessibilitySupport(row.attributes),
            },
          ]
        : [],
    );
  }

  /** Create a `DRAFT` accessibility declaration for one device family with the given support flags. */
  async createAccessibilityDeclaration(
    appId: string,
    deviceFamily: DeviceFamily,
    support: AccessibilitySupport,
  ): Promise<AccessibilityDeclarationResource> {
    const { data } = await this.request<{
      data: { id: string; attributes?: AccessibilityDeclarationAttributes };
    }>('POST', '/accessibilityDeclarations', {
      data: {
        type: 'accessibilityDeclarations',
        attributes: { deviceFamily, ...support },
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    });
    return {
      id: data.id,
      deviceFamily,
      state: data.attributes?.state ?? 'DRAFT',
      support: pickAccessibilitySupport(data.attributes ?? {}),
    };
  }

  /**
   * Update an accessibility declaration's support flags and/or publish it. `publish: true` moves a `DRAFT`
   * live; only the supplied keys change. Apple keeps the publish flag separate from the support booleans,
   * so a caller can publish an unchanged draft by passing `{ publish: true }` alone.
   */
  async updateAccessibilityDeclaration(
    declarationId: string,
    changes: AccessibilitySupport & { publish?: boolean },
  ): Promise<void> {
    await this.updateResource(`/accessibilityDeclarations/${declarationId}`, {
      type: 'accessibilityDeclarations',
      id: declarationId,
      attributes: changes,
    });
  }

  /**
   * Read an app's store availability — the `availableInNewTerritories` flag plus every territory code it's
   * for sale in — or null when the app has no availability set yet. The territory list is paged through in
   * full (Apple links past the first page), keeping each row's `territory` relationship so the code survives
   * (which {@link requestAll} would drop).
   */
  async getAppAvailability(appId: string): Promise<AppAvailabilityResource | null> {
    const head = await this.getOptional<{
      data: { id: string; attributes?: { availableInNewTerritories?: boolean } } | null;
    }>(() => this.request('GET', `/apps/${appId}/appAvailabilityV2`));
    if (!head?.data) return null;

    const availableTerritories: string[] = [];
    let next: string | undefined =
      `${this.v2(`/appAvailabilities/${head.data.id}/territoryAvailabilities`)}?fields[territoryAvailabilities]=available,territory&limit=200`;
    while (next) {
      const page: TerritoryAvailabilityPage = await this.request('GET', next);
      for (const row of page.data) {
        const code = row.relationships?.territory?.data?.id;
        if (row.attributes?.available && code) availableTerritories.push(code);
      }
      next = page.links?.next;
    }
    return {
      id: head.data.id,
      availableInNewTerritories: head.data.attributes?.availableInNewTerritories ?? false,
      availableTerritories,
    };
  }

  /**
   * Set an app's store availability to exactly `territories` (Apple territory codes), with the
   * `availableInNewTerritories` flag. Uses Apple's v2 create-with-inline-`included` shape: each territory
   * becomes an inline `territoryAvailabilities` resource (available, keyed by the territory code) the new
   * `appAvailabilities` references. Creating the singleton replaces the app's current availability.
   */
  async setAppAvailability(
    appId: string,
    input: { availableInNewTerritories: boolean; territories: string[] },
  ): Promise<void> {
    const included = input.territories.map((code) => ({
      type: 'territoryAvailabilities',
      id: code,
      attributes: { available: true },
      relationships: { territory: { data: { type: 'territories', id: code } } },
    }));
    await this.request<unknown>('POST', this.v2('/appAvailabilities'), {
      data: {
        type: 'appAvailabilities',
        attributes: { availableInNewTerritories: input.availableInNewTerritories },
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          territoryAvailabilities: {
            data: included.map((entry) => ({ type: 'territoryAvailabilities', id: entry.id })),
          },
        },
      },
      included,
    });
  }

  /** List an app's custom product pages (alternate listings), matched by name. */
  async listCustomProductPages(appId: string): Promise<CustomProductPageResource[]> {
    const data = await this.requestAll<{ name?: string }>(
      `/apps/${appId}/appCustomProductPages?limit=200&fields[appCustomProductPages]=name`,
    );
    return data.flatMap((entry) =>
      entry.attributes.name ? [{ id: entry.id, name: entry.attributes.name }] : [],
    );
  }

  /** Create a custom product page by name; Apple seeds it with an editable version cloned from the default listing. */
  async createCustomProductPage(appId: string, name: string): Promise<CustomProductPageResource> {
    const data = await this.createResource<Record<string, never>>('/appCustomProductPages', {
      type: 'appCustomProductPages',
      attributes: { name },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return { id: data.id, name };
  }

  /** List a custom product page's versions, so the reconciler can pick the editable one to localize. */
  async listCustomProductPageVersions(pageId: string): Promise<CustomProductPageVersionResource[]> {
    const data = await this.requestAll<{ state?: string }>(
      `/appCustomProductPages/${pageId}/appCustomProductPageVersions?limit=200&fields[appCustomProductPageVersions]=state`,
    );
    return data.map((entry) => ({ id: entry.id, state: entry.attributes.state ?? '' }));
  }

  /** List a custom product page version's per-locale copy (Launch reads/writes `promotionalText`). */
  async listCustomProductPageLocalizations(
    versionId: string,
  ): Promise<CustomProductPageLocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; promotionalText?: string }>(
      `/appCustomProductPageVersions/${versionId}/appCustomProductPageLocalizations?limit=200&fields[appCustomProductPageLocalizations]=locale,promotionalText`,
    );
    return data.flatMap((entry) =>
      entry.attributes.locale
        ? [
            {
              id: entry.id,
              locale: entry.attributes.locale,
              ...(entry.attributes.promotionalText
                ? { promotionalText: entry.attributes.promotionalText }
                : {}),
            },
          ]
        : [],
    );
  }

  /** Create one locale's custom-product-page localization with its promotional text. */
  async createCustomProductPageLocalization(
    versionId: string,
    locale: string,
    promotionalText: string,
  ): Promise<void> {
    await this.createResource('/appCustomProductPageLocalizations', {
      type: 'appCustomProductPageLocalizations',
      attributes: { locale, promotionalText },
      relationships: {
        appCustomProductPageVersion: {
          data: { type: 'appCustomProductPageVersions', id: versionId },
        },
      },
    });
  }

  /** Update one custom-product-page localization's promotional text. */
  async updateCustomProductPageLocalization(
    localizationId: string,
    promotionalText: string,
  ): Promise<void> {
    await this.updateResource(`/appCustomProductPageLocalizations/${localizationId}`, {
      type: 'appCustomProductPageLocalizations',
      id: localizationId,
      attributes: { promotionalText },
    });
  }

  /** List an app's product-page A/B experiments (v2), matched by name. */
  async listVersionExperiments(appId: string): Promise<VersionExperimentResource[]> {
    const data = await this.requestAll<{
      name?: string;
      state?: string;
      trafficProportion?: number;
    }>(
      `/apps/${appId}/appStoreVersionExperimentsV2?limit=200&fields[appStoreVersionExperiments]=name,state,trafficProportion`,
    );
    return data.flatMap((entry) =>
      entry.attributes.name
        ? [
            {
              id: entry.id,
              name: entry.attributes.name,
              state: entry.attributes.state ?? '',
              ...(entry.attributes.trafficProportion !== undefined
                ? { trafficProportion: entry.attributes.trafficProportion }
                : {}),
            },
          ]
        : [],
    );
  }

  /** Create a product-page A/B experiment (v2) with its name, platform, and traffic split. */
  async createVersionExperiment(
    appId: string,
    input: { name: string; platform: string; trafficProportion: number },
  ): Promise<VersionExperimentResource> {
    const data = await this.createResource<Record<string, never>>('/appStoreVersionExperiments', {
      type: 'appStoreVersionExperiments',
      attributes: {
        name: input.name,
        platform: input.platform,
        trafficProportion: input.trafficProportion,
      },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return {
      id: data.id,
      name: input.name,
      state: 'PREPARE_FOR_SUBMISSION',
      trafficProportion: input.trafficProportion,
    };
  }

  /** List a version experiment's treatments (variant arms), matched by name. */
  async listExperimentTreatments(experimentId: string): Promise<ExperimentTreatmentResource[]> {
    const data = await this.requestAll<{ name?: string }>(
      `/appStoreVersionExperiments/${experimentId}/appStoreVersionExperimentTreatments?limit=200&fields[appStoreVersionExperimentTreatments]=name`,
    );
    return data.flatMap((entry) =>
      entry.attributes.name ? [{ id: entry.id, name: entry.attributes.name }] : [],
    );
  }

  /** Create one treatment (variant arm) on a version experiment. */
  async createExperimentTreatment(
    experimentId: string,
    input: { name: string; appIconName?: string },
  ): Promise<ExperimentTreatmentResource> {
    const attributes: { name: string; appIconName?: string } = { name: input.name };
    if (input.appIconName) attributes.appIconName = input.appIconName;
    const data = await this.createResource<Record<string, never>>(
      '/appStoreVersionExperimentTreatments',
      {
        type: 'appStoreVersionExperimentTreatments',
        attributes,
        relationships: {
          appStoreVersionExperimentV2: {
            data: { type: 'appStoreVersionExperiments', id: experimentId },
          },
        },
      },
    );
    return { id: data.id, name: input.name };
  }

  /** Find the app price point in `territory` whose customer price equals `customerPrice`, or null. */
  async findAppPricePoint(
    appId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.requestAll<{ customerPrice?: string; territory?: string }>(
      `/apps/${appId}/appPricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`,
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  /**
   * The app's currently-effective manual customer price for `territory`, or null when none is set there.
   * Reads the price schedule's manual prices with the linked price point sideloaded, so the reconciler
   * can skip re-pricing when the declared price already matches. (Prices Apple auto-generates for other
   * regions live under `automaticPrices`; the declared base price is always a manual one.)
   *
   * `manualPrices` returns past, current, AND future-scheduled intervals — the currently-effective one is
   * the open interval (`startDate` null/past and `endDate` null). We match only that, so a stale or a
   * not-yet-active scheduled price never masquerades as the current price. `limit=200` is ample: manual
   * prices are at most one per territory (≤175) plus a handful of scheduled changes.
   */
  async getCurrentAppPrice(appId: string, territory: string): Promise<string | null> {
    const body = await this.getOptional<{
      data: {
        attributes?: { startDate?: string | null; endDate?: string | null };
        relationships?: { appPricePoint?: { data?: { id: string } | null } };
      }[];
      included?: {
        type: string;
        id: string;
        attributes?: { customerPrice?: string; territory?: string };
      }[];
    }>(() =>
      this.request(
        'GET',
        `/apps/${appId}/appPriceSchedule/manualPrices?include=appPricePoint&limit=200`,
      ),
    );
    if (!body) return null;
    const pointsById = new Map(
      (body.included ?? [])
        .filter((entry) => entry.type === 'appPricePoints')
        .map((entry) => [entry.id, entry.attributes] as const),
    );
    for (const price of body.data) {
      // The active interval has no future start and no scheduled end; skip historical/future entries.
      if (price.attributes?.startDate != null || price.attributes?.endDate != null) continue;
      const pointId = price.relationships?.appPricePoint?.data?.id;
      const point = pointId ? pointsById.get(pointId) : undefined;
      if (point?.territory === territory && point.customerPrice !== undefined)
        return point.customerPrice;
    }
    return null;
  }

  /**
   * Set the app's price by creating a price schedule anchored on a base territory's price point — the
   * app-level twin of {@link createInAppPurchasePriceSchedule}, using the same JSON:API temp-id +
   * `included` pattern Apple requires, with the mandatory `baseTerritory` (omitting it returns a 409).
   */
  async createAppPriceSchedule(
    appId: string,
    baseTerritory: string,
    pricePointId: string,
  ): Promise<void> {
    // Apple's JSON:API inline creation requires the temp id wrapped as ${local-id} (a bare string 409s
    // "invalid format"); the same const feeds both the relationship and the included price so they match.
    const priceRef = '${launch-base-price}';
    await this.request<unknown>('POST', '/appPriceSchedules', {
      data: {
        type: 'appPriceSchedules',
        relationships: {
          app: { data: { type: 'apps', id: appId } },
          baseTerritory: { data: { type: 'territories', id: baseTerritory } },
          manualPrices: { data: [{ type: 'appPrices', id: priceRef }] },
        },
      },
      included: [
        {
          type: 'appPrices',
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            app: { data: { type: 'apps', id: appId } },
            appPricePoint: { data: { type: 'appPricePoints', id: pricePointId } },
          },
        },
      ],
    });
  }

  /**
   * Find the app's editable App Store version for a platform (the one whose App Review details can still
   * be changed), or null when none is in an {@link EDITABLE_METADATA_STATES editable state}.
   */
  async findEditableAppStoreVersion(
    appId: string,
    platform: string,
  ): Promise<{ id: string } | null> {
    const data = await this.requestAll<{ appVersionState?: string; appStoreState?: string }>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=50&fields[appStoreVersions]=appVersionState,appStoreState`,
    );
    const editable = data.find((version) =>
      EDITABLE_METADATA_STATES.has(
        version.attributes.appVersionState ?? version.attributes.appStoreState ?? '',
      ),
    );
    return editable ? { id: editable.id } : null;
  }

  /** Read a version's App Review details (contact info; never the demo password), or null when unset. */
  async getAppStoreReviewDetail(versionId: string): Promise<AppStoreReviewDetailResource | null> {
    return this.getOptional(async () => {
      const { data } = await this.request<{
        data: { id: string; attributes?: Record<string, string | boolean> } | null;
      }>('GET', `/appStoreVersions/${versionId}/appStoreReviewDetail`);
      return data ? { id: data.id, attributes: data.attributes ?? {} } : null;
    });
  }

  /** Create a version's App Review details from the given attributes. */
  async createAppStoreReviewDetail(
    versionId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<{ id: string }> {
    const data = await this.createResource('/appStoreReviewDetails', {
      type: 'appStoreReviewDetails',
      attributes,
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    return { id: data.id };
  }

  /** Update a version's existing App Review details (only the supplied attributes change). */
  async updateAppStoreReviewDetail(
    detailId: string,
    attributes: Record<string, string | boolean>,
  ): Promise<void> {
    await this.updateResource(`/appStoreReviewDetails/${detailId}`, {
      type: 'appStoreReviewDetails',
      id: detailId,
      attributes,
    });
  }

  /** Shared GET → {@link LocalizationResource}[] for any product/subscription/group localization collection. */
  private async localizationsFrom(path: string): Promise<LocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; name?: string; description?: string }>(
      path,
    );
    return data.flatMap((entry) =>
      entry.attributes.locale && entry.attributes.name
        ? [
            {
              id: entry.id,
              locale: entry.attributes.locale,
              name: entry.attributes.name,
              ...(entry.attributes.description
                ? { description: entry.attributes.description }
                : {}),
            },
          ]
        : [],
    );
  }

  /** Shared POST for any localization resource, parameterized by its type and parent relationship. */
  private async createLocalization(
    resourceType: string,
    relationshipName: string,
    parentType: string,
    parentId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    const data = await this.createResource<{
      locale?: string;
      name?: string;
      description?: string;
    }>(`/${resourceType}`, {
      type: resourceType,
      attributes: {
        locale: input.locale,
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
      },
      relationships: { [relationshipName]: { data: { type: parentType, id: parentId } } },
    });
    return {
      id: data.id,
      locale: data.attributes.locale ?? input.locale,
      name: data.attributes.name ?? input.name,
      ...(data.attributes.description ? { description: data.attributes.description } : {}),
    };
  }

  /* ------------------------------------------------------------------------ */
  /*  Customer reviews — read reviews and create/replace/delete the developer  */
  /*  response. Consumed by `launch reviews` (core/reviews.ts).                 */
  /* ------------------------------------------------------------------------ */

  /**
   * List an app's customer reviews, newest first, across all pages. Fetched with `include=response`
   * so each row carries {@link CustomerReviewResource.answered} without a follow-up call;
   * `filter[rating]` / `filter[territory]` narrow server-side when provided.
   */
  async listCustomerReviews(
    appId: string,
    filters: { rating?: number; territory?: string } = {},
  ): Promise<CustomerReviewResource[]> {
    let path = `/apps/${appId}/customerReviews?include=response&sort=-createdDate&limit=200`;
    if (filters.rating !== undefined) path += `&filter[rating]=${filters.rating}`;
    if (filters.territory) path += `&filter[territory]=${encodeURIComponent(filters.territory)}`;

    const reviews: CustomerReviewResource[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: CustomerReviewPage = await this.request<CustomerReviewPage>('GET', next);
      for (const { id, attributes, relationships } of page.data) {
        reviews.push({
          id,
          rating: typeof attributes.rating === 'number' ? attributes.rating : 0,
          ...(attributes.title ? { title: attributes.title } : {}),
          ...(attributes.body ? { body: attributes.body } : {}),
          ...(attributes.reviewerNickname ? { reviewerNickname: attributes.reviewerNickname } : {}),
          ...(attributes.territory ? { territory: attributes.territory } : {}),
          ...(attributes.createdDate ? { createdDate: attributes.createdDate } : {}),
          answered: Boolean(relationships?.response?.data),
        });
      }
      next = page.links?.next;
    }
    return reviews;
  }

  /** Read the developer response attached to a review, or null when none exists yet (Apple 404s on none). */
  async getCustomerReviewResponse(
    reviewId: string,
  ): Promise<CustomerReviewResponseResource | null> {
    return this.getOptional(async () => {
      const { data } = await this.request<{
        data: {
          id: string;
          attributes: { responseBody?: string; state?: string; lastModifiedDate?: string };
        } | null;
      }>('GET', `/customerReviews/${reviewId}/response`);
      return data ? toReviewResponse(data) : null;
    });
  }

  /**
   * Create or replace the developer response to a review. Apple's `POST /v1/customerReviewResponses`
   * is an upsert — it replaces an existing response in place — so callers never delete-then-recreate.
   */
  async createCustomerReviewResponse(
    reviewId: string,
    responseBody: string,
  ): Promise<CustomerReviewResponseResource> {
    const data = await this.createResource<{
      responseBody?: string;
      state?: string;
      lastModifiedDate?: string;
    }>('/customerReviewResponses', {
      type: 'customerReviewResponses',
      attributes: { responseBody },
      relationships: { review: { data: { type: 'customerReviews', id: reviewId } } },
    });
    return toReviewResponse(data);
  }

  /** Delete a developer response by its resource id. */
  async deleteCustomerReviewResponse(responseId: string): Promise<void> {
    await this.deleteResource(`/customerReviewResponses/${responseId}`);
  }

  /* ------------------------------------------------------------------------ */
  /*  TestFlight beta feedback — read tester crash & screenshot submissions.    */
  /*  Consumed by `launch testflight feedback` (core/testflightFeedback.ts).    */
  /* ------------------------------------------------------------------------ */

  /**
   * List an app's TestFlight crash-feedback submissions, newest first, across all pages. Uses the
   * `getToManyRelated` endpoint (which returns full resources, unlike the bare `relationships` linkage)
   * with `include=build` so each row's build version resolves from the page's `included` builds.
   * `query.buildId` narrows server-side via Apple's `filter[build]` (a build *resource id*).
   */
  async listBetaFeedbackCrashSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackCrashSubmissionResource[]> {
    const rows = await this.listBetaFeedback(`/apps/${appId}/betaFeedbackCrashSubmissions`, query);
    return rows.map((row) => row.base);
  }

  /**
   * List an app's TestFlight screenshot-feedback submissions, newest first, across all pages. Same
   * read shape as {@link listBetaFeedbackCrashSubmissions}, plus each row's attached screenshots
   * (presigned, short-lived image URLs); rows without a usable URL are dropped from `screenshots`.
   */
  async listBetaFeedbackScreenshotSubmissions(
    appId: string,
    query: BetaFeedbackQuery = {},
  ): Promise<BetaFeedbackScreenshotSubmissionResource[]> {
    const rows = await this.listBetaFeedback(
      `/apps/${appId}/betaFeedbackScreenshotSubmissions`,
      query,
      true,
    );
    return rows.map((row) => ({ ...row.base, screenshots: row.screenshots }));
  }

  /**
   * Shared paginating read for both beta-feedback resources. Walks `links.next`, resolves each row's
   * build version from the page's `included` builds, and (when `withScreenshots`) flattens the screenshot
   * attachments. Returns the common base for crashes; the screenshot reader layers its attachments on top.
   */
  private async listBetaFeedback(
    relatedPath: string,
    query: BetaFeedbackQuery,
    withScreenshots = false,
  ): Promise<BetaFeedbackRow[]> {
    let path = `${relatedPath}?include=build&sort=-createdDate&limit=200`;
    if (query.buildId) path += `&filter[build]=${encodeURIComponent(query.buildId)}`;

    const rows: BetaFeedbackRow[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: BetaFeedbackPage = await this.request<BetaFeedbackPage>('GET', next);
      const buildVersionById = new Map<string, string>();
      for (const entry of page.included ?? []) {
        if (entry.type === 'builds' && entry.attributes?.version)
          buildVersionById.set(entry.id, entry.attributes.version);
      }
      for (const { id, attributes, relationships } of page.data) {
        const buildId = relationships?.build?.data?.id;
        const buildVersion = buildId ? buildVersionById.get(buildId) : undefined;
        const base: BetaFeedbackSubmissionResource = {
          id,
          ...(attributes?.createdDate ? { createdDate: attributes.createdDate } : {}),
          ...(attributes?.comment ? { comment: attributes.comment } : {}),
          ...(attributes?.email ? { email: attributes.email } : {}),
          ...(attributes?.deviceModel ? { deviceModel: attributes.deviceModel } : {}),
          ...(attributes?.osVersion ? { osVersion: attributes.osVersion } : {}),
          ...(buildVersion ? { buildVersion } : {}),
        };
        const screenshots = withScreenshots ? toFeedbackScreenshots(attributes?.screenshots) : [];
        rows.push({ base, screenshots });
      }
      next = page.links?.next;
    }
    return rows;
  }

  /**
   * Download a beta-feedback screenshot from its presigned URL. Like {@link downloadAnalyticsSegment},
   * the URL carries its own query-string auth, so this is an UNauthenticated fetch — adding the API
   * Bearer would make Apple's asset host reject the request for presenting two auth mechanisms.
   */
  async downloadBetaFeedbackScreenshot(url: string): Promise<Buffer> {
    return withRetry(
      async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new AscRequestError(
            `Beta feedback screenshot download failed (${response.status}).`,
            response.status,
          );
        }
        return Buffer.from(await response.arrayBuffer());
      },
      { isRetryable: isRetryableAscError },
    );
  }

  // ── App Store Connect team: users & invitations (`launch team`) ────────────────────────────────────

  /** List the App Store Connect team members (people who have accepted access). */
  async listUsers(): Promise<UserResource[]> {
    const data = await this.requestAll<{
      username?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
    }>('/users?limit=200&fields[users]=username,firstName,lastName,roles');
    return data.map((entry) => ({
      id: entry.id,
      username: entry.attributes.username ?? '',
      ...(entry.attributes.firstName ? { firstName: entry.attributes.firstName } : {}),
      ...(entry.attributes.lastName ? { lastName: entry.attributes.lastName } : {}),
      roles: entry.attributes.roles ?? [],
    }));
  }

  /** List the pending (not-yet-accepted) team invitations. */
  async listUserInvitations(): Promise<UserInvitationResource[]> {
    const data = await this.requestAll<{
      email?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
      expirationDate?: string;
    }>(
      '/userInvitations?limit=200&fields[userInvitations]=email,firstName,lastName,roles,expirationDate',
    );
    return data.map((entry) => ({
      id: entry.id,
      email: entry.attributes.email ?? '',
      ...(entry.attributes.firstName ? { firstName: entry.attributes.firstName } : {}),
      ...(entry.attributes.lastName ? { lastName: entry.attributes.lastName } : {}),
      roles: entry.attributes.roles ?? [],
      ...(entry.attributes.expirationDate
        ? { expirationDate: entry.attributes.expirationDate }
        : {}),
    }));
  }

  /** Invite a new team member by email with the given roles; returns the created pending invitation. */
  async inviteUser(invite: NewUserInvitation): Promise<UserInvitationResource> {
    const data = await this.createResource<{
      email?: string;
      firstName?: string;
      lastName?: string;
      roles?: string[];
      expirationDate?: string;
    }>('/userInvitations', {
      type: 'userInvitations',
      attributes: {
        email: invite.email,
        firstName: invite.firstName,
        lastName: invite.lastName,
        roles: invite.roles,
        allAppsVisible: invite.allAppsVisible,
        provisioningAllowed: invite.provisioningAllowed,
      },
    });
    return {
      id: data.id,
      email: data.attributes.email ?? invite.email,
      ...(data.attributes.firstName ? { firstName: data.attributes.firstName } : {}),
      ...(data.attributes.lastName ? { lastName: data.attributes.lastName } : {}),
      roles: data.attributes.roles ?? invite.roles,
      ...(data.attributes.expirationDate ? { expirationDate: data.attributes.expirationDate } : {}),
    };
  }

  /** Remove a team member (an accepted user) by their resource id — revokes their access. */
  async deleteUser(userId: string): Promise<void> {
    await this.deleteResource(`/users/${userId}`);
  }

  /** Cancel a pending invitation by its resource id. */
  async cancelUserInvitation(invitationId: string): Promise<void> {
    await this.deleteResource(`/userInvitations/${invitationId}`);
  }

  /* ------------------------------------------------------------------------ */
  /*  Reports — Sales & Trends / Finance (gzipped TSV) and the Analytics       */
  /*  Reports flow. Consumed by `launch reports` (core/reports.ts).            */
  /* ------------------------------------------------------------------------ */

  /** Download a Sales & Trends report as raw gzip bytes (the caller decompresses + parses the TSV). */
  async getSalesReport(query: SalesReportQuery): Promise<Buffer> {
    const params = [
      `filter[frequency]=${query.frequency}`,
      `filter[reportType]=${query.reportType}`,
      `filter[reportSubType]=${query.reportSubType}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
      `filter[reportDate]=${query.reportDate}`,
      ...(query.version ? [`filter[version]=${query.version}`] : []),
    ];
    return this.getReportBytes(`/salesReports?${params.join('&')}`);
  }

  /** Download a Finance report as raw gzip bytes (the caller decompresses + parses the TSV). */
  async getFinanceReport(query: FinanceReportQuery): Promise<Buffer> {
    const params = [
      `filter[regionCode]=${query.regionCode}`,
      `filter[reportDate]=${query.reportDate}`,
      `filter[reportType]=${query.reportType ?? 'FINANCE_DETAIL'}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
    ];
    return this.getReportBytes(`/financeReports?${params.join('&')}`);
  }

  /** List an app's analytics report requests of one access type (`ONGOING` / `ONE_TIME_SNAPSHOT`). */
  async listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]> {
    const data = await this.requestAll<{ accessType?: string; stoppedDueToInactivity?: boolean }>(
      `/apps/${appId}/analyticsReportRequests?filter[accessType]=${accessType}&limit=200`,
    );
    return data.map((entry) => toReportRequest(entry, accessType));
  }

  /**
   * Create an analytics report request for an app. Creating a brand-new report type for the first time
   * needs the Admin role — a non-Admin key returns 403, which `launch reports` surfaces actionably.
   */
  async createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource> {
    const data = await this.createResource<{
      accessType?: string;
      stoppedDueToInactivity?: boolean;
    }>('/analyticsReportRequests', {
      type: 'analyticsReportRequests',
      attributes: { accessType },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return toReportRequest(data, accessType);
  }

  /** List the reports available within a request, optionally filtered by category or exact name. */
  async listAnalyticsReports(
    requestId: string,
    filters: { category?: string; name?: string } = {},
  ): Promise<AnalyticsReportResource[]> {
    let path = `/analyticsReportRequests/${requestId}/reports?limit=200`;
    if (filters.category) path += `&filter[category]=${filters.category}`;
    if (filters.name) path += `&filter[name]=${encodeURIComponent(filters.name)}`;
    const data = await this.requestAll<{ name?: string; category?: string }>(path);
    return data.map((entry) => ({
      id: entry.id,
      name: entry.attributes.name ?? '',
      ...(entry.attributes.category ? { category: entry.attributes.category } : {}),
    }));
  }

  /** List a report's time-period instances, optionally filtered by granularity / processing date. */
  async listAnalyticsReportInstances(
    reportId: string,
    filters: { granularity?: string; processingDate?: string } = {},
  ): Promise<AnalyticsReportInstanceResource[]> {
    let path = `/analyticsReports/${reportId}/instances?limit=200`;
    if (filters.granularity) path += `&filter[granularity]=${filters.granularity}`;
    if (filters.processingDate) path += `&filter[processingDate]=${filters.processingDate}`;
    const data = await this.requestAll<{ granularity?: string; processingDate?: string }>(path);
    return data.map((entry) => ({
      id: entry.id,
      granularity: entry.attributes.granularity ?? '',
      ...(entry.attributes.processingDate
        ? { processingDate: entry.attributes.processingDate }
        : {}),
    }));
  }

  /** List the downloadable segments of a report instance (each a presigned URL to a gzipped TSV). */
  async listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]> {
    const data = await this.requestAll<{ url?: string; checksum?: string; sizeInBytes?: number }>(
      `/analyticsReportInstances/${instanceId}/segments?limit=200`,
    );
    return data.flatMap((entry) =>
      entry.attributes.url
        ? [
            {
              id: entry.id,
              url: entry.attributes.url,
              ...(entry.attributes.checksum ? { checksum: entry.attributes.checksum } : {}),
              ...(entry.attributes.sizeInBytes !== undefined
                ? { sizeInBytes: entry.attributes.sizeInBytes }
                : {}),
            },
          ]
        : [],
    );
  }

  /**
   * Download an analytics segment's gzipped body from its presigned URL. The URL carries its own
   * query-string auth, so this is an UNauthenticated fetch — adding the API Bearer would make the
   * storage backend reject the request for presenting two auth mechanisms.
   */
  async downloadAnalyticsSegment(url: string): Promise<Buffer> {
    return withRetry(
      async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new AscRequestError(
            `Analytics segment download failed (${response.status}).`,
            response.status,
          );
        }
        return Buffer.from(await response.arrayBuffer());
      },
      { isRetryable: isRetryableAscError },
    );
  }

  /**
   * GET a gzipped report body (sales/finance) as raw bytes, with transparent retry on Apple's transient
   * failures. Surfaces Apple's JSON error `detail` (e.g. "There were no sales for the date specified")
   * on a 4xx instead of a bare status, so the command can show an actionable message.
   */
  private async getReportBytes(pathOrUrl: string): Promise<Buffer> {
    return withRetry(() => this.getReportBytesOnce(pathOrUrl), {
      isRetryable: isRetryableAscError,
    });
  }

  /** A single (un-retried) gzipped-report fetch — the retry wrapper lives in {@link getReportBytes}. */
  private async getReportBytesOnce(pathOrUrl: string): Promise<Buffer> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        Accept: 'application/a-gzip, application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new AscRequestError(
        `App Store Connect GET ${pathOrUrl} failed (${response.status}): ${describeErrors(text)}`,
        response.status,
        parseErrorCodes(text),
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /* ------------------------------------------------------------------------ */
  /*  App Store release lifecycle — versions, builds, localizations, review     */
  /*  submissions, and phased release. Consumed by core/appStoreRelease.ts.     */
  /* ------------------------------------------------------------------------ */

  /** List an app's most recent builds (one page, newest upload first) for the release build picker. */
  async listBuilds(appId: string, limit = 25): Promise<BuildResource[]> {
    const { data } = await this.request<
      ResourceList<{
        version?: string;
        processingState?: string;
        uploadedDate?: string;
        expired?: boolean;
      }>
    >(
      'GET',
      `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=${limit}&fields[builds]=version,processingState,uploadedDate,expired`,
    );
    return data.map((entry) => toBuildResource(entry));
  }

  /** Find one build by its `CFBundleVersion` number (the resource id is needed to attach / PATCH it), or null. */
  async findBuildByVersion(appId: string, buildNumber: number): Promise<BuildResource | null> {
    const { data } = await this.request<
      ResourceList<{
        version?: string;
        processingState?: string;
        uploadedDate?: string;
        expired?: boolean;
      }>
    >(
      'GET',
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=version,processingState,uploadedDate,expired`,
    );
    const first = data[0];
    return first ? toBuildResource(first) : null;
  }

  /** List a build's TestFlight "What to Test" notes, one per locale (`betaBuildLocalizations`). */
  async listBetaBuildLocalizations(buildId: string): Promise<BetaBuildLocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; whatsNew?: string }>(
      `/builds/${buildId}/betaBuildLocalizations?limit=200&fields[betaBuildLocalizations]=locale,whatsNew`,
    );
    return data.flatMap((entry) =>
      entry.attributes.locale
        ? [
            {
              id: entry.id,
              locale: entry.attributes.locale,
              ...(entry.attributes.whatsNew ? { whatsNew: entry.attributes.whatsNew } : {}),
            },
          ]
        : [],
    );
  }

  /** Create a build's "What to Test" note for one locale. */
  async createBetaBuildLocalization(
    buildId: string,
    locale: string,
    whatsNew: string,
  ): Promise<void> {
    await this.createResource('/betaBuildLocalizations', {
      type: 'betaBuildLocalizations',
      attributes: { locale, whatsNew },
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  }

  /** Update one locale's "What to Test" note. */
  async updateBetaBuildLocalization(localizationId: string, whatsNew: string): Promise<void> {
    await this.updateResource(`/betaBuildLocalizations/${localizationId}`, {
      type: 'betaBuildLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  }

  /** Read a build's Beta App Review submission (its current verdict), or null when it hasn't been submitted. */
  async getBetaAppReviewSubmission(
    buildId: string,
  ): Promise<BetaAppReviewSubmissionResource | null> {
    return this.getOptional(async () => {
      const { data } = await this.request<{
        data: { id: string; attributes?: { betaReviewState?: BetaReviewState } } | null;
      }>('GET', `/builds/${buildId}/betaAppReviewSubmission`);
      return data
        ? {
            id: data.id,
            ...(data.attributes?.betaReviewState ? { state: data.attributes.betaReviewState } : {}),
          }
        : null;
    });
  }

  /** Submit a build for Beta App Review (required before external testers can install it). */
  async createBetaAppReviewSubmission(buildId: string): Promise<void> {
    await this.createResource('/betaAppReviewSubmissions', {
      type: 'betaAppReviewSubmissions',
      relationships: { build: { data: { type: 'builds', id: buildId } } },
    });
  }

  /** List an app's App Store versions for a platform (e.g. `IOS`), across all pages. */
  async listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]> {
    const data = await this.requestAll<{
      versionString?: string;
      appStoreState?: string;
      releaseType?: string;
    }>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=200&fields[appStoreVersions]=versionString,appStoreState,releaseType`,
    );
    return data.map((entry) => toVersionResource(entry));
  }

  /** Create a new App Store version for a marketing version string on a platform. */
  async createAppStoreVersion(
    appId: string,
    input: {
      versionString: string;
      platform: string;
      releaseType?: string;
      earliestReleaseDate?: string;
    },
  ): Promise<AppStoreVersionResource> {
    const attributes: Record<string, string> = {
      platform: input.platform,
      versionString: input.versionString,
    };
    if (input.releaseType) attributes['releaseType'] = input.releaseType;
    if (input.earliestReleaseDate) attributes['earliestReleaseDate'] = input.earliestReleaseDate;
    const data = await this.createResource<{
      versionString?: string;
      appStoreState?: string;
      releaseType?: string;
    }>('/appStoreVersions', {
      type: 'appStoreVersions',
      attributes,
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return toVersionResource({ id: data.id, attributes: data.attributes }, input.versionString);
  }

  /** Update an editable version's release type / scheduled date / version string. */
  async updateAppStoreVersion(
    versionId: string,
    input: { releaseType?: string; earliestReleaseDate?: string; versionString?: string },
  ): Promise<void> {
    const attributes: Record<string, string> = {};
    if (input.releaseType) attributes['releaseType'] = input.releaseType;
    if (input.earliestReleaseDate) attributes['earliestReleaseDate'] = input.earliestReleaseDate;
    if (input.versionString) attributes['versionString'] = input.versionString;
    await this.updateResource(`/appStoreVersions/${versionId}`, {
      type: 'appStoreVersions',
      id: versionId,
      attributes,
    });
  }

  /** Attach a (processed, VALID) build to a version — the `relationships/build` PATCH. */
  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    await this.request<unknown>('PATCH', `/appStoreVersions/${versionId}/relationships/build`, {
      data: { type: 'builds', id: buildId },
    });
  }

  /** List a version's per-locale copy (Launch reads only `whatsNew`). */
  async listAppStoreVersionLocalizations(
    versionId: string,
  ): Promise<AppStoreVersionLocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; whatsNew?: string }>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200&fields[appStoreVersionLocalizations]=locale,whatsNew`,
    );
    return data.flatMap((entry) =>
      entry.attributes.locale
        ? [
            {
              id: entry.id,
              locale: entry.attributes.locale,
              ...(entry.attributes.whatsNew ? { whatsNew: entry.attributes.whatsNew } : {}),
            },
          ]
        : [],
    );
  }

  /** Create one locale's version copy with its release notes. */
  async createAppStoreVersionLocalization(
    versionId: string,
    input: { locale: string; whatsNew: string },
  ): Promise<AppStoreVersionLocalizationResource> {
    const data = await this.createResource<{ locale?: string; whatsNew?: string }>(
      '/appStoreVersionLocalizations',
      {
        type: 'appStoreVersionLocalizations',
        attributes: { locale: input.locale, whatsNew: input.whatsNew },
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
      },
    );
    return {
      id: data.id,
      locale: data.attributes.locale ?? input.locale,
      ...(data.attributes.whatsNew ? { whatsNew: data.attributes.whatsNew } : {}),
    };
  }

  /** Update one locale's release notes (`whatsNew`). */
  async updateAppStoreVersionLocalization(localizationId: string, whatsNew: string): Promise<void> {
    await this.updateResource(`/appStoreVersionLocalizations/${localizationId}`, {
      type: 'appStoreVersionLocalizations',
      id: localizationId,
      attributes: { whatsNew },
    });
  }

  /** A version's phased-release schedule, or null when none has been created yet (a fresh version). */
  async getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null> {
    return this.getOptional(async () => {
      const { data } = await this.request<{
        data: {
          id: string;
          attributes: { phasedReleaseState?: string; currentDayNumber?: number };
        } | null;
      }>('GET', `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`);
      return data ? toPhasedRelease(data) : null;
    });
  }

  /** Create a phased release on a version (starts `ACTIVE`; takes effect once the version goes live). */
  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    const data = await this.createResource<{
      phasedReleaseState?: string;
      currentDayNumber?: number;
    }>('/appStoreVersionPhasedReleases', {
      type: 'appStoreVersionPhasedReleases',
      attributes: { phasedReleaseState: 'ACTIVE' },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
    return toPhasedRelease({ id: data.id, attributes: data.attributes });
  }

  /** Steer a phased release: `PAUSE`, `ACTIVE` (resume), or `COMPLETE` (finish the ramp now). */
  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    await this.updateResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
      type: 'appStoreVersionPhasedReleases',
      id: phasedReleaseId,
      attributes: { phasedReleaseState },
    });
  }

  /** Remove a phased release (opt back into an immediate 100% rollout before go-live). */
  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    await this.deleteResource(`/appStoreVersionPhasedReleases/${phasedReleaseId}`);
  }

  /** List an app's review submissions for a platform (to reuse an addable `READY_FOR_REVIEW` draft). */
  async listReviewSubmissions(
    appId: string,
    platform: string,
  ): Promise<ReviewSubmissionResource[]> {
    const data = await this.requestAll<{ state?: string }>(
      `/apps/${appId}/reviewSubmissions?filter[platform]=${platform}&limit=200&fields[reviewSubmissions]=state`,
    );
    return data.map((entry) => ({ id: entry.id, state: entry.attributes.state ?? '' }));
  }

  /** Open a new review submission container for a platform. */
  async createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource> {
    const data = await this.createResource<{ state?: string }>('/reviewSubmissions', {
      type: 'reviewSubmissions',
      attributes: { platform },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return { id: data.id, state: data.attributes.state ?? '' };
  }

  /** Add a version to a review submission as an item (required before the submission can be submitted). */
  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    await this.createResource('/reviewSubmissionItems', {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
      },
    });
  }

  /** Submit a review submission to Apple (the `submitted: true` PATCH). */
  async submitReviewSubmission(submissionId: string): Promise<void> {
    await this.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { submitted: true },
    });
  }

  /**
   * Fire the developer release for an approved version held at `PENDING_DEVELOPER_RELEASE` — the API form
   * of pressing "Release this version" in App Store Connect. Used by `launch release-train` to release a
   * held (`--hold`) version once its synchronized gate opens; a no-op-on-Apple's-side for a version that
   * isn't pending developer release (Apple rejects it, surfaced as an {@link AscRequestError}).
   */
  async createAppStoreVersionReleaseRequest(versionId: string): Promise<void> {
    await this.createResource('/appStoreVersionReleaseRequests', {
      type: 'appStoreVersionReleaseRequests',
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } } },
    });
  }

  /** Cancel a review submission — the hotfix-loop withdraw that frees the version to be edited again. */
  async cancelReviewSubmission(submissionId: string): Promise<void> {
    await this.updateResource(`/reviewSubmissions/${submissionId}`, {
      type: 'reviewSubmissions',
      id: submissionId,
      attributes: { canceled: true },
    });
  }

  /** Read one review submission's current state (for `launch status`). */
  async getReviewSubmission(submissionId: string): Promise<ReviewSubmissionResource> {
    const { data } = await this.request<ResourceSingle<{ state?: string }>>(
      'GET',
      `/reviewSubmissions/${submissionId}?fields[reviewSubmissions]=state`,
    );
    return { id: data.id, state: data.attributes.state ?? '' };
  }

  // ── In-app events: events & their localizations (`launch events`) ──────────────────────────────────

  /** List an app's in-app events (newest lifecycle first is not guaranteed; Apple returns creation order). */
  async listAppEvents(appId: string): Promise<AppEventResource[]> {
    const data = await this.requestAll<{
      referenceName?: string;
      badge?: string;
      eventState?: string;
      primaryLocale?: string;
      deepLink?: string;
      priority?: string;
      purpose?: string;
    }>(
      `/apps/${appId}/appEvents?limit=200&fields[appEvents]=referenceName,badge,eventState,primaryLocale,deepLink,priority,purpose`,
    );
    return data.map((entry) => ({
      id: entry.id,
      referenceName: entry.attributes.referenceName ?? '',
      ...(entry.attributes.badge ? { badge: entry.attributes.badge } : {}),
      ...(entry.attributes.eventState ? { eventState: entry.attributes.eventState } : {}),
      ...(entry.attributes.primaryLocale ? { primaryLocale: entry.attributes.primaryLocale } : {}),
      ...(entry.attributes.deepLink ? { deepLink: entry.attributes.deepLink } : {}),
      ...(entry.attributes.priority ? { priority: entry.attributes.priority } : {}),
      ...(entry.attributes.purpose ? { purpose: entry.attributes.purpose } : {}),
    }));
  }

  /** List one event's localizations (per-locale name + descriptions). */
  async listAppEventLocalizations(eventId: string): Promise<AppEventLocalizationResource[]> {
    const data = await this.requestAll<{
      locale?: string;
      name?: string;
      shortDescription?: string;
      longDescription?: string;
    }>(
      `/appEvents/${eventId}/appEventLocalizations?limit=200&fields[appEventLocalizations]=locale,name,shortDescription,longDescription`,
    );
    return data.map((entry) => ({
      id: entry.id,
      locale: entry.attributes.locale ?? '',
      ...(entry.attributes.name ? { name: entry.attributes.name } : {}),
      ...(entry.attributes.shortDescription
        ? { shortDescription: entry.attributes.shortDescription }
        : {}),
      ...(entry.attributes.longDescription
        ? { longDescription: entry.attributes.longDescription }
        : {}),
    }));
  }

  /** Create a draft in-app event for an app, returning the created event. */
  async createAppEvent(appId: string, attributes: NewAppEvent): Promise<AppEventResource> {
    const data = await this.createResource<{
      referenceName?: string;
      badge?: string;
      eventState?: string;
      primaryLocale?: string;
      deepLink?: string;
      priority?: string;
      purpose?: string;
    }>('/appEvents', {
      type: 'appEvents',
      attributes: {
        referenceName: attributes.referenceName,
        ...(attributes.badge ? { badge: attributes.badge } : {}),
        ...(attributes.primaryLocale ? { primaryLocale: attributes.primaryLocale } : {}),
        ...(attributes.deepLink ? { deepLink: attributes.deepLink } : {}),
        ...(attributes.priority ? { priority: attributes.priority } : {}),
        ...(attributes.purpose ? { purpose: attributes.purpose } : {}),
      },
      relationships: { app: { data: { type: 'apps', id: appId } } },
    });
    return {
      id: data.id,
      referenceName: data.attributes.referenceName ?? attributes.referenceName,
      ...(data.attributes.badge ? { badge: data.attributes.badge } : {}),
      ...(data.attributes.eventState ? { eventState: data.attributes.eventState } : {}),
      ...(data.attributes.primaryLocale ? { primaryLocale: data.attributes.primaryLocale } : {}),
      ...(data.attributes.deepLink ? { deepLink: data.attributes.deepLink } : {}),
      ...(data.attributes.priority ? { priority: data.attributes.priority } : {}),
      ...(data.attributes.purpose ? { purpose: data.attributes.purpose } : {}),
    };
  }

  /** Delete an in-app event by id (only a DRAFT event can be deleted). */
  async deleteAppEvent(eventId: string): Promise<void> {
    await this.deleteResource(`/appEvents/${eventId}`);
  }

  /** Create a localization (locale + copy) for an event, returning the created localization. */
  async createAppEventLocalization(
    eventId: string,
    locale: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const data = await this.createResource<{
      locale?: string;
      name?: string;
      shortDescription?: string;
      longDescription?: string;
    }>('/appEventLocalizations', {
      type: 'appEventLocalizations',
      attributes: {
        locale,
        ...(attributes.name !== undefined ? { name: attributes.name } : {}),
        ...(attributes.shortDescription !== undefined
          ? { shortDescription: attributes.shortDescription }
          : {}),
        ...(attributes.longDescription !== undefined
          ? { longDescription: attributes.longDescription }
          : {}),
      },
      relationships: { appEvent: { data: { type: 'appEvents', id: eventId } } },
    });
    return toAppEventLocalization(data, locale);
  }

  /** Update an existing event localization's copy by its id, returning the updated localization. */
  async updateAppEventLocalization(
    localizationId: string,
    attributes: AppEventLocalizationInput,
  ): Promise<AppEventLocalizationResource> {
    const { data } = await this.request<
      ResourceSingle<{
        locale?: string;
        name?: string;
        shortDescription?: string;
        longDescription?: string;
      }>
    >('PATCH', `/appEventLocalizations/${localizationId}`, {
      data: {
        type: 'appEventLocalizations',
        id: localizationId,
        attributes: {
          ...(attributes.name !== undefined ? { name: attributes.name } : {}),
          ...(attributes.shortDescription !== undefined
            ? { shortDescription: attributes.shortDescription }
            : {}),
          ...(attributes.longDescription !== undefined
            ? { longDescription: attributes.longDescription }
            : {}),
        },
      },
    });
    return toAppEventLocalization(data, '');
  }

  // ── App Store assets: screenshots & subscription review screenshots (`launch sync`) ────────────────

  /** List the screenshot sets (one per device display type) bound to one App Store version localization. */
  async listScreenshotSets(versionLocalizationId: string): Promise<ScreenshotSetResource[]> {
    const data = await this.requestAll<{ screenshotDisplayType?: string }>(
      `/appStoreVersionLocalizations/${versionLocalizationId}/appScreenshotSets?fields[appScreenshotSets]=screenshotDisplayType&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      screenshotDisplayType: entry.attributes.screenshotDisplayType ?? '',
    }));
  }

  /** Create a screenshot set for one display type under a version localization, returning the new set. */
  async createScreenshotSet(
    versionLocalizationId: string,
    displayType: string,
  ): Promise<ScreenshotSetResource> {
    const data = await this.createResource<{ screenshotDisplayType?: string }>(
      '/appScreenshotSets',
      {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: displayType },
        relationships: {
          appStoreVersionLocalization: {
            data: { type: 'appStoreVersionLocalizations', id: versionLocalizationId },
          },
        },
      },
    );
    return {
      id: data.id,
      screenshotDisplayType: data.attributes.screenshotDisplayType ?? displayType,
    };
  }

  /** List the screenshots already in a set, with their stored checksums (the reconciler's skip key). */
  async listScreenshots(setId: string): Promise<ScreenshotResource[]> {
    const data = await this.requestAll<{
      fileName?: string;
      sourceFileChecksum?: string;
      assetDeliveryState?: { state?: string };
    }>(
      `/appScreenshotSets/${setId}/appScreenshots?fields[appScreenshots]=fileName,sourceFileChecksum,assetDeliveryState&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      fileName: entry.attributes.fileName ?? '',
      ...(entry.attributes.sourceFileChecksum
        ? { sourceFileChecksum: entry.attributes.sourceFileChecksum }
        : {}),
      ...(entry.attributes.assetDeliveryState?.state
        ? { assetDeliveryState: entry.attributes.assetDeliveryState.state }
        : {}),
    }));
  }

  /** Upload one screenshot into a set via the full reserve→PUT→commit asset flow. */
  async uploadScreenshot(setId: string, fileName: string, filePath: string): Promise<void> {
    const bytes = await readFile(filePath);
    const { id, operations } = await this.reserveAsset(
      'appScreenshots',
      { relationship: 'appScreenshotSet', type: 'appScreenshotSets', id: setId },
      fileName,
      bytes.byteLength,
    );
    await this.putAssetBytes(operations, bytes);
    await this.commitAsset('appScreenshots', id, bytes);
  }

  /** The subscription's current App Review screenshot, or null when it has none. */
  async getSubscriptionReviewScreenshot(
    subscriptionId: string,
  ): Promise<ReviewScreenshotResource | null> {
    const { data } = await this.request<{
      data: {
        id: string;
        attributes: { sourceFileChecksum?: string; assetDeliveryState?: { state?: string } };
      } | null;
    }>(
      'GET',
      `/subscriptions/${subscriptionId}/appStoreReviewScreenshot?fields[subscriptionAppStoreReviewScreenshots]=sourceFileChecksum,assetDeliveryState`,
    );
    if (!data) return null;
    return {
      id: data.id,
      ...(data.attributes.sourceFileChecksum
        ? { sourceFileChecksum: data.attributes.sourceFileChecksum }
        : {}),
      ...(data.attributes.assetDeliveryState?.state
        ? { assetDeliveryState: data.attributes.assetDeliveryState.state }
        : {}),
    };
  }

  /** Upload a subscription's App Review screenshot via the reserve→PUT→commit flow. */
  async uploadSubscriptionReviewScreenshot(
    subscriptionId: string,
    fileName: string,
    filePath: string,
  ): Promise<void> {
    const bytes = await readFile(filePath);
    const { id, operations } = await this.reserveAsset(
      'subscriptionAppStoreReviewScreenshots',
      { relationship: 'subscription', type: 'subscriptions', id: subscriptionId },
      fileName,
      bytes.byteLength,
    );
    await this.putAssetBytes(operations, bytes);
    await this.commitAsset('subscriptionAppStoreReviewScreenshots', id, bytes);
  }

  // ── App Store assets: app preview videos (`launch sync`) ───────────────────────────────────────────

  /** List the app-preview-video sets (one per device target) bound to one App Store version localization. */
  async listPreviewSets(versionLocalizationId: string): Promise<PreviewSetResource[]> {
    const data = await this.requestAll<{ previewType?: string }>(
      `/appStoreVersionLocalizations/${versionLocalizationId}/appPreviewSets?fields[appPreviewSets]=previewType&limit=200`,
    );
    return data.map((entry) => ({ id: entry.id, previewType: entry.attributes.previewType ?? '' }));
  }

  /** Create an app-preview-video set for one device target under a version localization, returning the new set. */
  async createPreviewSet(
    versionLocalizationId: string,
    previewType: string,
  ): Promise<PreviewSetResource> {
    const data = await this.createResource<{ previewType?: string }>('/appPreviewSets', {
      type: 'appPreviewSets',
      attributes: { previewType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: versionLocalizationId },
        },
      },
    });
    return { id: data.id, previewType: data.attributes.previewType ?? previewType };
  }

  /** List the previews already in a set, with their stored checksums (the reconciler's skip key). */
  async listPreviews(setId: string): Promise<PreviewResource[]> {
    const data = await this.requestAll<{
      fileName?: string;
      sourceFileChecksum?: string;
      assetDeliveryState?: { state?: string };
    }>(
      `/appPreviewSets/${setId}/appPreviews?fields[appPreviews]=fileName,sourceFileChecksum,assetDeliveryState&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      fileName: entry.attributes.fileName ?? '',
      ...(entry.attributes.sourceFileChecksum
        ? { sourceFileChecksum: entry.attributes.sourceFileChecksum }
        : {}),
      ...(entry.attributes.assetDeliveryState?.state
        ? { assetDeliveryState: entry.attributes.assetDeliveryState.state }
        : {}),
    }));
  }

  /**
   * Upload one app preview video into a set via the full reserve→PUT→commit asset flow (identical to
   * {@link uploadScreenshot}; only the resource type differs). The poster frame (`previewFrameTimeCode`) is
   * left to Apple's default selection — the folder convention carries no frame time, and forcing one would
   * invent config nobody asked for; an explicit poster is a deliberate follow-up if ever needed.
   */
  async uploadPreview(setId: string, fileName: string, filePath: string): Promise<void> {
    const bytes = await readFile(filePath);
    const { id, operations } = await this.reserveAsset(
      'appPreviews',
      { relationship: 'appPreviewSet', type: 'appPreviewSets', id: setId },
      fileName,
      bytes.byteLength,
    );
    await this.putAssetBytes(operations, bytes);
    await this.commitAsset('appPreviews', id, bytes);
  }

  /**
   * List the team's authorized alternative-distribution domains (EU DMA web distribution). Team-level —
   * no app scope — so the reconciler matches declared domains to these by `domain`.
   */
  async listAlternativeDistributionDomains(): Promise<AlternativeDistributionDomainResource[]> {
    const data = await this.requestAll<{ domain?: string; referenceName?: string }>(
      '/alternativeDistributionDomains?limit=200',
    );
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.domain ? { domain: entry.attributes.domain } : {}),
      ...(entry.attributes.referenceName ? { referenceName: entry.attributes.referenceName } : {}),
    }));
  }

  /** Authorize a new alternative-distribution domain for the team. */
  async createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void> {
    const body: components['schemas']['AlternativeDistributionDomainCreateRequest'] = {
      data: { type: 'alternativeDistributionDomains', attributes: { domain, referenceName } },
    };
    await this.request<unknown>('POST', '/alternativeDistributionDomains', body);
  }

  /** List the team's registered alternative-distribution public keys (usually zero or one). */
  async listAlternativeDistributionKeys(): Promise<AlternativeDistributionKeyResource[]> {
    const data = await this.requestAll<{ publicKey?: string }>(
      '/alternativeDistributionKeys?limit=200',
    );
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.publicKey ? { publicKey: entry.attributes.publicKey } : {}),
    }));
  }

  /** Register the team's alternative-distribution package-signing public key (the PEM `publicKey`). */
  async createAlternativeDistributionKey(publicKey: string): Promise<{ id: string }> {
    const body: components['schemas']['AlternativeDistributionKeyCreateRequest'] = {
      data: { type: 'alternativeDistributionKeys', attributes: { publicKey } },
    };
    const { data } = await this.request<ResourceSingle<{ publicKey?: string }>>(
      'POST',
      '/alternativeDistributionKeys',
      body,
    );
    return { id: data.id };
  }

  /** List the team's registered Apple Pay merchant ids (matched to config on `identifier`). */
  async listMerchantIds(): Promise<MerchantIdResource[]> {
    const data = await this.requestAll<{ identifier?: string; name?: string }>(
      '/merchantIds?limit=200',
    );
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.identifier ? { identifier: entry.attributes.identifier } : {}),
      ...(entry.attributes.name ? { name: entry.attributes.name } : {}),
    }));
  }

  /** Register an Apple Pay merchant id (`merchant.…`) on the team. */
  async createMerchantId(identifier: string, name: string): Promise<void> {
    const body: components['schemas']['MerchantIdCreateRequest'] = {
      data: { type: 'merchantIds', attributes: { name, identifier } },
    };
    await this.request<unknown>('POST', '/merchantIds', body);
  }

  /** List the team's registered Wallet pass type ids (matched to config on `identifier`). */
  async listPassTypeIds(): Promise<PassTypeIdResource[]> {
    const data = await this.requestAll<{ identifier?: string; name?: string }>(
      '/passTypeIds?limit=200',
    );
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.identifier ? { identifier: entry.attributes.identifier } : {}),
      ...(entry.attributes.name ? { name: entry.attributes.name } : {}),
    }));
  }

  /** Register a Wallet pass type id (`pass.…`) on the team. */
  async createPassTypeId(identifier: string, name: string): Promise<void> {
    const body: components['schemas']['PassTypeIdCreateRequest'] = {
      data: { type: 'passTypeIds', attributes: { name, identifier } },
    };
    await this.request<unknown>('POST', '/passTypeIds', body);
  }

  // ── Game Center: detail container + achievements / leaderboards (`launch game-center`) ───────────────

  /** Read an app's Game Center detail (the container enabling Game Center), or null when not yet enabled. */
  async getGameCenterDetail(appId: string): Promise<GameCenterDetailResource | null> {
    return this.getOptional(async () => {
      const { data } = await this.request<{ data: { id: string } | null }>(
        'GET',
        `/apps/${appId}/gameCenterDetail`,
      );
      return data ? { id: data.id } : null;
    });
  }

  /** Enable Game Center for an app by creating its detail container, returning the new detail. */
  async createGameCenterDetail(appId: string): Promise<GameCenterDetailResource> {
    const body: components['schemas']['GameCenterDetailCreateRequest'] = {
      data: {
        type: 'gameCenterDetails',
        relationships: { app: { data: { type: 'apps', id: appId } } },
      },
    };
    const { data } = await this.request<ResourceSingle<Record<string, never>>>(
      'POST',
      '/gameCenterDetails',
      body,
    );
    return { id: data.id };
  }

  /** List a detail's achievements (just their `vendorIdentifier`s — the reconciler's idempotency key). */
  async listGameCenterAchievements(detailId: string): Promise<GameCenterAchievementResource[]> {
    const data = await this.requestAll<{ vendorIdentifier?: string }>(
      `/gameCenterDetails/${detailId}/gameCenterAchievements?fields[gameCenterAchievements]=vendorIdentifier&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.vendorIdentifier
        ? { vendorIdentifier: entry.attributes.vendorIdentifier }
        : {}),
    }));
  }

  /**
   * Create a Game Center achievement (V2) under a detail. The V2 model couples an achievement to an
   * initial version, so the create supplies an inline `gameCenterAchievementVersions` with a temp id
   * (the same temp-id + `included` pattern as {@link createSubscriptionOfferCode}); Apple returns the real
   * version id in `data.relationships.versions`, which {@link createGameCenterAchievementLocalization}
   * needs since localizations attach to the version, not the achievement.
   */
  async createGameCenterAchievement(
    detailId: string,
    attributes: GameCenterAchievementCreate,
  ): Promise<{ id: string; versionId: string | null }> {
    const body: components['schemas']['GameCenterAchievementV2CreateRequest'] = {
      data: {
        type: 'gameCenterAchievements',
        attributes,
        relationships: {
          gameCenterDetail: { data: { type: 'gameCenterDetails', id: detailId } },
          versions: { data: [{ type: 'gameCenterAchievementVersions', id: 'version-0' }] },
        },
      },
      included: [{ type: 'gameCenterAchievementVersions', id: 'version-0' }],
    };
    const { data } = await this.request<{
      data: { id: string; relationships?: { versions?: { data?: { id: string }[] } } };
    }>('POST', this.v2('/gameCenterAchievements'), body);
    return { id: data.id, versionId: data.relationships?.versions?.data?.[0]?.id ?? null };
  }

  /** Create the default-locale localization for an achievement version (name + before/after descriptions). */
  async createGameCenterAchievementLocalization(
    versionId: string,
    fields: {
      locale: string;
      name: string;
      beforeEarnedDescription: string;
      afterEarnedDescription: string;
    },
  ): Promise<void> {
    const body: components['schemas']['GameCenterAchievementLocalizationV2CreateRequest'] = {
      data: {
        type: 'gameCenterAchievementLocalizations',
        attributes: fields,
        relationships: {
          version: { data: { type: 'gameCenterAchievementVersions', id: versionId } },
        },
      },
    };
    await this.request<unknown>('POST', this.v2('/gameCenterAchievementLocalizations'), body);
  }

  /** List a detail's leaderboards (just their `vendorIdentifier`s — the reconciler's idempotency key). */
  async listGameCenterLeaderboards(detailId: string): Promise<GameCenterLeaderboardResource[]> {
    const data = await this.requestAll<{ vendorIdentifier?: string }>(
      `/gameCenterDetails/${detailId}/gameCenterLeaderboards?fields[gameCenterLeaderboards]=vendorIdentifier&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      ...(entry.attributes.vendorIdentifier
        ? { vendorIdentifier: entry.attributes.vendorIdentifier }
        : {}),
    }));
  }

  /** Create a Game Center leaderboard (V2) under a detail — same inline-version pattern as the achievement create. */
  async createGameCenterLeaderboard(
    detailId: string,
    attributes: GameCenterLeaderboardCreate,
  ): Promise<{ id: string; versionId: string | null }> {
    const body: components['schemas']['GameCenterLeaderboardV2CreateRequest'] = {
      data: {
        type: 'gameCenterLeaderboards',
        attributes,
        relationships: {
          gameCenterDetail: { data: { type: 'gameCenterDetails', id: detailId } },
          versions: { data: [{ type: 'gameCenterLeaderboardVersions', id: 'version-0' }] },
        },
      },
      included: [{ type: 'gameCenterLeaderboardVersions', id: 'version-0' }],
    };
    const { data } = await this.request<{
      data: { id: string; relationships?: { versions?: { data?: { id: string }[] } } };
    }>('POST', this.v2('/gameCenterLeaderboards'), body);
    return { id: data.id, versionId: data.relationships?.versions?.data?.[0]?.id ?? null };
  }

  /** Create the default-locale localization for a leaderboard version (name, optional formatter override). */
  async createGameCenterLeaderboardLocalization(
    versionId: string,
    fields: { locale: string; name: string; formatterOverride?: LeaderboardFormatter },
  ): Promise<void> {
    const body: components['schemas']['GameCenterLeaderboardLocalizationV2CreateRequest'] = {
      data: {
        type: 'gameCenterLeaderboardLocalizations',
        attributes: fields,
        relationships: {
          version: { data: { type: 'gameCenterLeaderboardVersions', id: versionId } },
        },
      },
    };
    await this.request<unknown>('POST', this.v2('/gameCenterLeaderboardLocalizations'), body);
  }

  /** Reserve an asset: POST the resource with `fileName`/`fileSize`, returning its id + upload operations. */
  private async reserveAsset(
    type: string,
    parent: { relationship: string; type: string; id: string },
    fileName: string,
    fileSize: number,
  ): Promise<{ id: string; operations: UploadOperation[] }> {
    const reservation = await this.request<AssetReservation>('POST', `/${type}`, {
      data: {
        type,
        attributes: { fileName, fileSize },
        relationships: { [parent.relationship]: { data: { type: parent.type, id: parent.id } } },
      },
    });
    return {
      id: reservation.data.id,
      operations: reservation.data.attributes.uploadOperations ?? [],
    };
  }

  /** PUT a reserved asset's bytes to Apple's CDN, one operation (chunk) at a time, with transient-retry. */
  private async putAssetBytes(operations: UploadOperation[], bytes: Buffer): Promise<void> {
    for (const operation of operations) {
      const offset = operation.offset ?? 0;
      const chunk = bytes.subarray(offset, offset + (operation.length ?? bytes.byteLength));
      const headers: Record<string, string> = {};
      for (const header of operation.requestHeaders ?? []) {
        if (header.name && header.value !== undefined) headers[header.name] = header.value;
      }
      await withRetry(
        async () => {
          const response = await fetch(operation.url, {
            method: operation.method ?? 'PUT',
            headers,
            body: chunk,
          });
          if (!response.ok) {
            throw new AscRequestError(
              `asset upload chunk failed (${response.status})`,
              response.status,
            );
          }
        },
        { isRetryable: isRetryableAscError },
      );
    }
  }

  /** Commit a reserved asset once its bytes are uploaded: PATCH `uploaded:true` + the MD5 Apple verifies. */
  private async commitAsset(type: string, id: string, bytes: Buffer): Promise<void> {
    await this.request<unknown>('PATCH', `/${type}/${id}`, {
      data: { type, id, attributes: { uploaded: true, sourceFileChecksum: md5Hex(bytes) } },
    });
  }
}

/** Map a raw build row onto a {@link BuildResource}, defaulting the optional/absent attributes. */
function toBuildResource(entry: {
  id: string;
  attributes: {
    version?: string;
    processingState?: string;
    uploadedDate?: string;
    expired?: boolean;
  };
}): BuildResource {
  return {
    id: entry.id,
    version: entry.attributes.version ?? '',
    processingState: entry.attributes.processingState ?? '',
    ...(entry.attributes.uploadedDate ? { uploadedDate: entry.attributes.uploadedDate } : {}),
    expired: entry.attributes.expired ?? false,
  };
}

/** Map a raw version row onto an {@link AppStoreVersionResource}, keeping a known versionString fallback. */
function toVersionResource(
  entry: {
    id: string;
    attributes: { versionString?: string; appStoreState?: string; releaseType?: string };
  },
  fallbackVersion = '',
): AppStoreVersionResource {
  return {
    id: entry.id,
    versionString: entry.attributes.versionString ?? fallbackVersion,
    appStoreState: entry.attributes.appStoreState ?? '',
    ...(entry.attributes.releaseType ? { releaseType: entry.attributes.releaseType } : {}),
  };
}

/** Map a raw phased-release row onto a {@link PhasedReleaseResource}. */
function toPhasedRelease(entry: {
  id: string;
  attributes: { phasedReleaseState?: string; currentDayNumber?: number };
}): PhasedReleaseResource {
  return {
    id: entry.id,
    phasedReleaseState: entry.attributes.phasedReleaseState ?? '',
    ...(entry.attributes.currentDayNumber !== undefined
      ? { currentDayNumber: entry.attributes.currentDayNumber }
      : {}),
  };
}

/**
 * Find the price point whose `customerPrice` equals the desired amount in a territory. Apple returns
 * prices as decimal strings (`"9.99"`); we parse and compare numerically so `"9.99"` matches `9.99`.
 * Returns null when no rung matches — the reconciler turns that into an actionable "no price point for
 * $X" error rather than silently leaving the product unpriced.
 */
function matchPricePoint(
  points: { id: string; attributes: { customerPrice?: string; territory?: string } }[],
  territory: string,
  customerPrice: number,
): PricePointResource | null {
  for (const point of points) {
    const price = point.attributes.customerPrice;
    if (price !== undefined && Number.parseFloat(price) === customerPrice) {
      return {
        id: point.id,
        customerPrice: price,
        territory: point.attributes.territory ?? territory,
      };
    }
  }
  return null;
}

/**
 * Project a beta-screenshot-submission's raw `screenshots` attribute into the public shape, keeping only
 * entries with a usable URL (Apple occasionally returns expired/empty placeholders) and dropping absent
 * dimensions so a diff/JSON view stays clean.
 */
function toFeedbackScreenshots(
  raw: { url?: string; width?: number; height?: number }[] | undefined,
): { url: string; width?: number; height?: number }[] {
  if (!raw) return [];
  return raw.flatMap((shot) =>
    shot.url
      ? [
          {
            url: shot.url,
            ...(shot.width !== undefined ? { width: shot.width } : {}),
            ...(shot.height !== undefined ? { height: shot.height } : {}),
          },
        ]
      : [],
  );
}

/** Project an ASC `customerReviewResponses` resource object into a {@link CustomerReviewResponseResource}. */
function toReviewResponse(data: {
  id: string;
  attributes: { responseBody?: string; state?: string; lastModifiedDate?: string };
}): CustomerReviewResponseResource {
  return {
    id: data.id,
    responseBody: data.attributes.responseBody ?? '',
    ...(data.attributes.state ? { state: data.attributes.state } : {}),
    ...(data.attributes.lastModifiedDate
      ? { lastModifiedDate: data.attributes.lastModifiedDate }
      : {}),
  };
}

/**
 * Project an ASC `appEventLocalizations` resource object into an {@link AppEventLocalizationResource}.
 * `fallbackLocale` supplies the locale on a PATCH response (Apple's update payload omits the unchanged
 * `locale`); it's the empty string when the caller doesn't need it (the create path passes the locale).
 */
function toAppEventLocalization(
  data: {
    id: string;
    attributes: {
      locale?: string;
      name?: string;
      shortDescription?: string;
      longDescription?: string;
    };
  },
  fallbackLocale: string,
): AppEventLocalizationResource {
  return {
    id: data.id,
    locale: data.attributes.locale ?? fallbackLocale,
    ...(data.attributes.name ? { name: data.attributes.name } : {}),
    ...(data.attributes.shortDescription
      ? { shortDescription: data.attributes.shortDescription }
      : {}),
    ...(data.attributes.longDescription
      ? { longDescription: data.attributes.longDescription }
      : {}),
  };
}

/** Project an ASC `analyticsReportRequests` resource object into an {@link AnalyticsReportRequestResource}. */
function toReportRequest(
  entry: { id: string; attributes: { accessType?: string; stoppedDueToInactivity?: boolean } },
  fallbackAccessType: string,
): AnalyticsReportRequestResource {
  return {
    id: entry.id,
    accessType: entry.attributes.accessType ?? fallbackAccessType,
    ...(entry.attributes.stoppedDueToInactivity !== undefined
      ? { stoppedDueToInactivity: entry.attributes.stoppedDueToInactivity }
      : {}),
  };
}

/**
 * Turn a bare 401 into an actionable hint when this machine's clock is the likely culprit.
 *
 * App Store Connect tokens are ES256 JWTs whose `iat`/`exp` come from the local clock, and Apple
 * rejects any token whose lifetime it reads as expired or beyond its 20-minute ceiling — so a Mac
 * with a skewed clock signs tokens Apple refuses, surfacing only Apple's generic "make sure it has
 * not expired" with no pointer at the real fix. When the failed response carries Apple's authoritative
 * `Date` header and it disagrees with this machine by more than {@link CLOCK_SKEW_TOLERANCE_SECONDS},
 * this returns a sentence naming the drift and the resync command; otherwise it returns "".
 *
 * macOS-only by design: the `sudo sntp` remedy is Apple-specific and the normal App Store Connect flow
 * runs on a Mac, so on other platforms we stay silent rather than print a command that won't apply.
 * `appleDate` is the raw `Date` response header (null when absent); `nowMs` and `platform` are injected
 * so the check is a pure function — unit-testable without a real clock or host OS.
 */
export function clockSkewHint(args: {
  appleDate: string | null;
  nowMs: number;
  platform: NodeJS.Platform;
}): string {
  if (args.platform !== 'darwin' || args.appleDate === null) return '';
  const appleMs = Date.parse(args.appleDate);
  if (Number.isNaN(appleMs)) return '';
  const skewSeconds = Math.abs(args.nowMs - appleMs) / 1000;
  if (skewSeconds < CLOCK_SKEW_TOLERANCE_SECONDS) return '';
  const drift =
    skewSeconds < 120
      ? `~${Math.round(skewSeconds)} seconds`
      : `~${Math.round(skewSeconds / 60)} minutes`;
  return ` Your Mac's clock is off by ${drift} from Apple's, which makes the signed token read as expired — run \`sudo sntp -sS time.apple.com\` to resync, then retry.`;
}

/** Extract Apple's human-readable error detail from a failed-response body, falling back to raw text. */
export function describeErrors(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: AscError[] };
    if (parsed.errors?.length) {
      return parsed.errors.map((e) => e.detail ?? e.title).join('; ');
    }
  } catch {
    /* not JSON — fall through */
  }
  return body.length > 0 ? body : 'no response body';
}

/** Extract Apple's machine-readable error codes from a failed-response body (empty when absent/not JSON). */
export function parseErrorCodes(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as { errors?: AscError[] };
    return parsed.errors?.map((e) => e.code).filter(Boolean) ?? [];
  } catch {
    return [];
  }
}
