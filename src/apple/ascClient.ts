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

import { SignJWT, importPKCS8 } from "jose";
import type { AscKey, OfferCustomerEligibility, OfferDuration, OfferEligibility, OfferMode } from "../core/types.js";
import type { components } from "../core/asc/schema.js";
import { highestVersion } from "../core/version.js";
import { withRetry } from "../core/asyncPool.js";

/** Scheme + host of the App Store Connect API; most resources hang off `/v1`, a few newer ones off `/v2`. */
const API_ORIGIN = "https://api.appstoreconnect.apple.com";
const BASE_URL = `${API_ORIGIN}/v1`;
const AUDIENCE = "appstoreconnect-v1";
/** Apple rejects tokens whose lifetime exceeds 20 minutes; stay safely under it. */
const TOKEN_TTL_SECONDS = 19 * 60;

/**
 * Certificate type to create/reuse. `DISTRIBUTION` is Apple's modern unified "Apple Distribution"
 * identity, valid for App Store submission; its codesign identity is named `Apple Distribution`.
 */
export const DISTRIBUTION_CERT_TYPE = "DISTRIBUTION";
/** Codesign identity name that pairs with {@link DISTRIBUTION_CERT_TYPE}. */
export const DISTRIBUTION_CERT_NAME = "Apple Distribution";
/** Provisioning profile type for App Store / TestFlight distribution. */
export const APP_STORE_PROFILE_TYPE = "IOS_APP_STORE";
/** Provisioning profile type for ad-hoc (install-link) distribution to a fixed set of registered devices. */
export const AD_HOC_PROFILE_TYPE = "IOS_APP_ADHOC";
/** Platform value Apple expects when registering a device for ad-hoc distribution. */
const IOS_DEVICE_PLATFORM = "IOS";

/**
 * App Store version states in which listing metadata is still editable, so `launch sync` may write
 * localizations into that version. A live `READY_FOR_SALE` (or in-review) version is intentionally left
 * alone. See {@link AppStoreConnectClient.getEditableVersionId}.
 */
const EDITABLE_VERSION_STATES = new Set<string>([
  "PREPARE_FOR_SUBMISSION",
  "METADATA_REJECTED",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "INVALID_BINARY",
]);
/** App-info states in which the app-level listing (name/subtitle/privacy URL) is still editable. */
const EDITABLE_APPINFO_STATES = new Set<string>(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED"]);
/** ASC `appInfoLocalizations` attribute keys Launch manages (app-level — persists across versions). */
const APP_INFO_LISTING_FIELDS = ["name", "subtitle", "privacyPolicyUrl"] as const;
/** ASC `appStoreVersionLocalizations` attribute keys Launch manages (version-level — per release). */
const VERSION_LISTING_FIELDS = [
  "description",
  "keywords",
  "whatsNew",
  "promotionalText",
  "supportUrl",
  "marketingUrl",
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
 * Apple's human-readable `detail`. Extends Error, so existing `rejects.toThrow(/…/)` assertions hold.
 */
export class AscRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AscRequestError";
  }
}

/** Whether an error is a transient App Store Connect failure worth retrying (HTTP 429 or any 5xx). */
export function isRetryableAscError(error: unknown): boolean {
  return error instanceof AscRequestError && (error.status === 429 || error.status >= 500);
}

/** A registered Bundle ID resource (an App ID in the Developer portal). */
export interface BundleIdResource {
  id: string;
  identifier: string;
  /** The team's seed/prefix id (e.g. `5NS9ZUMYCS`), which doubles as the Team ID. May be absent. */
  seedId?: string | undefined;
}

/** A signing certificate resource, with the bytes needed to package a `.p12`. */
export interface CertificateResource {
  id: string;
  serialNumber: string;
  /** Base64-encoded DER of the certificate (the `.cer` content). */
  certificateContent: string;
  /** ISO-8601 expiry; used to skip an expired cert when reusing. May be absent. */
  expirationDate?: string | undefined;
}

/** A device registered in the Developer portal, eligible to receive ad-hoc builds. */
export interface DeviceResource {
  id: string;
  /** The device's 40-char (or 25-char, newer) UDID. */
  udid: string;
  /** Human label shown in the portal, e.g. `Dana's iPhone`. */
  name: string;
  /** Apple's status, e.g. `ENABLED` / `DISABLED`. Disabled devices don't count toward an ad-hoc profile. */
  status?: string | undefined;
}

/** A provisioning profile resource, with the bytes needed to install it locally. */
export interface ProfileResource {
  id: string;
  name: string;
  uuid: string;
  /** Base64-encoded `.mobileprovision` contents. */
  profileContent: string;
}

/** A capability enabled on a bundle id (App ID), e.g. `PUSH_NOTIFICATIONS`. */
export interface BundleIdCapabilityResource {
  id: string;
  capabilityType: string;
}

/** An in-app purchase (the `inAppPurchasesV2` resource) on an app. */
export interface InAppPurchaseResource {
  id: string;
  /** Apple product id, the catalog's natural key. */
  productId: string;
  /** Internal reference name. */
  name: string;
  /** `CONSUMABLE` / `NON_CONSUMABLE` / `NON_RENEWING_SUBSCRIPTION`. */
  inAppPurchaseType: string;
  /** Apple's lifecycle state, e.g. `MISSING_METADATA` / `READY_TO_SUBMIT`. Absent unless requested. */
  state?: string;
}

/** A subscription group — the container for mutually-exclusive subscription levels. */
export interface SubscriptionGroupResource {
  id: string;
  referenceName: string;
}

/** One auto-renewable subscription within a group. */
export interface SubscriptionResource {
  id: string;
  productId: string;
  name: string;
  /** Apple's lifecycle state, e.g. `MISSING_METADATA`. Absent unless requested. */
  state?: string;
}

/**
 * One locale's stored copy for a product, group, or subscription. The same shape serves in-app-purchase,
 * subscription, and subscription-group localizations — Apple keys them all on `locale`, with `name`
 * always present and `description` only on the product/subscription variants.
 */
export interface LocalizationResource {
  id: string;
  locale: string;
  name: string;
  description?: string;
}

/**
 * A price point — one rung of Apple's fixed price ladder for a product in a territory. `customerPrice`
 * is the amount the buyer pays (e.g. `"9.99"`); a price is set by linking the product to one of these.
 */
export interface PricePointResource {
  id: string;
  customerPrice: string;
  territory: string;
}

/**
 * An existing App Encryption Declaration on an app — the reusable, one-time export-compliance answer
 * for builds that use non-exempt encryption. Only an `APPROVED` declaration clears a build without a
 * fresh, document-backed submission, so `state` is what gates reuse. See
 * {@link AppStoreConnectClient.listEncryptionDeclarations}.
 */
export interface EncryptionDeclarationResource {
  id: string;
  /** Apple's review state: `CREATED` | `IN_REVIEW` | `APPROVED` | `REJECTED` | `INVALID` | `EXPIRED`. */
  state: string;
}

/**
 * One locale's stored App Store listing copy, normalized to the present (non-empty) fields only. The
 * same shape serves both the app-level `appInfoLocalizations` (name/subtitle/privacy URL — persists
 * across versions) and the version-level `appStoreVersionLocalizations` (description/keywords/whatsNew/…
 * — per release); the caller picks which level. `fields` is keyed by Apple's attribute name, so a diff
 * against desired config is a plain key-by-key comparison.
 */
export interface ListingLocalization {
  id: string;
  locale: string;
  fields: Record<string, string>;
}

/**
 * A TestFlight beta group — a named tester bucket that belongs to exactly one app. External groups
 * invite testers by email (and can gate distribution on Beta App Review); the internal group holds
 * App Store Connect team users. A tester reaches an app's TestFlight by being in one of its groups,
 * which is why every `launch testflight` tester operation goes through a group.
 */
export interface BetaGroupResource {
  id: string;
  name: string;
  /** True for the team-user internal group; external groups are the ones you invite by email. Absent unless requested. */
  isInternal?: boolean;
  /** Public TestFlight invite link, when the group has one enabled. Absent otherwise. */
  publicLink?: string;
}

/**
 * A TestFlight tester. Apple keys testers on `email` and scopes them to the team — the same person is
 * one tester resource reused across apps/groups — so adding an existing email to a new group links
 * rather than duplicates. `firstName`/`lastName` are optional and shown in the invite.
 */
