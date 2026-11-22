import {
  androidpublisher,
  auth as androidPublisherAuth,
  type androidpublisher_v3,
} from '@googleapis/androidpublisher';
import type { Readable } from 'node:stream';
import type { ServiceAccount } from '../types/credentials.js';
import type { MutableDeep } from '../types/mutable.js';

/** Deep-clone a Launch boundary value into a mutable plain object for Google's generated client. */
const mutableGoogleRequest = <GoogleRequest>(requestShape: unknown): GoogleRequest => {
  const clonedRequest: GoogleRequest = JSON.parse(JSON.stringify(requestShape));
  return clonedRequest;
};
import type {
  BasePlan,
  InAppProductResource,
  OfferPhaseRegionalConfig,
  PlayCountryAvailability,
  PlayListing,
  PlayMoney,
  PlayRelease,
  PlayReplyResult,
  PlayReview,
  RegionalBasePlanConfig,
  RegionalSubscriptionOfferConfig,
  SubscriptionListing,
  SubscriptionOfferPhase,
  SubscriptionOfferResource,
  SubscriptionResource,
} from '../types/googlePlay.js';
import type {
  ConvertedPrices,
  ConvertedRegionPrice,
  PlayMoneyUnits,
} from '../types/playPricing.js';

type PlayTrackInfo = Readonly<{ track: string; releases: readonly PlayRelease[] }>;

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
/**
 * Region snapshot the subscriptions monetization API pins prices against - a required query parameter on
 * every subscription/offer write. `2022/02` is Google's current published version; bump it here if Google
 * retires it (the API rejects an unsupported value with an actionable message).
 */