export interface BetaTesterResource {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  /** Apple's invite state, e.g. `INVITED` / `ACCEPTED` / `INSTALLED`. Absent unless requested. */
  state?: string;
}

/**
 * One customer review of an app. `answered` is derived from the `response` relationship so a caller
 * can filter unanswered reviews without a follow-up request per review. Optional text fields are absent
 * (not empty) when Apple omits them — a review can have a rating but no title or body.
 */
export interface CustomerReviewResource {
  id: string;
  /** Star rating, 1–5. */
  rating: number;
  title?: string | undefined;
  body?: string | undefined;
  /** The reviewer's display name, e.g. `appfan99`. */
  reviewerNickname?: string | undefined;
  /** Two/three-letter territory the review was left in (e.g. `USA`). */
  territory?: string | undefined;
  /** ISO-8601 timestamp Apple recorded the review. */
  createdDate?: string | undefined;
  /** True when a developer response is already attached (published or pending moderation). */
  answered: boolean;
}

/** A developer's response to a customer review — the editable, moderated reply shown under the review. */
export interface CustomerReviewResponseResource {
  id: string;
  responseBody: string;
  /** Apple's moderation state, e.g. `PUBLISHED` / `PENDING_PUBLISH`. Absent unless Apple returns it. */
  state?: string | undefined;
  lastModifiedDate?: string | undefined;
}

/**
 * An analytics report request — the subscription that makes reports available for an app. `ONGOING`
 * keeps producing daily/weekly/monthly instances; `ONE_TIME_SNAPSHOT` is a single historical pull.
 */
export interface AnalyticsReportRequestResource {
  id: string;
  /** `ONGOING` | `ONE_TIME_SNAPSHOT`. */
  accessType: string;
  /** True when Apple stopped an `ONGOING` request because nothing consumed it for ~12 months. */
  stoppedDueToInactivity?: boolean | undefined;
}

/** One report available within a request (e.g. "App Store Installations"), grouped by category. */
export interface AnalyticsReportResource {
  id: string;
  name: string;
  /** `APP_USAGE` | `APP_STORE_ENGAGEMENT` | `COMMERCE` | `FRAMEWORK_USAGE` | `PERFORMANCE`. */
  category?: string | undefined;
}

/** One time-period instance of a report — a single day/week/month of generated data. */
export interface AnalyticsReportInstanceResource {
  id: string;
  /** `DAILY` | `WEEKLY` | `MONTHLY`. */
  granularity: string;
  /** The date this instance covers (`YYYY-MM-DD`). */
  processingDate?: string | undefined;
}

/**
 * One downloadable segment of a report instance: a presigned `url` to a gzipped TSV plus its
 * `checksum`. A large instance is split across several segments that the caller concatenates.
 */
export interface AnalyticsReportSegmentResource {
  id: string;
  url: string;
  /** Apple's checksum of the decompressed segment, for integrity verification. */
  checksum?: string | undefined;
  sizeInBytes?: number | undefined;
}

/**
 * Parameters for a Sales & Trends report download — Apple's `filter[...]` query for `/v1/salesReports`.
 * `reportDate`'s format follows `frequency` (a day `2026-06-01` for DAILY, a year `2026` for YEARLY).
 * A disallowed `reportType`/`reportSubType` combination surfaces as a misleading "invalid vendor number".
 */
export interface SalesReportQuery {
  vendorNumber: string;
  /** `DAILY` | `WEEKLY` | `MONTHLY` | `YEARLY`. */
  frequency: string;
  /** `SALES` | `SUBSCRIPTION` | `SUBSCRIPTION_EVENT` | `SUBSCRIBER` | `PREORDER` | … */
  reportType: string;
  /** `SUMMARY` | `DETAILED` | … (valid set depends on `reportType`). */
  reportSubType: string;
  reportDate: string;
  /** Report schema version, e.g. `1_0`; Apple now requires it for several report types. */
  version?: string | undefined;
}

/** Parameters for a Finance report download — Apple's `filter[...]` query for `/v1/financeReports`. */
export interface FinanceReportQuery {
  vendorNumber: string;
  /** Fiscal period `YYYY-MM` (Apple's fiscal calendar, not the Gregorian month). */
  reportDate: string;
  /** Region code, e.g. `ZZ` (all regions) or `US`. */
  regionCode: string;
  /** `FINANCE_DETAIL` (default) | `FINANCIAL`. */
  reportType?: string | undefined;
}

/* -------------------------------------------------------------------------- */
/*  App Store release-lifecycle resources — consumed by core/appStoreRelease.ts  */
/*  (the version → build → review → rollout state machine). Untouched by the      */
/*  build/sign path and the `launch sync` catalog reconciler.                     */
/* -------------------------------------------------------------------------- */

/** A build (one uploaded binary) on App Store Connect, with the fields the release flow reads. */
export interface BuildResource {
  id: string;
  /** `CFBundleVersion` (the build number) as Apple's string, e.g. `"42"`. */
  version: string;
  /** Apple's processing state, e.g. `PROCESSING` / `VALID` / `INVALID`. Only a `VALID` build is attachable. */
  processingState: string;
  /** ISO-8601 upload instant, when requested in the field set. */
  uploadedDate?: string;
  /** Whether Apple expired the build (TestFlight's 90-day limit); an expired build can't be submitted. */
  expired: boolean;
}

/**
 * An App Store version — the per-release container carrying lifecycle state, release type, and the
 * attached build. One per marketing version + platform; `launch release` reuses an editable one or
 * creates the next.
 */
export interface AppStoreVersionResource {
  id: string;
  /** Marketing version (`CFBundleShortVersionString`), e.g. `1.2.0`. */
  versionString: string;
  /** Apple's lifecycle state, e.g. `PREPARE_FOR_SUBMISSION` / `WAITING_FOR_REVIEW` / `READY_FOR_SALE`. */
  appStoreState: string;
  /** How the approved version goes live (`AFTER_APPROVAL` / `MANUAL` / `SCHEDULED`), when requested. */
  releaseType?: string;
}

/** One locale's editable version copy. Launch only ever writes `whatsNew` (the release notes). */
export interface AppStoreVersionLocalizationResource {
  id: string;
  locale: string;
  /** "What's New in This Version" text; absent until set. */
  whatsNew?: string;
}

/** A version's phased-release schedule (Apple's 7-day staged rollout), present only once one exists. */
export interface PhasedReleaseResource {
  id: string;
  /** `ACTIVE` / `PAUSED` / `COMPLETE` / `INACTIVE`. */
  phasedReleaseState: string;
  /** Which day (1–7) of the ramp the rollout is on, when Apple reports it. */
  currentDayNumber?: number;
}

/**
 * An App Store review submission — Apple's current submission model: a per-app container the version is
 * added to as an item, then submitted as a unit. `state` distinguishes an addable draft
 * (`READY_FOR_REVIEW`) from one already in Apple's queue.
 */
export interface ReviewSubmissionResource {
  id: string;
  /** `READY_FOR_REVIEW` / `WAITING_FOR_REVIEW` / `IN_REVIEW` / `COMPLETING` / `COMPLETE` / `CANCELING` / `UNRESOLVED_ISSUES`. */
  state: string;
}

/**
 * One territory's resolved offer price: the territory code plus the Apple `subscriptionPricePoints` id
 * the customer-facing amount maps to. The reconciler resolves each {@link OfferPrice} to one of these
 * (via {@link AppStoreConnectClient.findSubscriptionPricePoint}) before any offer is created, so the
 * client only ever builds wire bodies from already-validated price points.
 */
export interface ResolvedOfferPrice {
  /** Apple territory code, e.g. `USA` — used directly as the `territories` resource id. */
  territory: string;
  /** Resolved `subscriptionPricePoints` id for the customer price in this territory. */
  pricePointId: string;
}

/** An offer-code campaign on a subscription, as listed for idempotent reconcile. `name` is the key. */
export interface OfferCodeResource {
  id: string;
  name: string;
  /** Whether the campaign is currently active; deactivating sets this false. */
  active: boolean;
}

/** A promotional offer on a subscription. `offerCode` (the StoreKit-facing id) is the reconciler's key. */
export interface PromotionalOfferResource {
  id: string;
  name: string;
  offerCode: string;
}