const REGIONS_VERSION = '2022/02';
/** A generated Android Publisher request failed. */
export type GooglePlayApiError = Readonly<{
  readonly _tag: 'GooglePlayApiError';
  readonly operation: string;
  readonly statusCode?: number;
  readonly message: string;
  readonly cause: unknown;
}>;
function makeGooglePlayApiError(fields: {
  readonly operation: string;
  readonly statusCode?: number;
  readonly message: string;
  readonly cause: unknown;
}): GooglePlayApiError {
  const isStatusMissing = fields.statusCode == null;

  if (isStatusMissing) {
    return {
      _tag: 'GooglePlayApiError',
      operation: fields.operation,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'GooglePlayApiError',
    operation: fields.operation,
    statusCode: fields.statusCode,
    message: fields.message,
    cause: fields.cause,
  };
}
/** Raised when a package has no Play app record or the service account cannot reach it. */
export type PlayAppNotFoundError = Readonly<{
  readonly _tag: 'PlayAppNotFoundError';
  readonly packageName: string;
  readonly message: string;
  readonly cause: unknown;
}>;
function makePlayAppNotFoundError(fields: {
  readonly packageName: string;
  readonly message: string;
  readonly cause: unknown;
}): PlayAppNotFoundError {
  return {
    _tag: 'PlayAppNotFoundError',
    packageName: fields.packageName,
    message: fields.message,
    cause: fields.cause,
  };
}
/** A service-account key could not be decoded into the fields Google auth requires. */
type ServiceAccountParseError = Readonly<{
  readonly _tag: 'ServiceAccountParseError';
  readonly message: string;
  readonly cause: unknown;
}>;
function makeServiceAccountParseError(fields: {
  readonly message: string;
  readonly cause: unknown;
}): ServiceAccountParseError {
  return {
    _tag: 'ServiceAccountParseError',
    message: fields.message,
    cause: fields.cause,
  };
}
/** Read the numeric status exposed by a generated-client failure, when present. */
const googleFailureStatus = (cause: unknown): number | undefined => {
  if (typeof cause !== 'object') return;
  if (cause === null) return;
  if (!('status' in cause)) return;
  if (typeof cause.status !== 'number') return;
  return cause.status;
};
/** Turn a generated-client failure into the actionable text Launch already exposes. */
const googleFailureMessage = (cause: unknown): string => {
  if (cause instanceof Error) return describePlayErrors(cause.message);
  return describePlayErrors(String(cause));
};
/** Lift Google's epoch-seconds timestamp to ISO-8601, or undefined when absent. */
const timestampToIso = (
  timestamp: androidpublisher_v3.Schema$Timestamp | undefined,
): string | undefined => {
  if (typeof timestamp?.seconds !== 'string') return;
  return new Date(Number(timestamp.seconds) * 1000).toISOString();
};
/** Flatten the generated review DTO into the {@link PlayReview} slice Launch consumes. */
const normalizeReview = (
  googleReview: androidpublisher_v3.Schema$Review,
): PlayReview | undefined => {
  if (typeof googleReview.reviewId !== 'string') return;
  const userComment = googleReview.comments?.find((comment) => comment.userComment)?.userComment;
  const developerComment = googleReview.comments?.find(
    (comment) => comment.developerComment,
  )?.developerComment;
  let rating = 0;
  if (typeof userComment?.starRating === 'number') rating = userComment.starRating;
  const review: MutableDeep<PlayReview> = {
    reviewId: googleReview.reviewId,
    rating,
    answered: developerComment !== undefined,
  };
  if (typeof googleReview.authorName === 'string') review.authorName = googleReview.authorName;
  if (typeof userComment?.text === 'string') review.text = userComment.text;
  if (typeof userComment?.reviewerLanguage === 'string') {
    review.reviewerLanguage = userComment.reviewerLanguage;
  }
  if (typeof userComment?.device === 'string') review.device = userComment.device;
  if (typeof userComment?.appVersionName === 'string') {
    review.appVersionName = userComment.appVersionName;
  }
  const lastModified = timestampToIso(userComment?.lastModified);
  if (lastModified !== undefined) review.lastModified = lastModified;
  if (typeof developerComment?.text === 'string') review.developerReply = developerComment.text;
  return review;
};
/** Normalize Google's nullable Money DTO to Launch's consumed money fields. */
const normalizeMoney = (money: androidpublisher_v3.Schema$Money | undefined): PlayMoneyUnits => {
  let currencyCode = '';
  let units = '0';
  let nanos = 0;
  if (typeof money?.currencyCode === 'string') currencyCode = money.currencyCode;
  if (typeof money?.units === 'string') units = money.units;
  if (typeof money?.nanos === 'number') nanos = money.nanos;
  return {
    currencyCode,
    units,
    nanos,
  };
};
/** Normalize one generated track release to the fields Launch reads and writes. */
const normalizeTrackRelease = (
  googleRelease: androidpublisher_v3.Schema$TrackRelease,
): PlayRelease => {
  const release: MutableDeep<PlayRelease> = {};
  if (typeof googleRelease.name === 'string') release.name = googleRelease.name;
  if (Array.isArray(googleRelease.versionCodes)) release.versionCodes = googleRelease.versionCodes;
  if (typeof googleRelease.status === 'string') release.status = googleRelease.status;
  if (typeof googleRelease.userFraction === 'number') {
    release.userFraction = googleRelease.userFraction;
  }
  if (Array.isArray(googleRelease.releaseNotes)) {
    const releaseNotes: {
      language: string;
      text: string;
    }[] = [];
    for (const googleNote of googleRelease.releaseNotes) {
      if (typeof googleNote.language !== 'string') continue;
      if (typeof googleNote.text !== 'string') continue;
      releaseNotes.push({ language: googleNote.language, text: googleNote.text });
    }
    release.releaseNotes = releaseNotes;
  }
  return release;
};
function isText(text: string | null | undefined): text is string {
  return text != null;
}

/** Retain a non-empty generated page token and collapse null/empty values to undefined. */
export const nonEmptyPageToken = (token: string | null | undefined): string | undefined => {
  if (typeof token !== 'string') return;
  if (token.length === 0) return;
  return token;
};
/**
 * Walk every page of a token-bearing generated list into one Launch-owned collection.
 * Callers supply the page load, item projection, and next-token extraction so product,
 * subscription, offer, and review lists share one pagination loop.
 */
async function collectGeneratedPages<Page, Collected>(
  loadPage: (pageToken: string | undefined) => Promise<Page>,
  collectedFromPage: (page: Page) => readonly Collected[],
  nextTokenFromPage: (page: Page) => string | null | undefined,
): Promise<Collected[]> {
  const collected: Collected[] = [];
  let pageToken: string | undefined;

  do {
    const page = await loadPage(pageToken);

    for (const pageEntry of collectedFromPage(page)) {
      collected.push(pageEntry);
    }

    pageToken = nonEmptyPageToken(nextTokenFromPage(page));
  } while (pageToken != null);

  return collected;
}
/** Project generated track releases into the {@link PlayRelease} slice Launch reads and writes. */
const releasesFromGoogleTrack = (
  googleReleases: androidpublisher_v3.Schema$TrackRelease[] | null | undefined,
): PlayRelease[] => {
  const releases: PlayRelease[] = [];
  if (!Array.isArray(googleReleases)) return releases;
  for (const googleRelease of googleReleases) {
    releases.push(normalizeTrackRelease(googleRelease));
  }
  return releases;
};
/** Project one generated store listing into the {@link PlayListing} slice Launch reads and writes. */
const listingFromGoogle = (
  googleListing: androidpublisher_v3.Schema$Listing,
): PlayListing | undefined => {
  if (typeof googleListing.language !== 'string') return undefined;
  const listing: MutableDeep<PlayListing> = { language: googleListing.language };
  if (typeof googleListing.title === 'string') listing.title = googleListing.title;
  if (typeof googleListing.shortDescription === 'string') {
    listing.shortDescription = googleListing.shortDescription;
  }
  if (typeof googleListing.fullDescription === 'string') {
    listing.fullDescription = googleListing.fullDescription;
  }
  if (typeof googleListing.video === 'string') listing.video = googleListing.video;
  return listing;
};
/** Keep only offer tags that carry a real tag string. */
const offerTagsFromGoogle = (
  googleTags: androidpublisher_v3.Schema$OfferTag[] | null | undefined,
):
  | {
      tag: string;
    }[]
  | undefined => {
  if (!Array.isArray(googleTags)) return;
  const offerTags: {
    tag: string;
  }[] = [];
  for (const googleTag of googleTags) {
    if (typeof googleTag.tag === 'string') offerTags.push({ tag: googleTag.tag });
  }
  return offerTags;
};
/** JWT options the official Google clients accept for one service-account key + OAuth scopes. */
export const serviceAccountJwtOptions = (
  account: ServiceAccount,
  scopes: readonly string[],
): {
  email: string;
  key: string;
  keyId?: string;
  scopes: string[];
} => {
  const authenticationOptions: {
    email: string;
    key: string;
    keyId?: string;
    scopes: string[];
  } = {
    email: account.clientEmail,
    key: account.privateKey,
    scopes: [...scopes],
  };
  if (account.privateKeyId !== undefined) authenticationOptions.keyId = account.privateKeyId;
  return authenticationOptions;
};
/** Normalize the legacy in-app-product money representation. */
const normalizeProductMoney = (
  googlePrice: androidpublisher_v3.Schema$Price | undefined,
): PlayMoney | undefined => {
  if (googlePrice === undefined) return;
  const price: MutableDeep<PlayMoney> = {};
  if (typeof googlePrice.priceMicros === 'string') price.priceMicros = googlePrice.priceMicros;
  if (typeof googlePrice.currency === 'string') price.currency = googlePrice.currency;
  return price;
};
/** Normalize one generated in-app product to Launch's reconciler slice. */
const normalizeInAppProduct = (
  googleProduct: androidpublisher_v3.Schema$InAppProduct,
): InAppProductResource | undefined => {
  if (typeof googleProduct.sku !== 'string') return;
  const product: MutableDeep<InAppProductResource> = { sku: googleProduct.sku };
  if (typeof googleProduct.status === 'string') product.status = googleProduct.status;
  if (typeof googleProduct.purchaseType === 'string') {
    product.purchaseType = googleProduct.purchaseType;
  }
  if (typeof googleProduct.defaultLanguage === 'string') {
    product.defaultLanguage = googleProduct.defaultLanguage;
  }
  const defaultPrice = normalizeProductMoney(googleProduct.defaultPrice);
  if (defaultPrice !== undefined) product.defaultPrice = defaultPrice;
  if (googleProduct.prices !== null && googleProduct.prices !== undefined) {
    const prices: Record<string, PlayMoney> = {};
    for (const [regionCode, googlePrice] of Object.entries(googleProduct.prices)) {
      const price = normalizeProductMoney(googlePrice);
      if (price !== undefined) prices[regionCode] = price;
    }
    product.prices = prices;
  }
  if (googleProduct.listings !== null && googleProduct.listings !== undefined) {
    const listings: Record<
      string,
      {
        title?: string;
        description?: string;
      }
    > = {};
    for (const [locale, googleListing] of Object.entries(googleProduct.listings)) {
      const listing: {
        title?: string;
        description?: string;
      } = {};
      if (typeof googleListing.title === 'string') listing.title = googleListing.title;
      if (typeof googleListing.description === 'string') {
        listing.description = googleListing.description;
      }
      listings[locale] = listing;
    }
    product.listings = listings;
  }
  return product;
};
/** Normalize one generated subscription base plan to the fields Launch reconciles. */
const normalizeBasePlan = (
  googlePlan: androidpublisher_v3.Schema$BasePlan,
): MutableDeep<BasePlan> | undefined => {
  if (typeof googlePlan.basePlanId !== 'string') return;
  const basePlan: MutableDeep<BasePlan> = { basePlanId: googlePlan.basePlanId };
  if (typeof googlePlan.state === 'string') basePlan.state = googlePlan.state;
  const billingPeriod = googlePlan.autoRenewingBasePlanType?.billingPeriodDuration;
  if (typeof billingPeriod === 'string') {
    basePlan.autoRenewingBasePlanType = { billingPeriodDuration: billingPeriod };
  }
  if (Array.isArray(googlePlan.regionalConfigs)) {
    const regionalConfigs: MutableDeep<RegionalBasePlanConfig>[] = [];
    for (const googleRegion of googlePlan.regionalConfigs) {
      if (typeof googleRegion.regionCode !== 'string') continue;
      const regionalConfig: MutableDeep<RegionalBasePlanConfig> = {
        regionCode: googleRegion.regionCode,
      };
      if (typeof googleRegion.newSubscriberAvailability === 'boolean') {
        regionalConfig.newSubscriberAvailability = googleRegion.newSubscriberAvailability;
      }
      if (googleRegion.price !== undefined)
        regionalConfig.price = normalizeMoney(googleRegion.price);
      regionalConfigs.push(regionalConfig);
    }
    basePlan.regionalConfigs = regionalConfigs;
  }
  const offerTags = offerTagsFromGoogle(googlePlan.offerTags);
  if (offerTags !== undefined) basePlan.offerTags = offerTags;
  return basePlan;
};
/** Normalize one generated subscription to Launch's consumed catalog shape. */
const normalizeSubscription = (
  googleSubscription: androidpublisher_v3.Schema$Subscription,
): SubscriptionResource | undefined => {
  if (typeof googleSubscription.productId !== 'string') return;
  const subscription: MutableDeep<SubscriptionResource> = {
    productId: googleSubscription.productId,
  };
  if (typeof googleSubscription.packageName === 'string') {
    subscription.packageName = googleSubscription.packageName;
  }
  if (Array.isArray(googleSubscription.basePlans)) {
    const basePlans: MutableDeep<BasePlan>[] = [];
    for (const googlePlan of googleSubscription.basePlans) {
      const basePlan = normalizeBasePlan(googlePlan);
      if (basePlan !== undefined) basePlans.push(basePlan);
    }
    subscription.basePlans = basePlans;
  }
  if (Array.isArray(googleSubscription.listings)) {
    const listings: MutableDeep<SubscriptionListing>[] = [];
    for (const googleListing of googleSubscription.listings) {
      if (typeof googleListing.languageCode !== 'string') continue;
      if (typeof googleListing.title !== 'string') continue;
      if (typeof googleListing.description !== 'string') continue;
      const listing: MutableDeep<SubscriptionListing> = {
        languageCode: googleListing.languageCode,
        title: googleListing.title,
        description: googleListing.description,
      };
      if (Array.isArray(googleListing.benefits)) listing.benefits = googleListing.benefits;
      listings.push(listing);
    }
    subscription.listings = listings;
  }
  return subscription;
};
/** Normalize one generated subscription offer to Launch's consumed catalog shape. */
const normalizeSubscriptionOffer = (
  googleOffer: androidpublisher_v3.Schema$SubscriptionOffer,
): SubscriptionOfferResource | undefined => {
  if (typeof googleOffer.offerId !== 'string') return;
  const offer: MutableDeep<SubscriptionOfferResource> = {
    offerId: googleOffer.offerId,
    phases: [],
    regionalConfigs: [],
  };
  if (typeof googleOffer.packageName === 'string') offer.packageName = googleOffer.packageName;
  if (typeof googleOffer.productId === 'string') offer.productId = googleOffer.productId;
  if (typeof googleOffer.basePlanId === 'string') offer.basePlanId = googleOffer.basePlanId;
  if (typeof googleOffer.state === 'string') offer.state = googleOffer.state;
  if (Array.isArray(googleOffer.regionalConfigs)) {
    for (const googleRegion of googleOffer.regionalConfigs) {
      if (typeof googleRegion.regionCode !== 'string') continue;
      const regionalConfig: MutableDeep<RegionalSubscriptionOfferConfig> = {
        regionCode: googleRegion.regionCode,
      };
      if (typeof googleRegion.newSubscriberAvailability === 'boolean') {
        regionalConfig.newSubscriberAvailability = googleRegion.newSubscriberAvailability;
      }
      offer.regionalConfigs.push(regionalConfig);
    }
  }
  if (Array.isArray(googleOffer.phases)) {
    for (const googlePhase of googleOffer.phases) {
      if (typeof googlePhase.recurrenceCount !== 'number') continue;
      const phase: MutableDeep<SubscriptionOfferPhase> = {
        recurrenceCount: googlePhase.recurrenceCount,
        regionalConfigs: [],
      };
      if (typeof googlePhase.duration === 'string') phase.duration = googlePhase.duration;
      if (Array.isArray(googlePhase.regionalConfigs)) {
        for (const googleRegion of googlePhase.regionalConfigs) {
          if (typeof googleRegion.regionCode !== 'string') continue;
          const regionalConfig: MutableDeep<OfferPhaseRegionalConfig> = {
            regionCode: googleRegion.regionCode,
          };
          if (googleRegion.price !== undefined)
            regionalConfig.price = normalizeMoney(googleRegion.price);
          if (googleRegion.free !== undefined) regionalConfig.free = {};
          phase.regionalConfigs.push(regionalConfig);
        }
      }
      offer.phases.push(phase);
    }
  }
  const offerTags = offerTagsFromGoogle(googleOffer.offerTags);
  if (offerTags !== undefined) offer.offerTags = offerTags;
  return offer;
};
const SERVICE_ACCOUNT_JSON_MESSAGE =
  'Service-account key is not valid JSON. Pass the JSON file Google Cloud issued.';
const SERVICE_ACCOUNT_FIELDS_MESSAGE =
  'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key (not an OAuth client or an API key).';

function isServiceAccountRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
}

function readServiceAccountField(record: Record<string, unknown>, key: string): string | null {
  const field = record[key];

  if (typeof field != 'string') {
    return null;
  }

  if (field.length == 0) {
    return null;
  }

  return field;
}

function isGooglePlayApiError(cause: unknown): cause is GooglePlayApiError {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'GooglePlayApiError';
}

function isServiceAccountParseError(cause: unknown): cause is ServiceAccountParseError {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'ServiceAccountParseError';
}

export function readServiceAccount(serviceAccountJson: string): ServiceAccount {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serviceAccountJson);
  } catch (cause) {
    throw makeServiceAccountParseError({
      message: SERVICE_ACCOUNT_JSON_MESSAGE,
      cause,
    });
  }

  if (isServiceAccountRecord(parsed) == false) {
    throw makeServiceAccountParseError({
      message: SERVICE_ACCOUNT_FIELDS_MESSAGE,
      cause: parsed,
    });
  }

  const clientEmail = readServiceAccountField(parsed, 'client_email');

  if (clientEmail == null) {
    throw makeServiceAccountParseError({
      message: SERVICE_ACCOUNT_FIELDS_MESSAGE,
      cause: parsed,
    });
  }

  const privateKey = readServiceAccountField(parsed, 'private_key');

  if (privateKey == null) {
    throw makeServiceAccountParseError({
      message: SERVICE_ACCOUNT_FIELDS_MESSAGE,
      cause: parsed,
    });
  }

  let tokenUri = 'https://oauth2.googleapis.com/token';
  const customTokenUri = readServiceAccountField(parsed, 'token_uri');

  if (customTokenUri != null) {
    tokenUri = customTokenUri;
  }

  const serviceAccount: MutableDeep<ServiceAccount> = {
    clientEmail,
    privateKey,
    tokenUri,
  };
  const privateKeyId = readServiceAccountField(parsed, 'private_key_id');

  if (privateKeyId != null) {
    serviceAccount.privateKeyId = privateKeyId;
  }

  return serviceAccount;
}