/**
 * An introductory offer on a subscription. `territory` is the territory code it applies to, or null for
 * an all-territories offer — the reconciler's key (Apple permits at most one intro offer per territory).
 */
export interface IntroductoryOfferResource {
  id: string;
  territory: string | null;
}

/** A win-back offer on a subscription, keyed by its stable `offerId`. */
export interface WinBackOfferResource {
  id: string;
  offerId: string;
}

/**
 * A promoted purchase on an app's product page. Exactly one of `inAppPurchaseId` / `subscriptionId` is
 * set — the live *resource* id of the promoted product (not its `productId`); the reconciler maps config
 * `productId`s onto these via the subscription/IAP listings to find what's already promoted.
 */
export interface PromotedPurchaseResource {
  id: string;
  inAppPurchaseId: string | null;
  subscriptionId: string | null;
  enabled: boolean;
  visibleForAllUsers: boolean;
}

/** Create input for an offer-code campaign — prices already resolved to {@link ResolvedOfferPrice}s. */
export interface OfferCodeCreate {
  subscriptionId: string;
  name: string;
  customerEligibilities: OfferCustomerEligibility[];
  offerEligibility: OfferEligibility;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  /** Empty for a `FREE_TRIAL` offer; otherwise one entry per declared territory. */
  prices: ResolvedOfferPrice[];
}

/** Create input for a promotional offer — `offerCode` is the StoreKit-facing id; prices pre-resolved. */
export interface PromotionalOfferCreate {
  subscriptionId: string;
  name: string;
  offerCode: string;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  prices: ResolvedOfferPrice[];
}

/** Create input for an introductory offer — at most one per territory (null = all territories). */
export interface IntroductoryOfferCreate {
  subscriptionId: string;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  /** Resolved single-territory price, or null for a `FREE_TRIAL` (no price). */
  price: ResolvedOfferPrice | null;
  /** Territory the offer applies to, or null for all territories. */
  territory: string | null;
  startDate?: string;
  endDate?: string;
}

/** Create input for a win-back offer — carries Apple's lapsed-customer eligibility windows. */
export interface WinBackOfferCreate {
  subscriptionId: string;
  offerId: string;
  referenceName: string;
  duration: OfferDuration;
  offerMode: OfferMode;
  numberOfPeriods: number;
  eligiblePaidMonths: number;
  monthsSinceLastSubscribed: { min: number; max: number };
  waitBetweenOffersMonths?: number;
  startDate: string;
  endDate?: string;
  priority: "HIGH" | "NORMAL";
  promotionIntent?: "NOT_PROMOTED" | "USE_AUTO_GENERATED_ASSETS";
  prices: ResolvedOfferPrice[];
}

/** A promoted product to register — exactly one of the two ids is set (resolved from a config `productId`). */
export interface PromotedPurchaseCreate {
  appId: string;
  inAppPurchaseId?: string;
  subscriptionId?: string;
  visibleForAllUsers: boolean;
  enabled: boolean;
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
 * Pick the given keys out of a localization's raw attributes, keeping only present, non-empty strings.
 * Apple returns empty fields as `null` or `""`; both are dropped so a diff treats "unset" uniformly.
 */
function pickListingFields(attributes: Record<string, unknown>, keys: readonly string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === "string" && value.length > 0) fields[key] = value;
  }
  return fields;
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

/** Client bound to one App Store Connect API key. */
export class AppStoreConnectClient {
  constructor(private readonly key: AscKey) {}