/** Decode a Google Cloud service-account key once at the transport boundary. */
export function parseServiceAccount(serviceAccountJson: string): ServiceAccount {
  try {
    return readServiceAccount(serviceAccountJson);
  } catch (cause) {
    const isParseError = isServiceAccountParseError(cause);

    if (isParseError) {
      throw cause;
    }

    throw makeServiceAccountParseError({
      message: SERVICE_ACCOUNT_JSON_MESSAGE,
      cause,
    });
  }
}

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

/** Generated Android Publisher methods used by Launch's adapter. */
export type GooglePlayTransport = Readonly<{
  edits: Pick<AndroidPublisher['edits'], 'insert' | 'commit' | 'delete'> &
    Readonly<{
      bundles: Pick<AndroidPublisher['edits']['bundles'], 'list' | 'upload'>;
      tracks: Pick<AndroidPublisher['edits']['tracks'], 'get' | 'list' | 'update'>;
      testers: Pick<AndroidPublisher['edits']['testers'], 'get' | 'update'>;
      countryavailability: Pick<AndroidPublisher['edits']['countryavailability'], 'get'>;
      listings: Pick<AndroidPublisher['edits']['listings'], 'list' | 'patch'>;
    }>;
  inappproducts: Pick<AndroidPublisher['inappproducts'], 'list' | 'insert' | 'update'>;
  monetization: Pick<AndroidPublisher['monetization'], 'convertRegionPrices'> &
    Readonly<{
      subscriptions: Pick<
        AndroidPublisher['monetization']['subscriptions'],
        'list' | 'create' | 'patch'
      > &
        Readonly<{
          basePlans: Pick<
            AndroidPublisher['monetization']['subscriptions']['basePlans'],
            'activate'
          > &
            Readonly<{
              offers: Pick<
                AndroidPublisher['monetization']['subscriptions']['basePlans']['offers'],
                'list' | 'create' | 'activate'
              >;
            }>;
        }>;
    }>;
  reviews: Pick<AndroidPublisher['reviews'], 'list' | 'get' | 'reply'>;
}>;
/** Client bound to one Play service account. */
export class GooglePlayClient {
  /** Non-secret identity shown in actionable Play Console permission diagnostics. */
  readonly serviceAccountEmail: string;
  /** Official generated Android Publisher v3 transport. */
  private readonly publisher: GooglePlayTransport;
  /**
   * Bind the adapter to one service account.
   *
   * @param account - Validated Google service-account credentials.
   * @param generatedPublisher - Optional generated transport supplied by adapter tests.
   */
  constructor(account: ServiceAccount, generatedPublisher?: GooglePlayTransport) {
    this.serviceAccountEmail = account.clientEmail;
    if (generatedPublisher !== undefined) {
      this.publisher = generatedPublisher;
      return;
    }
    const googleAuthentication = new androidPublisherAuth.JWT(
      serviceAccountJwtOptions(account, [OAUTH_SCOPE]),
    );
    this.publisher = androidpublisher({ version: 'v3', auth: googleAuthentication });
  }
  /** Run one generated Android Publisher request and tag a failure. */
  private async executeGeneratedRequest<GoogleShape>(
    operation: string,
    invoke: () => PromiseLike<{
      data: GoogleShape;
    }>,
  ): Promise<GoogleShape> {
    try {
      const completedRequest = await invoke();
      return completedRequest.data;
    } catch (cause) {
      const statusCode = googleFailureStatus(cause);
      const message = `Google Play ${operation} failed: ${googleFailureMessage(cause)}`;
      const isStatusMissing = statusCode == null;

      if (isStatusMissing) {
        throw makeGooglePlayApiError({ operation, message, cause });
      }

      throw makeGooglePlayApiError({ operation, statusCode, message, cause });
    }
  }
  /** Open a transactional edit (no changes committed); returns its id. A 404 means the app doesn't exist. */
  private async createEdit(packageName: string): Promise<string> {
    const editCreation = await this.executeGeneratedRequest('create edit', () =>
      this.publisher.edits.insert({ packageName }),
    );
    if (isText(editCreation.id)) {
      return editCreation.id;
    }

    throw makeGooglePlayApiError({
      operation: 'create edit',
      message: 'Google Play create edit failed: the generated client returned no edit id.',
      cause: editCreation,
    });
  }
  /** Commit an edit, applying every change made inside it atomically. */
  private async commitEdit(packageName: string, editId: string): Promise<void> {
    await this.executeGeneratedRequest('commit edit', () =>
      this.publisher.edits.commit({ packageName, editId }),
    );
  }
  /** Abandon an edit so no transaction is left dangling (best-effort; callers ignore failures). */
  private async deleteEdit(packageName: string, editId: string): Promise<void> {
    await this.executeGeneratedRequest('delete edit', () =>
      this.publisher.edits.delete({ packageName, editId }),
    );
  }
  /** Drop a failed abandon so it cannot hide the read or write that already finished. */
  private async abandonEdit(packageName: string, editId: string): Promise<void> {
    try {
      await this.deleteEdit(packageName, editId);
    } catch (abandonError) {
      void abandonError;
    }
  }
  /** Open a throwaway edit for a read, run `read`, then always abandon it (reads never commit). */
  private async withReadEdit<ReadResult>(
    packageName: string,
    read: (editId: string) => Promise<ReadResult>,
  ): Promise<ReadResult> {
    const editId = await this.createEdit(packageName);

    try {
      return await read(editId);
    } finally {
      await this.abandonEdit(packageName, editId);
    }
  }
  /**
   * Run edit-scoped **writes** transactionally: open an edit, apply changes via `apply`, then COMMIT so
   * they land atomically. On any error the edit is abandoned (rolled back) so a partial change never
   * lands. This is the write twin of {@link withReadEdit} and the foundation the edit-based Play
   * reconcilers (tracks, testers, country availability, listings) build on. Returns whatever `apply`
   * returns. The Play API requires every track/listing change to live inside such an edit.
   */
  async withEdit<Applied>(
    packageName: string,
    apply: (editId: string) => Promise<Applied>,
  ): Promise<Applied> {
    const editId = await this.createEdit(packageName);

    try {
      const applied = await apply(editId);
      await this.commitEdit(packageName, editId);
      return applied;
    } catch (applyError) {
      await this.abandonEdit(packageName, editId);
      throw applyError;
    }
  }
  /**
   * Return the highest `versionCode` already uploaded for an app, or 0 if none exist yet. The caller
   * bumps this for the next upload (parallels {@link AppStoreConnectClient.getLatestBuildNumber}).
   */
  async getLatestVersionCode(packageName: string): Promise<number> {
    const readLatestVersionCode = async (editId: string): Promise<number> => {
      const bundlePage = await this.executeGeneratedRequest('list bundles', () =>
        this.publisher.edits.bundles.list({ packageName, editId }),
      );
      const codes: number[] = [];
      const bundles = bundlePage.bundles;

      if (Array.isArray(bundles)) {
        for (const bundle of bundles) {
          const versionCode = bundle.versionCode;
          const isVersionCode = typeof versionCode == 'number';

          if (isVersionCode) {
            codes.push(versionCode);
          }
        }
      }

      const hasNoCodes = codes.length == 0;

      if (hasNoCodes) {
        return 0;
      }

      return Math.max(...codes);
    };

    return this.withReadEdit(packageName, readLatestVersionCode);
  }
  /** Read the releases currently on a track (for status reporting); empty array when the track is unused. */
  async getTrackReleases(packageName: string, track: string): Promise<PlayRelease[]> {
    const readTrackReleases = async (editId: string): Promise<PlayRelease[]> => {
      const trackSnapshot = await this.executeGeneratedRequest('get track', () =>
        this.publisher.edits.tracks.get({ packageName, editId, track }),
      );
      return releasesFromGoogleTrack(trackSnapshot.releases);
    };

    return this.withReadEdit(packageName, readTrackReleases);
  }
  /** Read every track and its releases (for `launch play-tracks status`). */
  async listTracks(packageName: string): Promise<PlayTrackInfo[]> {
    const readTracks = async (editId: string): Promise<PlayTrackInfo[]> => {
      const trackCatalog = await this.executeGeneratedRequest('list tracks', () =>
        this.publisher.edits.tracks.list({ packageName, editId }),
      );
      const tracks: PlayTrackInfo[] = [];
      const googleTracks = trackCatalog.tracks;

      if (Array.isArray(googleTracks)) {
        for (const googleTrack of googleTracks) {
          const trackName = googleTrack.track;
          const hasTrackName = typeof trackName == 'string';

          if (hasTrackName) {
            tracks.push({
              track: trackName,
              releases: releasesFromGoogleTrack(googleTrack.releases),
            });
          }
        }
      }

      return tracks;
    };

    return this.withReadEdit(packageName, readTracks);
  }
  /**
   * Replace a track's releases in one committed edit - the promote/rollout/halt write. Play supersedes
   * any prior release on the track, so a single new release is the standard request. Transactional via
   * {@link withEdit}: a failure abandons the edit, leaving the live track untouched.
   */
  async setTrackReleases(
    packageName: string,
    track: string,
    releases: readonly PlayRelease[],
  ): Promise<void> {
    const writeTrackReleases = async (editId: string): Promise<void> => {
      await this.executeGeneratedRequest('update track', () =>
        this.publisher.edits.tracks.update({
          packageName,
          editId,
          track,
          requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Track>({ track, releases }),
        }),
      );
    };

    await this.withEdit(packageName, writeTrackReleases);
  }
  /**
   * Upload an AAB and release it on a track in one committed edit. The release names the versionCode
   * Play assigned the upload, and a failure abandons both, so a bundle never lands without its release.
   */
  async uploadBundleToTrack(
    packageName: string,
    bundleStream: Readable,
    track: string,
    release: Omit<PlayRelease, 'versionCodes'>,
  ): Promise<number> {
    const uploadAndRelease = async (editId: string): Promise<number> => {
      const uploadedBundle = await this.executeGeneratedRequest('upload bundle', () =>
        this.publisher.edits.bundles.upload({
          packageName,
          editId,
          media: { mimeType: 'application/octet-stream', body: bundleStream },
        }),
      );
      const versionCode = uploadedBundle.versionCode;
      const hasVersionCode = typeof versionCode == 'number';

      if (hasVersionCode) {
        const trackRelease: PlayRelease = { ...release, versionCodes: [String(versionCode)] };
        await this.executeGeneratedRequest('update track', () =>
          this.publisher.edits.tracks.update({
            packageName,
            editId,
            track,
            requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Track>({
              track,
              releases: [trackRelease],
            }),
          }),
        );
        return versionCode;
      }

      throw makeGooglePlayApiError({
        operation: 'upload bundle',
        message: 'Google Play upload bundle failed: the generated client returned no versionCode.',
        cause: uploadedBundle,
      });
    };

    return this.withEdit(packageName, uploadAndRelease);
  }
  /** Read the Google Groups configured as testers for a track (closed/internal testing). */
  async getTesters(packageName: string, track: string): Promise<string[]> {
    const readTesters = async (editId: string): Promise<string[]> => {
      const testerGroupSet = await this.executeGeneratedRequest('get testers', () =>
        this.publisher.edits.testers.get({ packageName, editId, track }),
      );
      const googleGroups = testerGroupSet.googleGroups;

      if (Array.isArray(googleGroups)) {
        return googleGroups;
      }

      return [];
    };

    return this.withReadEdit(packageName, readTesters);
  }
  /** Set the Google Groups allowed to test a track, in one committed edit. */
  async setTesters(
    packageName: string,
    track: string,
    googleGroups: readonly string[],
  ): Promise<void> {
    const writeTesters = async (editId: string): Promise<void> => {
      await this.executeGeneratedRequest('update testers', () =>
        this.publisher.edits.testers.update({
          packageName,
          editId,
          track,
          requestBody: { googleGroups: [...googleGroups] },
        }),
      );
    };

    await this.withEdit(packageName, writeTesters);
  }
  /** Read every localized store listing (title, short and full description, video) of an app. */
  async listListings(packageName: string): Promise<PlayListing[]> {
    const readListings = async (editId: string): Promise<PlayListing[]> => {
      const listingCatalog = await this.executeGeneratedRequest('list listings', () =>
        this.publisher.edits.listings.list({ packageName, editId }),
      );
      const listings: PlayListing[] = [];
      const googleListings = listingCatalog.listings;

      if (Array.isArray(googleListings)) {
        for (const googleListing of googleListings) {
          const listing = listingFromGoogle(googleListing);

          if (listing != null) {
            listings.push(listing);
          }
        }
      }

      return listings;
    };

    return this.withReadEdit(packageName, readListings);
  }
  /**
   * Patch the given localized store listings inside ONE committed edit, so every language lands together or
   * none does. Patch keeps fields the listing does not mention (for example the video) untouched.
   */
  async updateListings(packageName: string, listings: readonly PlayListing[]): Promise<void> {
    const writeListings = async (editId: string): Promise<void> => {
      for (const listing of listings) {
        await this.executeGeneratedRequest('update listing', () =>
          this.publisher.edits.listings.patch({
            packageName,
            editId,
            language: listing.language,
            requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Listing>(listing),
          }),
        );
      }
    };

    await this.withEdit(packageName, writeListings);
  }
  /** Read a track's country availability. Read-only - Play exposes no API to change it. */
  async getCountryAvailability(
    packageName: string,
    track: string,
  ): Promise<PlayCountryAvailability> {
    const readCountryAvailability = async (editId: string): Promise<PlayCountryAvailability> => {
      const countryAvailability = await this.executeGeneratedRequest(
        'get country availability',
        () => this.publisher.edits.countryavailability.get({ packageName, editId, track }),
      );
      const countries: { countryCode: string }[] = [];
      const googleCountries = countryAvailability.countries;

      if (Array.isArray(googleCountries)) {
        for (const googleCountry of googleCountries) {
          const countryCode = googleCountry.countryCode;
          const hasCountryCode = typeof countryCode == 'string';

          if (hasCountryCode) {
            countries.push({ countryCode });
          }
        }
      }

      const availability: MutableDeep<PlayCountryAvailability> = { countries };
      const restOfWorld = countryAvailability.restOfWorld;
      const hasRestOfWorld = typeof restOfWorld == 'boolean';

      if (hasRestOfWorld) {
        availability.restOfWorld = restOfWorld;
      }

      return availability;
    };

    return this.withReadEdit(packageName, readCountryAvailability);
  }
  /**
   * Confirm the service account can reach the app's Play record, failing with {@link PlayAppNotFoundError}
   * when it can't - the detect-and-deep-link probe for `launch doctor` (Play can't create the app).
   */
  async assertAppExists(packageName: string): Promise<void> {
    let editId: string;

    try {
      editId = await this.createEdit(packageName);
    } catch (cause) {
      const isPlayFailure = isGooglePlayApiError(cause);

      if (isPlayFailure == false) {
        throw cause;
      }

      throw makePlayAppNotFoundError({
        packageName,
        message:
          `No reachable Play app for ${packageName} - ${cause.message}. Create it once in Play Console ` +
          `(the API can't), and grant the service account access under Users & Permissions.`,
        cause,
      });
    }

    await this.abandonEdit(packageName, editId);
  }
  /**
   * List the app's in-app **managed products** (`inappproducts`). Not edit-scoped - the products API is a
   * direct CRUD surface (unlike tracks/listings). Pages through Google's token pagination in full.
   */
  async listInAppProducts(packageName: string): Promise<InAppProductResource[]> {
    const loadProductPage = (pageToken: string | undefined) => {
      const listParameters: androidpublisher_v3.Params$Resource$Inappproducts$List = {
        packageName,
      };
      if (isText(pageToken)) {
        listParameters.token = pageToken;
      }

      return this.executeGeneratedRequest('list in-app products', () =>
        this.publisher.inappproducts.list(listParameters),
      );
    };
    const productsFromPage = (
      productPage: Awaited<ReturnType<typeof loadProductPage>>,
    ): InAppProductResource[] => {
      const products: InAppProductResource[] = [];
      const googleProducts = productPage.inappproduct;

      if (Array.isArray(googleProducts)) {
        for (const googleProduct of googleProducts) {
          const product = normalizeInAppProduct(googleProduct);

          if (product != null) {
            products.push(product);
          }
        }
      }

      return products;
    };
    const nextTokenFromPage = (productPage: Awaited<ReturnType<typeof loadProductPage>>) =>
      productPage.tokenPagination?.nextPageToken;

    return collectGeneratedPages(loadProductPage, productsFromPage, nextTokenFromPage);
  }
  /** Create a new in-app managed product (POST). The product carries its `sku`. */
  async insertInAppProduct(packageName: string, product: InAppProductResource): Promise<void> {
    await this.executeGeneratedRequest('insert in-app product', () =>
      this.publisher.inappproducts.insert({
        packageName,
        requestBody: { ...product, packageName },
      }),
    );
  }
  /** Update an existing in-app managed product by SKU (PUT). */
  async updateInAppProduct(packageName: string, product: InAppProductResource): Promise<void> {
    await this.executeGeneratedRequest('update in-app product', () =>
      this.publisher.inappproducts.update({
        packageName,
        sku: product.sku,
        requestBody: { ...product, packageName },
      }),
    );
  }
  /**
   * Convert a single base price into Google's **recommended local price for every Play market** via
   * `pricing:convertRegionPrices` (today's exchange rate + Google's per-country pricing patterns).
   * Advisory and read-only - it computes a recommendation and changes nothing live; callers apply the
   * numbers through the product/subscription write paths. Regions come back sorted by code; `otherRegions`
   * carries the USD/EUR fallback for markets without a local currency. `productTaxCategoryCode`, when
   * given, factors the matching tax rates into the conversion.
   */
  async convertRegionPrices(
    packageName: string,
    price: PlayMoneyUnits,
    productTaxCategoryCode?: string,
  ): Promise<ConvertedPrices> {
    const priceRequest: androidpublisher_v3.Schema$ConvertRegionPricesRequest = { price };
    if (isText(productTaxCategoryCode)) {
      priceRequest.productTaxCategoryCode = productTaxCategoryCode;
    }

    const priceConversion = await this.executeGeneratedRequest('convert region prices', () =>
      this.publisher.monetization.convertRegionPrices({
        packageName,
        requestBody: priceRequest,
      }),
    );
    const regions: ConvertedRegionPrice[] = [];
    const regionPrices = priceConversion.convertedRegionPrices;

    if (regionPrices != null) {
      for (const googlePrice of Object.values(regionPrices)) {
        const regionCode = googlePrice.regionCode;
        const hasRegionCode = typeof regionCode == 'string';

        if (hasRegionCode) {
          regions.push({
            regionCode,
            price: normalizeMoney(googlePrice.price),
          });
        }
      }
    }

    regions.sort((leftPrice, rightPrice) =>
      leftPrice.regionCode.localeCompare(rightPrice.regionCode),
    );
    const convertedPrices: MutableDeep<ConvertedPrices> = { regions };
    const fallbackPrice = priceConversion.convertedOtherRegionsPrice;

    if (fallbackPrice != null) {
      convertedPrices.otherRegions = {
        usdPrice: normalizeMoney(fallbackPrice.usdPrice),
        eurPrice: normalizeMoney(fallbackPrice.eurPrice),
      };
    }

    return convertedPrices;
  }
  /** List the app's subscription products (`monetization.subscriptions`), paging in full. */
  async listSubscriptions(packageName: string): Promise<SubscriptionResource[]> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$List =
          {
            packageName,
          };
        if (isText(pageToken)) {
          listParameters.pageToken = pageToken;
        }

        return this.executeGeneratedRequest('list subscriptions', () =>
          this.publisher.monetization.subscriptions.list(listParameters),
        );
      },
      (subscriptionPage) => {
        const subscriptions: SubscriptionResource[] = [];
        const googleSubscriptions = subscriptionPage.subscriptions;

        if (Array.isArray(googleSubscriptions)) {
          for (const googleSubscription of googleSubscriptions) {
            const subscription = normalizeSubscription(googleSubscription);

            if (subscription != null) {
              subscriptions.push(subscription);
            }
          }
        }

        return subscriptions;
      },
      (subscriptionPage) => subscriptionPage.nextPageToken,
    );
  }
  /**
   * Create a subscription with its base plans (which Play creates in DRAFT - activate them separately).
   * `regionsVersion.version` is required; the product id is sent in the query and request document.
   */
  async createSubscription(packageName: string, subscription: SubscriptionResource): Promise<void> {
    await this.executeGeneratedRequest('create subscription', () =>
      this.publisher.monetization.subscriptions.create({
        packageName,
        productId: subscription.productId,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Subscription>({
          ...subscription,
          packageName,
        }),
      }),
    );
  }
  /**
   * Patch a subscription's masked fields (PATCH with an `updateMask` - Play requires field-level updates).
   * The masked fields are replaced by `subscription`, so the reconciler sends a merged document
   * (e.g. existing listings + the changed ones) to stay additive.
   */
  async patchSubscription(
    packageName: string,
    subscription: SubscriptionResource,
    updateMask: string,
  ): Promise<void> {
    await this.executeGeneratedRequest('patch subscription', () =>
      this.publisher.monetization.subscriptions.patch({
        packageName,
        productId: subscription.productId,
        updateMask,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$Subscription>({
          ...subscription,
          packageName,
        }),
      }),
    );
  }
  /** Activate a base plan (DRAFT -> ACTIVE), making it purchasable. Idempotent on an already-active plan. */
  async activateBasePlan(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Promise<void> {
    await this.executeGeneratedRequest('activate base plan', () =>
      this.publisher.monetization.subscriptions.basePlans.activate({
        packageName,
        productId,
        basePlanId,
        requestBody: { packageName, productId, basePlanId },
      }),
    );
  }
  /** List the offers on one base plan, paging in full. */
  async listSubscriptionOffers(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Promise<SubscriptionOfferResource[]> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$List =
          { packageName, productId, basePlanId };
        if (isText(pageToken)) {
          listParameters.pageToken = pageToken;
        }

        return this.executeGeneratedRequest('list subscription offers', () =>
          this.publisher.monetization.subscriptions.basePlans.offers.list(listParameters),
        );
      },
      (offerPage) => {
        const offers: SubscriptionOfferResource[] = [];
        const googleOffers = offerPage.subscriptionOffers;

        if (Array.isArray(googleOffers)) {
          for (const googleOffer of googleOffers) {
            const offer = normalizeSubscriptionOffer(googleOffer);

            if (offer != null) {
              offers.push(offer);
            }
          }
        }

        return offers;
      },
      (offerPage) => offerPage.nextPageToken,
    );
  }
  /** Create a subscription offer (in DRAFT - activate it separately). `regionsVersion.version` is required. */
  async createSubscriptionOffer(
    packageName: string,
    offer: SubscriptionOfferResource,
  ): Promise<void> {
    let productId = '';
    let basePlanId = '';
    if (isText(offer.productId)) {
      productId = offer.productId;
    }

    if (isText(offer.basePlanId)) {
      basePlanId = offer.basePlanId;
    }

    await this.executeGeneratedRequest('create subscription offer', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.create({
        packageName,
        productId,
        basePlanId,
        offerId: offer.offerId,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: mutableGoogleRequest<androidpublisher_v3.Schema$SubscriptionOffer>({
          ...offer,
          packageName,
        }),
      }),
    );
  }
  /** Activate a subscription offer (DRAFT -> ACTIVE), making it available. */
  async activateSubscriptionOffer(
    packageName: string,
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Promise<void> {
    await this.executeGeneratedRequest('activate subscription offer', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.activate({
        packageName,
        productId,
        basePlanId,
        offerId,
        requestBody: { packageName, productId, basePlanId, offerId },
      }),
    );
  }
  /**
   * List the app's customer reviews (flattened to {@link PlayReview}), paging in full. `translationLanguage`
   * asks Play to machine-translate review text into that BCP-47 language. Only reviews with text from the
   * last ~week are returned - a Play platform limit, not Launch's.
   */
  async listReviews(
    packageName: string,
    options: Readonly<{
      translationLanguage?: string;
    }> = {},
  ): Promise<PlayReview[]> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Reviews$List = { packageName };
        if (isText(options.translationLanguage)) {
          listParameters.translationLanguage = options.translationLanguage;
        }

        if (isText(pageToken)) {
          listParameters.token = pageToken;
        }

        return this.executeGeneratedRequest('list reviews', () =>
          this.publisher.reviews.list(listParameters),
        );
      },
      (reviewPage) => {
        const reviews: PlayReview[] = [];
        const googleReviews = reviewPage.reviews;

        if (Array.isArray(googleReviews)) {
          for (const googleReview of googleReviews) {
            const review = normalizeReview(googleReview);

            if (review != null) {
              reviews.push(review);
            }
          }
        }

        return reviews;
      },
      (reviewPage) => reviewPage.tokenPagination?.nextPageToken,
    );
  }
  /** Fetch one review by id (flattened to {@link PlayReview}), or null when it doesn't exist / is too old. */
  async getReview(packageName: string, reviewId: string): Promise<PlayReview | null> {
    try {
      const googleReview = await this.executeGeneratedRequest('get review', () =>
        this.publisher.reviews.get({ packageName, reviewId }),
      );
      const review = normalizeReview(googleReview);
      const isReviewMissing = review == null;

      if (isReviewMissing) {
        return null;
      }

      return review;
    } catch (requestFailure) {
      const isPlayFailure = isGooglePlayApiError(requestFailure);

      if (isPlayFailure == false) {
        throw requestFailure;
      }

      const isMissingReview = requestFailure.statusCode == 404;

      if (isMissingReview) {
        return null;
      }

      throw requestFailure;
    }
  }
  /**
   * Post (or replace) the public developer reply to a review. Play's reply endpoint is an upsert - it
   * edits an existing reply in place - and only accepts reviews from the last ~week.
   */
  async replyToReview(
    packageName: string,
    reviewId: string,
    replyText: string,
  ): Promise<PlayReplyResult> {
    const replyConfirmation = await this.executeGeneratedRequest('reply to review', () =>
      this.publisher.reviews.reply({
        packageName,
        reviewId,
        requestBody: { replyText },
      }),
    );
    let storedReplyText = replyText;
    const confirmedReplyText = replyConfirmation.result?.replyText;
    if (isText(confirmedReplyText)) {
      storedReplyText = confirmedReplyText;
    }

    const reply: MutableDeep<PlayReplyResult> = { replyText: storedReplyText };
    const lastEdited = timestampToIso(replyConfirmation.result?.lastEdited);

    if (isText(lastEdited)) {
      reply.lastEdited = lastEdited;
    }

    return reply;
  }
}
interface GoogleErrorObject {
  message?: string;
  status?: string;
}