  /** Mint a short-lived bearer token for the API. */
  private async token(): Promise<string> {
    const privateKey = await importPKCS8(this.key.p8, "ES256");
    const issuedAt = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.key.keyId, typ: "JWT" })
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
    return withRetry(() => this.requestOnce<T>(method, pathOrUrl, body), { isRetryable: isRetryableAscError });
  }

  /** A single (un-retried) authenticated request — the retry wrapper lives in {@link request}. */
  private async requestOnce<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      throw new AscRequestError(
        `App Store Connect ${method} ${pathOrUrl} failed (${response.status}): ${describeErrors(text)}`,
        response.status,
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
      const page: PagedList<A> = await this.request<PagedList<A>>("GET", next);
      all.push(...page.data);
      next = page.links?.next;
    }
    return all;
  }

  /** Resolve the internal App Store Connect app id for a bundle identifier, or null if no record exists. */
  async getAppId(bundleId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ bundleId: string }>>(
      "GET",
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
      "GET",
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
      "GET",
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
      "GET",
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=usesNonExemptEncryption`,
    );
    const build = data[0];
    return build ? { id: build.id, usesNonExemptEncryption: build.attributes.usesNonExemptEncryption ?? null } : null;
  }

  /**
   * Answer a build's export-compliance question directly via its `usesNonExemptEncryption` attribute —
   * the one-call path for the common "no / only-exempt encryption" case (`false`), so App Store Connect
   * stops re-prompting on every upload. Apple accepts this only before the build is submitted for review.
   */
  async setBuildUsesNonExemptEncryption(buildId: string, value: boolean): Promise<void> {
    await this.request<unknown>("PATCH", `/builds/${buildId}`, {
      data: { type: "builds", id: buildId, attributes: { usesNonExemptEncryption: value } },
    });
  }

  /**
   * Resolve the app's current **editable** `appInfo` (the container for app-level listing copy — name,
   * subtitle, privacy URL — that persists across versions), or null when none is in an editable state.
   * A live app keeps a read-only `READY_FOR_DISTRIBUTION` appInfo we must never PATCH.
   */
  async getEditableAppInfoId(appId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ state?: string; appStoreState?: string }>>(
      "GET",
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
      locale: typeof entry.attributes["locale"] === "string" ? entry.attributes["locale"] : "",
      fields: pickListingFields(entry.attributes, APP_INFO_LISTING_FIELDS),
    }));
  }

  /** Create a missing app-level listing locale. `fields` must include `name` (Apple requires it). */
  async createAppInfoLocalization(appInfoId: string, locale: string, fields: Record<string, string>): Promise<void> {
    await this.request<unknown>("POST", "/appInfoLocalizations", {
      data: {
        type: "appInfoLocalizations",
        attributes: { locale, ...fields },
        relationships: { appInfo: { data: { type: "appInfos", id: appInfoId } } },
      },
    });
  }

  /** Patch changed fields on an existing app-level listing locale (locale itself is immutable). */
  async updateAppInfoLocalization(localizationId: string, fields: Record<string, string>): Promise<void> {
    await this.request<unknown>("PATCH", `/appInfoLocalizations/${localizationId}`, {
      data: { type: "appInfoLocalizations", id: localizationId, attributes: fields },
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
    return data.map((entry) => ({ id: entry.id, state: entry.attributes.appEncryptionDeclarationState }));
  }

  /**
   * Attach a build to an existing App Encryption Declaration, reusing that one-time, document-backed
   * answer instead of submitting a fresh declaration per build (Apple returns `204 No Content`).
   */
  async linkBuildToDeclaration(declarationId: string, buildId: string): Promise<void> {
    await this.request<unknown>("POST", `/appEncryptionDeclarations/${declarationId}/relationships/builds`, {
      data: [{ type: "builds", id: buildId }],
    });
  }

  /**
   * Resolve the app's current **editable** App Store version (the one whose listing copy — description,
   * keywords, what's new, … — can still be changed), or null when only a live/in-review version exists.
   */
  async getEditableVersionId(appId: string): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ appStoreState: string }>>(
      "GET",
      `/apps/${appId}/appStoreVersions?fields[appStoreVersions]=appStoreState&limit=20`,
    );
    const editable = data.find((version) => EDITABLE_VERSION_STATES.has(version.attributes.appStoreState));
    return editable?.id ?? null;
  }

  /** List the version-level listing localizations (description/keywords/whatsNew/…) under a version. */
  async listVersionLocalizations(versionId: string): Promise<ListingLocalization[]> {
    const data = await this.requestAll<Record<string, unknown>>(
      `/appStoreVersions/${versionId}/appStoreVersionLocalizations?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      locale: typeof entry.attributes["locale"] === "string" ? entry.attributes["locale"] : "",
      fields: pickListingFields(entry.attributes, VERSION_LISTING_FIELDS),
    }));
  }

  /** Create a missing version-level listing locale (Apple requires only `locale`). */
  async createVersionLocalization(versionId: string, locale: string, fields: Record<string, string>): Promise<void> {
    await this.request<unknown>("POST", "/appStoreVersionLocalizations", {
      data: {
        type: "appStoreVersionLocalizations",
        attributes: { locale, ...fields },
        relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
      },
    });
  }

  /** Patch changed fields on an existing version-level listing locale (locale itself is immutable). */
  async updateVersionLocalization(localizationId: string, fields: Record<string, string>): Promise<void> {
    await this.request<unknown>("PATCH", `/appStoreVersionLocalizations/${localizationId}`, {
      data: { type: "appStoreVersionLocalizations", id: localizationId, attributes: fields },
    });
  }

  /** Cheap call that fails with a clear message when the account has an unsigned/expired agreement. */
  async assertReady(): Promise<void> {
    await this.request<ResourceList<unknown>>("GET", "/bundleIds?limit=1");
  }

  /**
   * Resolve this key's Apple Team ID — the bundle-id `seedId`, the only team identifier an API key
   * exposes (there is no org-name endpoint). Null when the account has registered no bundle ids yet.
   */
  async resolveTeamId(): Promise<string | null> {
    const { data } = await this.request<ResourceList<{ seedId?: string }>>(
      "GET",
      "/bundleIds?limit=1&fields[bundleIds]=seedId",
    );
    return data[0]?.attributes.seedId ?? null;
  }

  /**
   * List the names of the apps this key can access — the recognizable signal for telling accounts
   * apart in the picker (an opaque Team ID alone isn't memorable). All pages, names only.
   */
  async listAppNames(): Promise<string[]> {
    const data = await this.requestAll<{ name?: string }>("/apps?fields[apps]=name&limit=200");
    return data.map((entry) => entry.attributes.name).filter((name): name is string => Boolean(name));
  }

  /** Find a registered Bundle ID by its identifier, or null if it isn't registered yet. */
  async findBundleId(identifier: string): Promise<BundleIdResource | null> {
    const { data } = await this.request<ResourceList<{ identifier: string; seedId?: string }>>(
      "GET",
      `/bundleIds?filter[identifier]=${encodeURIComponent(identifier)}&limit=1`,
    );
    const first = data[0];
    if (!first) return null;
    return { id: first.id, identifier: first.attributes.identifier, seedId: first.attributes.seedId };
  }

  /** Register a new Bundle ID (App ID) so a build can be signed against it. */
  async createBundleId(identifier: string, name: string): Promise<BundleIdResource> {
    const { data } = await this.request<ResourceSingle<{ identifier: string; seedId?: string }>>("POST", "/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier, name, platform: "IOS" } },
    });
    return { id: data.id, identifier: data.attributes.identifier, seedId: data.attributes.seedId };
  }

  /** List distribution certificates, newest expiry first, for reuse before creating a new one. */
  async listDistributionCertificates(): Promise<CertificateResource[]> {
    const data = await this.requestAll<{ serialNumber: string; certificateContent: string; expirationDate?: string }>(
      `/certificates?filter[certificateType]=${DISTRIBUTION_CERT_TYPE}&limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      serialNumber: entry.attributes.serialNumber,
      certificateContent: entry.attributes.certificateContent,
      expirationDate: entry.attributes.expirationDate,
    }));
  }

  /** Create a distribution certificate from a PEM certificate-signing request. */
  async createCertificate(csrContent: string): Promise<CertificateResource> {
    const { data } = await this.request<
      ResourceSingle<{ serialNumber: string; certificateContent: string; expirationDate?: string }>
    >("POST", "/certificates", {
      data: { type: "certificates", attributes: { csrContent, certificateType: DISTRIBUTION_CERT_TYPE } },
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
    const { data } = await this.request<ResourceList<{ name: string; uuid: string; profileContent: string }>>(
      "GET",
      `/profiles?filter[name]=${encodeURIComponent(name)}&limit=1`,
    );
    const first = data[0];
    if (!first) return null;
    return {
      id: first.id,
      name: first.attributes.name,
      uuid: first.attributes.uuid,
      profileContent: first.attributes.profileContent,
    };
  }

  /** Create an App Store provisioning profile linking a bundle id to a distribution certificate. */
  async createAppStoreProfile(
    name: string,
    bundleIdResourceId: string,
    certificateId: string,
  ): Promise<ProfileResource> {
    const { data } = await this.request<ResourceSingle<{ name: string; uuid: string; profileContent: string }>>(
      "POST",
      "/profiles",
      {
        data: {
          type: "profiles",
          attributes: { name, profileType: APP_STORE_PROFILE_TYPE },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleIdResourceId } },
            certificates: { data: [{ type: "certificates", id: certificateId }] },
          },
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
    await this.request<unknown>("DELETE", `/profiles/${id}`);
  }

  /**
   * List every registered device, across all pages. An ad-hoc profile must enumerate the devices it
   * covers, and a real team easily exceeds Apple's 200-per-page cap — so this folds the whole
   * collection via {@link requestAll} rather than reading one page (the silent-truncation trap).
   */
  async listDevices(): Promise<DeviceResource[]> {
    const data = await this.requestAll<{ udid: string; name: string; status?: string }>("/devices?limit=200");
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
    return (await this.listDevices()).find((device) => device.udid.toLowerCase() === wanted) ?? null;
  }

  /**
   * Register a device so ad-hoc builds can target it. Apple treats a known UDID idempotently (it
   * returns the existing entry rather than erroring), so callers can register-then-include safely.
   */
  async registerDevice(udid: string, name: string): Promise<DeviceResource> {
    const { data } = await this.request<ResourceSingle<{ udid: string; name: string; status?: string }>>(
      "POST",
      "/devices",
      { data: { type: "devices", attributes: { udid, name, platform: IOS_DEVICE_PLATFORM } } },
    );
    return { id: data.id, udid: data.attributes.udid, name: data.attributes.name, status: data.attributes.status };
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
  ): Promise<ProfileResource> {
    const { data } = await this.request<ResourceSingle<{ name: string; uuid: string; profileContent: string }>>(
      "POST",
      "/profiles",
      {
        data: {
          type: "profiles",
          attributes: { name, profileType: AD_HOC_PROFILE_TYPE },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleIdResourceId } },
            certificates: { data: [{ type: "certificates", id: certificateId }] },
            devices: { data: deviceIds.map((id) => ({ type: "devices", id })) },
          },
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

  /** List the capabilities currently enabled on a bundle id (App ID). */
  async listBundleIdCapabilities(bundleIdResourceId: string): Promise<BundleIdCapabilityResource[]> {
    const data = await this.requestAll<{ capabilityType?: string }>(
      `/bundleIds/${bundleIdResourceId}/bundleIdCapabilities?limit=200`,
    );
    return data.flatMap((entry) =>
      entry.attributes.capabilityType ? [{ id: entry.id, capabilityType: entry.attributes.capabilityType }] : [],
    );
  }

  /** Enable a capability on a bundle id. The reconciler only calls this for a capability not already on. */
  async enableCapability(bundleIdResourceId: string, capabilityType: string): Promise<BundleIdCapabilityResource> {
    const { data } = await this.request<ResourceSingle<{ capabilityType?: string }>>("POST", "/bundleIdCapabilities", {
      data: {
        type: "bundleIdCapabilities",
        attributes: { capabilityType },
        relationships: { bundleId: { data: { type: "bundleIds", id: bundleIdResourceId } } },
      },
    });
    return { id: data.id, capabilityType: data.attributes.capabilityType ?? capabilityType };
  }

  /** Disable a capability by its resource id (only reached under `--allow-destructive`). */
  async disableCapability(capabilityId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/bundleIdCapabilities/${capabilityId}`);
  }

  /** List an app's in-app purchases (the `inAppPurchasesV2` collection), across all pages. */
  async listInAppPurchases(appId: string): Promise<InAppPurchaseResource[]> {
    const data = await this.requestAll<{
      productId?: string;
      name?: string;
      inAppPurchaseType?: string;
      state?: string;
    }>(`/apps/${appId}/inAppPurchasesV2?limit=200&fields[inAppPurchases]=productId,name,inAppPurchaseType,state`);
    return data.map((entry) => ({
      id: entry.id,
      productId: entry.attributes.productId ?? "",
      name: entry.attributes.name ?? "",
      inAppPurchaseType: entry.attributes.inAppPurchaseType ?? "",
      ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
    }));
  }

  /** Create an in-app purchase. Note the `/v2` path — IAP creation is one of Apple's few v2 endpoints. */
  async createInAppPurchase(
    appId: string,
    input: { productId: string; name: string; inAppPurchaseType: string },
  ): Promise<InAppPurchaseResource> {
    const { data } = await this.request<
      ResourceSingle<{ productId?: string; name?: string; inAppPurchaseType?: string }>
    >("POST", this.v2("/inAppPurchases"), {
      data: {
        type: "inAppPurchases",
        attributes: { productId: input.productId, name: input.name, inAppPurchaseType: input.inAppPurchaseType },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
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
    return this.localizationsFrom(`/inAppPurchasesV2/${iapId}/inAppPurchaseLocalizations?limit=200`);
  }

  /** Create one locale's display copy for an in-app purchase. */
  async createInAppPurchaseLocalization(
    iapId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization("inAppPurchaseLocalizations", "inAppPurchaseV2", "inAppPurchases", iapId, input);
  }

  /** List an app's subscription groups. */
  async listSubscriptionGroups(appId: string): Promise<SubscriptionGroupResource[]> {
    const data = await this.requestAll<{ referenceName?: string }>(
      `/apps/${appId}/subscriptionGroups?limit=200&fields[subscriptionGroups]=referenceName`,
    );
    return data.flatMap((entry) =>
      entry.attributes.referenceName ? [{ id: entry.id, referenceName: entry.attributes.referenceName }] : [],
    );
  }

  /** Create a subscription group on an app. */
  async createSubscriptionGroup(appId: string, referenceName: string): Promise<SubscriptionGroupResource> {
    const { data } = await this.request<ResourceSingle<{ referenceName?: string }>>("POST", "/subscriptionGroups", {
      data: {
        type: "subscriptionGroups",
        attributes: { referenceName },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return { id: data.id, referenceName: data.attributes.referenceName ?? referenceName };
  }

  /** List a subscription group's display-name localizations. */
  async listSubscriptionGroupLocalizations(groupId: string): Promise<LocalizationResource[]> {
    return this.localizationsFrom(`/subscriptionGroups/${groupId}/subscriptionGroupLocalizations?limit=200`);
  }

  /** Create one locale's display name for a subscription group (groups carry a name only, no description). */
  async createSubscriptionGroupLocalization(
    groupId: string,
    input: { locale: string; name: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization(
      "subscriptionGroupLocalizations",
      "subscriptionGroup",
      "subscriptionGroups",
      groupId,
      input,
    );
  }

  /** List the subscriptions in a group. */
  async listSubscriptions(groupId: string): Promise<SubscriptionResource[]> {
    const data = await this.requestAll<{ productId?: string; name?: string; state?: string }>(
      `/subscriptionGroups/${groupId}/subscriptions?limit=200&fields[subscriptions]=productId,name,state`,
    );
    return data.map((entry) => ({
      id: entry.id,
      productId: entry.attributes.productId ?? "",
      name: entry.attributes.name ?? "",
      ...(entry.attributes.state ? { state: entry.attributes.state } : {}),
    }));
  }

  /** Create an auto-renewable subscription in a group. */
  async createSubscription(
    groupId: string,
    input: { productId: string; name: string; subscriptionPeriod: string; groupLevel: number },
  ): Promise<SubscriptionResource> {
    const { data } = await this.request<ResourceSingle<{ productId?: string; name?: string }>>(
      "POST",
      "/subscriptions",
      {
        data: {
          type: "subscriptions",
          attributes: {
            productId: input.productId,
            name: input.name,
            subscriptionPeriod: input.subscriptionPeriod,
            groupLevel: input.groupLevel,
          },
          relationships: { group: { data: { type: "subscriptionGroups", id: groupId } } },
        },
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
    return this.localizationsFrom(`/subscriptions/${subscriptionId}/subscriptionLocalizations?limit=200`);
  }

  /** Create one locale's display copy for a subscription. */
  async createSubscriptionLocalization(
    subscriptionId: string,
    input: { locale: string; name: string; description?: string },
  ): Promise<LocalizationResource> {
    return this.createLocalization("subscriptionLocalizations", "subscription", "subscriptions", subscriptionId, input);
  }

  /** Whether a subscription already has at least one price set (so the reconciler skips re-pricing it). */
  async subscriptionHasPrice(subscriptionId: string): Promise<boolean> {
    const { data } = await this.request<ResourceList<unknown>>(
      "GET",
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
    await this.request<unknown>("POST", "/subscriptionPrices", {
      data: {
        type: "subscriptionPrices",
        attributes: { preserveCurrentPrice: false },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subscriptionId } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: pricePointId } },
        },
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
      name: entry.attributes.name ?? "",
      active: entry.attributes.active ?? false,
    }));
  }

  /** Create an offer-code campaign with its per-territory prices (temp-id + `included` inline pattern). */
  async createSubscriptionOfferCode(input: OfferCodeCreate): Promise<OfferCodeResource> {
    const body: components["schemas"]["SubscriptionOfferCodeCreateRequest"] = {
      data: {
        type: "subscriptionOfferCodes",
        attributes: {
          name: input.name,
          customerEligibilities: input.customerEligibilities,
          offerEligibility: input.offerEligibility,
          duration: input.duration,
          offerMode: input.offerMode,
          numberOfPeriods: input.numberOfPeriods,
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({ type: "subscriptionOfferCodePrices", id: `price-${index}` })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: "subscriptionOfferCodePrices",
        id: `price-${index}`,
        relationships: {
          territory: { data: { type: "territories", id: price.territory } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: price.pricePointId } },
        },
      })),
    };
    const { data } = await this.request<ResourceSingle<{ name?: string; active?: boolean }>>(
      "POST",
      "/subscriptionOfferCodes",
      body,
    );
    return { id: data.id, name: data.attributes.name ?? input.name, active: data.attributes.active ?? true };
  }

  /** Deactivate an offer-code campaign (Apple only lets you toggle `active`, never edit the terms). */
  async deactivateOfferCode(offerCodeId: string): Promise<void> {
    const body: components["schemas"]["SubscriptionOfferCodeUpdateRequest"] = {
      data: { type: "subscriptionOfferCodes", id: offerCodeId, attributes: { active: false } },
    };
    await this.request<unknown>("PATCH", `/subscriptionOfferCodes/${offerCodeId}`, body);
  }

  /** Generate a batch of one-time-use codes under an offer-code campaign. */
  async createOfferCodeOneTimeUseBatch(
    offerCodeId: string,
    numberOfCodes: number,
    expirationDate: string,
  ): Promise<void> {
    const body: components["schemas"]["SubscriptionOfferCodeOneTimeUseCodeCreateRequest"] = {
      data: {
        type: "subscriptionOfferCodeOneTimeUseCodes",
        attributes: { numberOfCodes, expirationDate },
        relationships: { offerCode: { data: { type: "subscriptionOfferCodes", id: offerCodeId } } },
      },
    };
    await this.request<unknown>("POST", "/subscriptionOfferCodeOneTimeUseCodes", body);
  }

  /** Create a custom (shareable) code under an offer-code campaign, redeemable `numberOfCodes` times. */
  async createOfferCodeCustomCode(
    offerCodeId: string,
    customCode: string,
    numberOfCodes: number,
    expirationDate?: string,
  ): Promise<void> {
    const body: components["schemas"]["SubscriptionOfferCodeCustomCodeCreateRequest"] = {
      data: {
        type: "subscriptionOfferCodeCustomCodes",
        attributes: { customCode, numberOfCodes, ...(expirationDate ? { expirationDate } : {}) },
        relationships: { offerCode: { data: { type: "subscriptionOfferCodes", id: offerCodeId } } },
      },
    };
    await this.request<unknown>("POST", "/subscriptionOfferCodeCustomCodes", body);
  }

  /** List a subscription's promotional offers (keyed by the StoreKit-facing `offerCode`). */
  async listPromotionalOffers(subscriptionId: string): Promise<PromotionalOfferResource[]> {
    const data = await this.requestAll<{ name?: string; offerCode?: string }>(
      `/subscriptions/${subscriptionId}/promotionalOffers?limit=200`,
    );
    return data.map((entry) => ({
      id: entry.id,
      name: entry.attributes.name ?? "",
      offerCode: entry.attributes.offerCode ?? "",
    }));
  }

  /** Create a promotional offer with its per-territory prices. */
  async createPromotionalOffer(input: PromotionalOfferCreate): Promise<PromotionalOfferResource> {
    const body: components["schemas"]["SubscriptionPromotionalOfferCreateRequest"] = {
      data: {
        type: "subscriptionPromotionalOffers",
        attributes: {
          duration: input.duration,
          name: input.name,
          numberOfPeriods: input.numberOfPeriods,
          offerCode: input.offerCode,
          offerMode: input.offerMode,
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({
              type: "subscriptionPromotionalOfferPrices",
              id: `price-${index}`,
            })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: "subscriptionPromotionalOfferPrices",
        id: `price-${index}`,
        relationships: {
          territory: { data: { type: "territories", id: price.territory } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: price.pricePointId } },
        },
      })),
    };
    const { data } = await this.request<ResourceSingle<{ name?: string; offerCode?: string }>>(
      "POST",
      "/subscriptionPromotionalOffers",
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
    }>("GET", `/subscriptions/${subscriptionId}/introductoryOffers?include=territory&limit=200`);
    return data.map((entry) => ({ id: entry.id, territory: entry.relationships?.territory?.data?.id ?? null }));
  }

  /** Create an introductory offer for one territory (or all territories when `territory`/`price` are null). */
  async createIntroductoryOffer(input: IntroductoryOfferCreate): Promise<void> {
    const body: components["schemas"]["SubscriptionIntroductoryOfferCreateRequest"] = {
      data: {
        type: "subscriptionIntroductoryOffers",
        attributes: {
          duration: input.duration,
          offerMode: input.offerMode,
          numberOfPeriods: input.numberOfPeriods,
          ...(input.startDate ? { startDate: input.startDate } : {}),
          ...(input.endDate ? { endDate: input.endDate } : {}),
        },
        relationships: {
          subscription: { data: { type: "subscriptions", id: input.subscriptionId } },
          ...(input.territory ? { territory: { data: { type: "territories", id: input.territory } } } : {}),
          ...(input.price
            ? { subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: input.price.pricePointId } } }
            : {}),
        },
      },
    };
    await this.request<unknown>("POST", "/subscriptionIntroductoryOffers", body);
  }

  /** List a subscription's win-back offers, keyed by the stable `offerId`. */
  async listWinBackOffers(subscriptionId: string): Promise<WinBackOfferResource[]> {
    const data = await this.requestAll<{ offerId?: string }>(
      `/subscriptions/${subscriptionId}/winBackOffers?limit=200`,
    );
    return data.map((entry) => ({ id: entry.id, offerId: entry.attributes.offerId ?? "" }));
  }

  /** Create a win-back offer with its lapsed-customer eligibility windows and per-territory prices. */
  async createWinBackOffer(input: WinBackOfferCreate): Promise<void> {
    const body: components["schemas"]["WinBackOfferCreateRequest"] = {
      data: {
        type: "winBackOffers",
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
          subscription: { data: { type: "subscriptions", id: input.subscriptionId } },
          prices: {
            data: input.prices.map((_, index) => ({ type: "winBackOfferPrices", id: `price-${index}` })),
          },
        },
      },
      included: input.prices.map((price, index) => ({
        type: "winBackOfferPrices",
        id: `price-${index}`,
        relationships: {
          territory: { data: { type: "territories", id: price.territory } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: price.pricePointId } },
        },
      })),
    };
    await this.request<unknown>("POST", "/winBackOffers", body);
  }

  /** List an app's promoted purchases in their current product-page order, with each one's product linkage. */
  async listPromotedPurchases(appId: string): Promise<PromotedPurchaseResource[]> {
    const all: PromotedPurchaseResource[] = [];
    let next: string | undefined = `/apps/${appId}/promotedPurchases?limit=200`;
    while (next) {
      const page: PromotedPurchasePage = await this.request<PromotedPurchasePage>("GET", next);
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
    const body: components["schemas"]["PromotedPurchaseCreateRequest"] = {
      data: {
        type: "promotedPurchases",
        attributes: { visibleForAllUsers: input.visibleForAllUsers, enabled: input.enabled },
        relationships: {
          app: { data: { type: "apps", id: input.appId } },
          ...(input.inAppPurchaseId
            ? { inAppPurchaseV2: { data: { type: "inAppPurchases", id: input.inAppPurchaseId } } }
            : {}),
          ...(input.subscriptionId
            ? { subscription: { data: { type: "subscriptions", id: input.subscriptionId } } }
            : {}),
        },
      },
    };
    const { data } = await this.request<ResourceSingle<{ enabled?: boolean; visibleForAllUsers?: boolean }>>(
      "POST",
      "/promotedPurchases",
      body,
    );
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
    const body: components["schemas"]["AppPromotedPurchasesLinkagesRequest"] = {
      data: orderedIds.map((id) => ({ type: "promotedPurchases", id })),
    };
    await this.request<unknown>("PATCH", `/apps/${appId}/relationships/promotedPurchases`, body);
  }

  /** Whether an in-app purchase already has a price schedule (so the reconciler skips re-pricing it). */
  async inAppPurchaseHasPrice(iapId: string): Promise<boolean> {
    try {
      const { data } = await this.request<{ data: { id: string } | null }>(
        "GET",
        `/inAppPurchasesV2/${iapId}/iapPriceSchedule`,
      );
      return data !== null;
    } catch (error) {
      // No schedule yet reads as a 404 on some accounts — that's "unpriced", not a real failure.
      if (error instanceof AscRequestError && error.status === 404) return false;
      throw error;
    }
  }

  /** Find the IAP price point in `territory` whose customer price equals `customerPrice`, or null. */
  async findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<PricePointResource | null> {
    const points = await this.requestAll<{ customerPrice?: string; territory?: string }>(
      this.v2(`/inAppPurchases/${iapId}/pricePoints?filter[territory]=${encodeURIComponent(territory)}&limit=8000`),
    );
    return matchPricePoint(points, territory, customerPrice);
  }

  /**
   * Set an IAP's price by creating a price schedule anchored on a base territory's price point. The
   * relationship references a client-supplied temp id that the `included` price resource carries —
   * the JSON:API pattern Apple requires here — and a `baseTerritory` is mandatory (omitting it returns
   * Apple's `BASE_TERRITORY_INTERVAL_REQUIRED` 409).
   */
  async createInAppPurchasePriceSchedule(iapId: string, baseTerritory: string, pricePointId: string): Promise<void> {
    const priceRef = "launch-base-price";
    await this.request<unknown>("POST", "/inAppPurchasePriceSchedules", {
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          baseTerritory: { data: { type: "territories", id: baseTerritory } },
          manualPrices: { data: [{ type: "inAppPurchasePrices", id: priceRef }] },
        },
      },
      included: [
        {
          type: "inAppPurchasePrices",
          id: priceRef,
          attributes: { startDate: null },
          relationships: {
            inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } },
            inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: pricePointId } },
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
    const data = await this.requestAll<{ name?: string; isInternalGroup?: boolean; publicLink?: string | null }>(
      `/apps/${appId}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,publicLink`,
    );
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
    return (await this.listBetaGroups(appId)).find((group) => group.name.toLowerCase() === wanted) ?? null;
  }

  /** Create an external beta group on an app — the bucket external testers are invited into. */
  async createBetaGroup(appId: string, name: string): Promise<BetaGroupResource> {
    const { data } = await this.request<ResourceSingle<{ name?: string }>>("POST", "/betaGroups", {
      data: {
        type: "betaGroups",
        attributes: { name },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
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
    const { data } = await this.request<
      ResourceSingle<{ email?: string; firstName?: string; lastName?: string; state?: string }>
    >("POST", "/betaTesters", {
      data: {
        type: "betaTesters",
        attributes: {
          email: input.email,
          ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
          ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
        },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: groupId }] } },
      },
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
    await this.request<unknown>("POST", `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: "betaTesters", id })),
    });
  }

  /** Remove testers from a beta group; they keep app access through any other group they're in. */
  async removeTestersFromGroup(groupId: string, testerIds: string[]): Promise<void> {
    await this.request<unknown>("DELETE", `/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: "betaTesters", id })),
    });
  }

  /** Shared GET → {@link BetaTesterResource}[] for any beta-tester collection (group members or a lookup). */
  private async betaTestersFrom(path: string): Promise<BetaTesterResource[]> {
    const data = await this.requestAll<{ email?: string; firstName?: string; lastName?: string; state?: string }>(path);
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

  /** Shared GET → {@link LocalizationResource}[] for any product/subscription/group localization collection. */
  private async localizationsFrom(path: string): Promise<LocalizationResource[]> {
    const data = await this.requestAll<{ locale?: string; name?: string; description?: string }>(path);
    return data.flatMap((entry) =>
      entry.attributes.locale && entry.attributes.name
        ? [
            {
              id: entry.id,
              locale: entry.attributes.locale,
              name: entry.attributes.name,
              ...(entry.attributes.description ? { description: entry.attributes.description } : {}),
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
    const { data } = await this.request<ResourceSingle<{ locale?: string; name?: string; description?: string }>>(
      "POST",
      `/${resourceType}`,
      {
        data: {
          type: resourceType,
          attributes: {
            locale: input.locale,
            name: input.name,
            ...(input.description === undefined ? {} : { description: input.description }),
          },
          relationships: { [relationshipName]: { data: { type: parentType, id: parentId } } },
        },
      },
    );
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
      const page: CustomerReviewPage = await this.request<CustomerReviewPage>("GET", next);
      for (const { id, attributes, relationships } of page.data) {
        reviews.push({
          id,
          rating: typeof attributes.rating === "number" ? attributes.rating : 0,
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
  async getCustomerReviewResponse(reviewId: string): Promise<CustomerReviewResponseResource | null> {
    try {
      const { data } = await this.request<{
        data: {
          id: string;
          attributes: { responseBody?: string; state?: string; lastModifiedDate?: string };
        } | null;
      }>("GET", `/customerReviews/${reviewId}/response`);
      return data ? toReviewResponse(data) : null;
    } catch (error) {
      if (error instanceof AscRequestError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Create or replace the developer response to a review. Apple's `POST /v1/customerReviewResponses`
   * is an upsert — it replaces an existing response in place — so callers never delete-then-recreate.
   */
  async createCustomerReviewResponse(reviewId: string, responseBody: string): Promise<CustomerReviewResponseResource> {
    const { data } = await this.request<
      ResourceSingle<{ responseBody?: string; state?: string; lastModifiedDate?: string }>
    >("POST", "/customerReviewResponses", {
      data: {
        type: "customerReviewResponses",
        attributes: { responseBody },
        relationships: { review: { data: { type: "customerReviews", id: reviewId } } },
      },
    });
    return toReviewResponse(data);
  }

  /** Delete a developer response by its resource id. */
  async deleteCustomerReviewResponse(responseId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/customerReviewResponses/${responseId}`);
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
    return this.getReportBytes(`/salesReports?${params.join("&")}`);
  }

  /** Download a Finance report as raw gzip bytes (the caller decompresses + parses the TSV). */
  async getFinanceReport(query: FinanceReportQuery): Promise<Buffer> {
    const params = [
      `filter[regionCode]=${query.regionCode}`,
      `filter[reportDate]=${query.reportDate}`,
      `filter[reportType]=${query.reportType ?? "FINANCE_DETAIL"}`,
      `filter[vendorNumber]=${encodeURIComponent(query.vendorNumber)}`,
    ];
    return this.getReportBytes(`/financeReports?${params.join("&")}`);
  }

  /** List an app's analytics report requests of one access type (`ONGOING` / `ONE_TIME_SNAPSHOT`). */
  async listAnalyticsReportRequests(appId: string, accessType: string): Promise<AnalyticsReportRequestResource[]> {
    const data = await this.requestAll<{ accessType?: string; stoppedDueToInactivity?: boolean }>(
      `/apps/${appId}/analyticsReportRequests?filter[accessType]=${accessType}&limit=200`,
    );
    return data.map((entry) => toReportRequest(entry, accessType));
  }

  /**
   * Create an analytics report request for an app. Creating a brand-new report type for the first time
   * needs the Admin role — a non-Admin key returns 403, which `launch reports` surfaces actionably.
   */
  async createAnalyticsReportRequest(appId: string, accessType: string): Promise<AnalyticsReportRequestResource> {
    const { data } = await this.request<ResourceSingle<{ accessType?: string; stoppedDueToInactivity?: boolean }>>(
      "POST",
      "/analyticsReportRequests",
      {
        data: {
          type: "analyticsReportRequests",
          attributes: { accessType },
          relationships: { app: { data: { type: "apps", id: appId } } },
        },
      },
    );
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
      name: entry.attributes.name ?? "",
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
      granularity: entry.attributes.granularity ?? "",
      ...(entry.attributes.processingDate ? { processingDate: entry.attributes.processingDate } : {}),
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
              ...(entry.attributes.sizeInBytes !== undefined ? { sizeInBytes: entry.attributes.sizeInBytes } : {}),
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
          throw new AscRequestError(`Analytics segment download failed (${response.status}).`, response.status);
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
    return withRetry(() => this.getReportBytesOnce(pathOrUrl), { isRetryable: isRetryableAscError });
  }

  /** A single (un-retried) gzipped-report fetch — the retry wrapper lives in {@link getReportBytes}. */
  private async getReportBytesOnce(pathOrUrl: string): Promise<Buffer> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: "application/a-gzip, application/json" },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new AscRequestError(
        `App Store Connect GET ${pathOrUrl} failed (${response.status}): ${describeErrors(text)}`,
        response.status,
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
      ResourceList<{ version?: string; processingState?: string; uploadedDate?: string; expired?: boolean }>
    >(
      "GET",
      `/builds?filter[app]=${appId}&sort=-uploadedDate&limit=${limit}&fields[builds]=version,processingState,uploadedDate,expired`,
    );
    return data.map((entry) => toBuildResource(entry));
  }

  /** Find one build by its `CFBundleVersion` number (the resource id is needed to attach / PATCH it), or null. */
  async findBuildByVersion(appId: string, buildNumber: number): Promise<BuildResource | null> {
    const { data } = await this.request<
      ResourceList<{ version?: string; processingState?: string; uploadedDate?: string; expired?: boolean }>
    >(
      "GET",
      `/builds?filter[app]=${appId}&filter[version]=${buildNumber}&limit=1&fields[builds]=version,processingState,uploadedDate,expired`,
    );
    const first = data[0];
    return first ? toBuildResource(first) : null;
  }

  /** List an app's App Store versions for a platform (e.g. `IOS`), across all pages. */
  async listAppStoreVersions(appId: string, platform: string): Promise<AppStoreVersionResource[]> {
    const data = await this.requestAll<{ versionString?: string; appStoreState?: string; releaseType?: string }>(
      `/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=200&fields[appStoreVersions]=versionString,appStoreState,releaseType`,
    );
    return data.map((entry) => toVersionResource(entry));
  }

  /** Create a new App Store version for a marketing version string on a platform. */
  async createAppStoreVersion(
    appId: string,
    input: { versionString: string; platform: string; releaseType?: string; earliestReleaseDate?: string },
  ): Promise<AppStoreVersionResource> {
    const attributes: Record<string, string> = { platform: input.platform, versionString: input.versionString };
    if (input.releaseType) attributes["releaseType"] = input.releaseType;
    if (input.earliestReleaseDate) attributes["earliestReleaseDate"] = input.earliestReleaseDate;
    const { data } = await this.request<
      ResourceSingle<{ versionString?: string; appStoreState?: string; releaseType?: string }>
    >("POST", "/appStoreVersions", {
      data: { type: "appStoreVersions", attributes, relationships: { app: { data: { type: "apps", id: appId } } } },
    });
    return toVersionResource({ id: data.id, attributes: data.attributes }, input.versionString);
  }

  /** Update an editable version's release type / scheduled date / version string. */
  async updateAppStoreVersion(
    versionId: string,
    input: { releaseType?: string; earliestReleaseDate?: string; versionString?: string },
  ): Promise<void> {
    const attributes: Record<string, string> = {};
    if (input.releaseType) attributes["releaseType"] = input.releaseType;
    if (input.earliestReleaseDate) attributes["earliestReleaseDate"] = input.earliestReleaseDate;
    if (input.versionString) attributes["versionString"] = input.versionString;
    await this.request<unknown>("PATCH", `/appStoreVersions/${versionId}`, {
      data: { type: "appStoreVersions", id: versionId, attributes },
    });
  }

  /** Attach a (processed, VALID) build to a version — the `relationships/build` PATCH. */
  async selectBuildForVersion(versionId: string, buildId: string): Promise<void> {
    await this.request<unknown>("PATCH", `/appStoreVersions/${versionId}/relationships/build`, {
      data: { type: "builds", id: buildId },
    });
  }

  /** List a version's per-locale copy (Launch reads only `whatsNew`). */
  async listAppStoreVersionLocalizations(versionId: string): Promise<AppStoreVersionLocalizationResource[]> {
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
    const { data } = await this.request<ResourceSingle<{ locale?: string; whatsNew?: string }>>(
      "POST",
      "/appStoreVersionLocalizations",
      {
        data: {
          type: "appStoreVersionLocalizations",
          attributes: { locale: input.locale, whatsNew: input.whatsNew },
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
        },
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
    await this.request<unknown>("PATCH", `/appStoreVersionLocalizations/${localizationId}`, {
      data: { type: "appStoreVersionLocalizations", id: localizationId, attributes: { whatsNew } },
    });
  }

  /** A version's phased-release schedule, or null when none has been created yet (a fresh version). */
  async getPhasedRelease(versionId: string): Promise<PhasedReleaseResource | null> {
    try {
      const { data } = await this.request<{
        data: { id: string; attributes: { phasedReleaseState?: string; currentDayNumber?: number } } | null;
      }>("GET", `/appStoreVersions/${versionId}/appStoreVersionPhasedRelease`);
      return data ? toPhasedRelease(data) : null;
    } catch (error) {
      if (error instanceof AscRequestError && error.status === 404) return null;
      throw error;
    }
  }

  /** Create a phased release on a version (starts `ACTIVE`; takes effect once the version goes live). */
  async createPhasedRelease(versionId: string): Promise<PhasedReleaseResource> {
    const { data } = await this.request<ResourceSingle<{ phasedReleaseState?: string; currentDayNumber?: number }>>(
      "POST",
      "/appStoreVersionPhasedReleases",
      {
        data: {
          type: "appStoreVersionPhasedReleases",
          attributes: { phasedReleaseState: "ACTIVE" },
          relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
        },
      },
    );
    return toPhasedRelease({ id: data.id, attributes: data.attributes });
  }

  /** Steer a phased release: `PAUSE`, `ACTIVE` (resume), or `COMPLETE` (finish the ramp now). */
  async updatePhasedRelease(phasedReleaseId: string, phasedReleaseState: string): Promise<void> {
    await this.request<unknown>("PATCH", `/appStoreVersionPhasedReleases/${phasedReleaseId}`, {
      data: { type: "appStoreVersionPhasedReleases", id: phasedReleaseId, attributes: { phasedReleaseState } },
    });
  }

  /** Remove a phased release (opt back into an immediate 100% rollout before go-live). */
  async deletePhasedRelease(phasedReleaseId: string): Promise<void> {
    await this.request<unknown>("DELETE", `/appStoreVersionPhasedReleases/${phasedReleaseId}`);
  }

  /** List an app's review submissions for a platform (to reuse an addable `READY_FOR_REVIEW` draft). */
  async listReviewSubmissions(appId: string, platform: string): Promise<ReviewSubmissionResource[]> {
    const data = await this.requestAll<{ state?: string }>(
      `/apps/${appId}/reviewSubmissions?filter[platform]=${platform}&limit=200&fields[reviewSubmissions]=state`,
    );
    return data.map((entry) => ({ id: entry.id, state: entry.attributes.state ?? "" }));
  }

  /** Open a new review submission container for a platform. */
  async createReviewSubmission(appId: string, platform: string): Promise<ReviewSubmissionResource> {
    const { data } = await this.request<ResourceSingle<{ state?: string }>>("POST", "/reviewSubmissions", {
      data: {
        type: "reviewSubmissions",
        attributes: { platform },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    });
    return { id: data.id, state: data.attributes.state ?? "" };
  }

  /** Add a version to a review submission as an item (required before the submission can be submitted). */
  async addReviewSubmissionItem(submissionId: string, versionId: string): Promise<void> {
    await this.request<unknown>("POST", "/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: { data: { type: "reviewSubmissions", id: submissionId } },
          appStoreVersion: { data: { type: "appStoreVersions", id: versionId } },
        },
      },
    });
  }

  /** Submit a review submission to Apple (the `submitted: true` PATCH). */
  async submitReviewSubmission(submissionId: string): Promise<void> {
    await this.request<unknown>("PATCH", `/reviewSubmissions/${submissionId}`, {
      data: { type: "reviewSubmissions", id: submissionId, attributes: { submitted: true } },
    });
  }

  /** Cancel a review submission — the hotfix-loop withdraw that frees the version to be edited again. */
  async cancelReviewSubmission(submissionId: string): Promise<void> {
    await this.request<unknown>("PATCH", `/reviewSubmissions/${submissionId}`, {
      data: { type: "reviewSubmissions", id: submissionId, attributes: { canceled: true } },
    });
  }

  /** Read one review submission's current state (for `launch status`). */
  async getReviewSubmission(submissionId: string): Promise<ReviewSubmissionResource> {
    const { data } = await this.request<ResourceSingle<{ state?: string }>>(
      "GET",
      `/reviewSubmissions/${submissionId}?fields[reviewSubmissions]=state`,
    );
    return { id: data.id, state: data.attributes.state ?? "" };
  }
}

/** Map a raw build row onto a {@link BuildResource}, defaulting the optional/absent attributes. */
function toBuildResource(entry: {
  id: string;
  attributes: { version?: string; processingState?: string; uploadedDate?: string; expired?: boolean };
}): BuildResource {
  return {
    id: entry.id,
    version: entry.attributes.version ?? "",
    processingState: entry.attributes.processingState ?? "",
    ...(entry.attributes.uploadedDate ? { uploadedDate: entry.attributes.uploadedDate } : {}),
    expired: entry.attributes.expired ?? false,
  };
}

/** Map a raw version row onto an {@link AppStoreVersionResource}, keeping a known versionString fallback. */
function toVersionResource(
  entry: { id: string; attributes: { versionString?: string; appStoreState?: string; releaseType?: string } },
  fallbackVersion = "",
): AppStoreVersionResource {
  return {
    id: entry.id,
    versionString: entry.attributes.versionString ?? fallbackVersion,
    appStoreState: entry.attributes.appStoreState ?? "",
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
    phasedReleaseState: entry.attributes.phasedReleaseState ?? "",
    ...(entry.attributes.currentDayNumber !== undefined ? { currentDayNumber: entry.attributes.currentDayNumber } : {}),
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
      return { id: point.id, customerPrice: price, territory: point.attributes.territory ?? territory };
    }
  }
  return null;
}

/** Project an ASC `customerReviewResponses` resource object into a {@link CustomerReviewResponseResource}. */
function toReviewResponse(data: {
  id: string;
  attributes: { responseBody?: string; state?: string; lastModifiedDate?: string };
}): CustomerReviewResponseResource {
  return {
    id: data.id,
    responseBody: data.attributes.responseBody ?? "",
    ...(data.attributes.state ? { state: data.attributes.state } : {}),
    ...(data.attributes.lastModifiedDate ? { lastModifiedDate: data.attributes.lastModifiedDate } : {}),
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

/** Extract Apple's human-readable error detail from a failed-response body, falling back to raw text. */
export function describeErrors(body: string): string {
  try {
    const parsed = JSON.parse(body) as { errors?: AscError[] };
    if (parsed.errors?.length) {
      return parsed.errors.map((e) => e.detail ?? e.title).join("; ");
    }
  } catch {
    /* not JSON — fall through */
  }
  return body.length > 0 ? body : "no response body";
}