interface GoogleErrorDocument {
  error?: string | GoogleErrorObject;
  error_description?: string;
}

function isGoogleErrorRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function isNonEmptyText(text: unknown): text is string {
  if (typeof text != 'string') {
    return false;
  }

  return text.length > 0;
}

function readRawPlayError(googleErrorText: string): string {
  const hasErrorText = googleErrorText.length > 0;

  if (hasErrorText) {
    return googleErrorText;
  }

  return 'no response body';
}

function readDirectErrorText(googleError: GoogleErrorDocument['error']): string {
  if (typeof googleError == 'string') {
    return googleError;
  }

  if (googleError == null) {
    return '';
  }

  if (isNonEmptyText(googleError.message)) {
    return googleError.message;
  }

  if (typeof googleError.status == 'string') {
    return googleError.status;
  }

  return '';
}

function readGoogleErrorMessage(googleErrorDocument: GoogleErrorDocument): string {
  const directMessage = readDirectErrorText(googleErrorDocument.error);

  if (isNonEmptyText(directMessage)) {
    return directMessage;
  }

  if (isNonEmptyText(googleErrorDocument.error_description)) {
    return googleErrorDocument.error_description;
  }

  return '';
}

interface ReadStringOutcome {
  status: 'missing' | 'invalid' | 'present';
  text: string;
}

function readOptionalErrorString(record: Record<string, unknown>, key: string): ReadStringOutcome {
  const hasKey = Object.hasOwn(record, key);

  if (hasKey == false) {
    return { status: 'missing', text: '' };
  }

  const field = record[key];
  const isStringField = typeof field == 'string';

  if (isStringField == false) {
    return { status: 'invalid', text: '' };
  }

  return { status: 'present', text: field };
}

function parseGoogleErrorText(googleErrorText: string): unknown {
  try {
    return JSON.parse(googleErrorText);
  } catch (cause) {
    void cause;
    return null;
  }
}

function readGoogleErrorDocument(googleErrorText: string): GoogleErrorDocument | null {
  const parsed = parseGoogleErrorText(googleErrorText);
  const isRecord = isGoogleErrorRecord(parsed);

  if (isRecord == false) {
    return null;
  }

  const document: GoogleErrorDocument = {};
  const errorDescription = readOptionalErrorString(parsed, 'error_description');
  const isDescriptionInvalid = errorDescription.status == 'invalid';

  if (isDescriptionInvalid) {
    return null;
  }

  const isDescriptionPresent = errorDescription.status == 'present';

  if (isDescriptionPresent) {
    document.error_description = errorDescription.text;
  }

  const hasError = Object.hasOwn(parsed, 'error');

  if (hasError == false) {
    return document;
  }

  const errorField = parsed['error'];
  const isStringError = typeof errorField == 'string';

  if (isStringError) {
    document.error = errorField;
    return document;
  }

  const isObjectError = isGoogleErrorRecord(errorField);

  if (isObjectError == false) {
    return null;
  }

  const message = readOptionalErrorString(errorField, 'message');
  const isMessageInvalid = message.status == 'invalid';

  if (isMessageInvalid) {
    return null;
  }

  const status = readOptionalErrorString(errorField, 'status');
  const isStatusInvalid = status.status == 'invalid';

  if (isStatusInvalid) {
    return null;
  }

  const errorObject: GoogleErrorObject = {};
  const isMessagePresent = message.status == 'present';

  if (isMessagePresent) {
    errorObject.message = message.text;
  }

  const isStatusPresent = status.status == 'present';

  if (isStatusPresent) {
    errorObject.status = status.text;
  }

  document.error = errorObject;
  return document;
}

/**
 * Extract Google's human-readable error detail, falling back to the raw transport text.
 * Recognizes the sensitive/high-risk permission rejection and appends the fix, so the CLI doesn't just
 * echo a 403 - it tells you the release was blocked on a permission declaration.
 */
export function describePlayErrors(googleErrorText: string): string {
  const googleErrorDocument = readGoogleErrorDocument(googleErrorText);
  const isDocumentMissing = googleErrorDocument == null;

  if (isDocumentMissing) {
    return readRawPlayError(googleErrorText);
  }

  const message = readGoogleErrorMessage(googleErrorDocument);
  const isMessageEmpty = message.length == 0;

  if (isMessageEmpty) {
    return readRawPlayError(googleErrorText);
  }

  // Matches a sensitive or high-risk permission rejection, including a permissions declaration.
  const isSensitivePermission = /sensitive|high.?risk|permissions? declaration/i.test(message);

  if (isSensitivePermission) {
    return `${message} - a sensitive/high-risk permission likely needs pre-approval (a Permissions Declaration) in Play Console before this release is accepted.`;
  }

  return message;
}
