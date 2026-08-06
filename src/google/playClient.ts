import {
  androidpublisher,
  auth as androidPublisherAuth,
  type androidpublisher_v3,
} from '@googleapis/androidpublisher';
import { Data, Effect, Option, Schema } from 'effect';
import type { ServiceAccount } from '../core/types/credentials.js';
import type {
  BasePlan,
  InAppProductResource,
  OfferPhaseRegionalConfig,
  PlayCountryAvailability,
  PlayMoney,
  PlayRelease,
  PlayReplyResult,
  PlayReview,
  PlayTrackInfo,
  RegionalBasePlanConfig,
  RegionalSubscriptionOfferConfig,
  SubscriptionListing,
  SubscriptionOfferPhase,
  SubscriptionOfferResource,
  SubscriptionResource,
} from '../core/types/googlePlay.js';
import type {
  ConvertedPrices,
  ConvertedRegionPrice,
  PlayMoneyUnits,
} from '../core/types/playPricing.js';
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
export const makeGooglePlayApiError = Data.tagged<GooglePlayApiError>('GooglePlayApiError');
/** Raised when a package has no Play app record or the service account cannot reach it. */
export type PlayAppNotFoundError = Readonly<{
  readonly _tag: 'PlayAppNotFoundError';
  readonly packageName: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makePlayAppNotFoundError = Data.tagged<PlayAppNotFoundError>('PlayAppNotFoundError');
/** A service-account key could not be decoded into the fields Google auth requires. */
export type ServiceAccountParseError = Readonly<{
  readonly _tag: 'ServiceAccountParseError';
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeServiceAccountParseError = Data.tagged<ServiceAccountParseError>(
  'ServiceAccountParseError',
);
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
  const review: PlayReview = {
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
  const release: PlayRelease = {};
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
const collectGeneratedPages = <TPage, TCollected>(
  loadPage: (pageToken: string | undefined) => Effect.Effect<TPage, GooglePlayApiError>,
  collectedFromPage: (page: TPage) => readonly TCollected[],
  nextTokenFromPage: (page: TPage) => string | null | undefined,
): Effect.Effect<TCollected[], GooglePlayApiError> =>
  Effect.gen(function* () {
    const collected: TCollected[] = [];
    let pageToken: string | undefined;
    do {
      const page = yield* loadPage(pageToken);
      for (const pageEntry of collectedFromPage(page)) collected.push(pageEntry);
      pageToken = nonEmptyPageToken(nextTokenFromPage(page));
    } while (pageToken !== undefined);
    return collected;
  });
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
  const price: PlayMoney = {};
  if (typeof googlePrice.priceMicros === 'string') price.priceMicros = googlePrice.priceMicros;
  if (typeof googlePrice.currency === 'string') price.currency = googlePrice.currency;
  return price;
};
/** Normalize one generated in-app product to Launch's reconciler slice. */
const normalizeInAppProduct = (
  googleProduct: androidpublisher_v3.Schema$InAppProduct,
): InAppProductResource | undefined => {
  if (typeof googleProduct.sku !== 'string') return;
  const product: InAppProductResource = { sku: googleProduct.sku };
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
): BasePlan | undefined => {
  if (typeof googlePlan.basePlanId !== 'string') return;
  const basePlan: BasePlan = { basePlanId: googlePlan.basePlanId };
  if (typeof googlePlan.state === 'string') basePlan.state = googlePlan.state;
  const billingPeriod = googlePlan.autoRenewingBasePlanType?.billingPeriodDuration;
  if (typeof billingPeriod === 'string') {
    basePlan.autoRenewingBasePlanType = { billingPeriodDuration: billingPeriod };
  }
  if (Array.isArray(googlePlan.regionalConfigs)) {
    const regionalConfigs: RegionalBasePlanConfig[] = [];
    for (const googleRegion of googlePlan.regionalConfigs) {
      if (typeof googleRegion.regionCode !== 'string') continue;
      const regionalConfig: RegionalBasePlanConfig = { regionCode: googleRegion.regionCode };
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
  const subscription: SubscriptionResource = { productId: googleSubscription.productId };
  if (typeof googleSubscription.packageName === 'string') {
    subscription.packageName = googleSubscription.packageName;
  }
  if (Array.isArray(googleSubscription.basePlans)) {
    const basePlans: BasePlan[] = [];
    for (const googlePlan of googleSubscription.basePlans) {
      const basePlan = normalizeBasePlan(googlePlan);
      if (basePlan !== undefined) basePlans.push(basePlan);
    }
    subscription.basePlans = basePlans;
  }
  if (Array.isArray(googleSubscription.listings)) {
    const listings: SubscriptionListing[] = [];
    for (const googleListing of googleSubscription.listings) {
      if (typeof googleListing.languageCode !== 'string') continue;
      if (typeof googleListing.title !== 'string') continue;
      if (typeof googleListing.description !== 'string') continue;
      const listing: SubscriptionListing = {
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
  const offer: SubscriptionOfferResource = {
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
      const regionalConfig: RegionalSubscriptionOfferConfig = {
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
      const phase: SubscriptionOfferPhase = {
        recurrenceCount: googlePhase.recurrenceCount,
        regionalConfigs: [],
      };
      if (typeof googlePhase.duration === 'string') phase.duration = googlePhase.duration;
      if (Array.isArray(googlePhase.regionalConfigs)) {
        for (const googleRegion of googlePhase.regionalConfigs) {
          if (typeof googleRegion.regionCode !== 'string') continue;
          const regionalConfig: OfferPhaseRegionalConfig = { regionCode: googleRegion.regionCode };
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
const ServiceAccountKeySchema = Schema.Struct({
  client_email: Schema.String.pipe(Schema.minLength(1)),
  private_key: Schema.String.pipe(Schema.minLength(1)),
  private_key_id: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  token_uri: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

const GoogleErrorDocumentSchema = Schema.Struct({
  error: Schema.optional(
    Schema.Union(
      Schema.String,
      Schema.Struct({
        message: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
      }),
    ),
  ),
  error_description: Schema.optional(Schema.String),
});

/** Decode a Google Cloud service-account key once at the transport boundary. */
export const parseServiceAccount = (
  serviceAccountJson: string,
): Effect.Effect<ServiceAccount, ServiceAccountParseError> =>
  Schema.decodeUnknown(Schema.parseJson())(serviceAccountJson).pipe(
    Effect.mapError((cause) =>
      makeServiceAccountParseError({
        message: 'Service-account key is not valid JSON. Pass the JSON file Google Cloud issued.',
        cause,
      }),
    ),
    Effect.flatMap((decodedJson) =>
      Schema.decodeUnknown(ServiceAccountKeySchema)(decodedJson).pipe(
        Effect.mapError((cause) =>
          makeServiceAccountParseError({
            message:
              'Service-account key is missing `client_email`/`private_key`. Use a Google Cloud service-account JSON key (not an OAuth client or an API key).',
            cause,
          }),
        ),
      ),
    ),
    Effect.map((serviceAccountKey) => {
      let tokenUri = 'https://oauth2.googleapis.com/token';
      if (serviceAccountKey.token_uri !== undefined) tokenUri = serviceAccountKey.token_uri;
      const serviceAccount: ServiceAccount = {
        clientEmail: serviceAccountKey.client_email,
        privateKey: serviceAccountKey.private_key,
        tokenUri,
      };
      if (serviceAccountKey.private_key_id !== undefined) {
        serviceAccount.privateKeyId = serviceAccountKey.private_key_id;
      }
      return serviceAccount;
    }),
  );

type AndroidPublisher = androidpublisher_v3.Androidpublisher;

/** Generated Android Publisher methods used by Launch's adapter. */
export type GooglePlayTransport = Readonly<{
  edits: Pick<AndroidPublisher['edits'], 'insert' | 'commit' | 'delete'> &
    Readonly<{
      bundles: Pick<AndroidPublisher['edits']['bundles'], 'list'>;
      tracks: Pick<AndroidPublisher['edits']['tracks'], 'get' | 'list' | 'update'>;
      testers: Pick<AndroidPublisher['edits']['testers'], 'get' | 'update'>;
      countryavailability: Pick<AndroidPublisher['edits']['countryavailability'], 'get'>;
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
  /** Official generated Android Publisher v3 transport. */
  private readonly publisher: GooglePlayTransport;
  /**
   * Bind the adapter to one service account.
   *
   * @param account - Validated Google service-account credentials.
   * @param generatedPublisher - Optional generated transport supplied by adapter tests.
   */
  constructor(account: ServiceAccount, generatedPublisher?: GooglePlayTransport) {
    if (generatedPublisher !== undefined) {
      this.publisher = generatedPublisher;
      return;
    }
    const googleAuthentication = new androidPublisherAuth.JWT(
      serviceAccountJwtOptions(account, [OAUTH_SCOPE]),
    );
    this.publisher = androidpublisher({ version: 'v3', auth: googleAuthentication });
  }
  /** Convert the official generated client's Promise-shaped request into one Effect. */
  private executeGeneratedRequest<TGoogleShape>(
    operation: string,
    invoke: () => PromiseLike<{
      data: TGoogleShape;
    }>,
  ): Effect.Effect<TGoogleShape, GooglePlayApiError> {
    return Effect.tryPromise({
      try: invoke,
      catch: (cause) => {
        const statusCode = googleFailureStatus(cause);
        const message = `Google Play ${operation} failed: ${googleFailureMessage(cause)}`;
        if (statusCode === undefined) return makeGooglePlayApiError({ operation, message, cause });
        return makeGooglePlayApiError({ operation, statusCode, message, cause });
      },
    }).pipe(Effect.map((completedRequest) => completedRequest.data));
  }
  /** Open a transactional edit (no changes committed); returns its id. A 404 means the app doesn't exist. */
  private createEdit(packageName: string): Effect.Effect<string, GooglePlayApiError> {
    return this.executeGeneratedRequest('create edit', () =>
      this.publisher.edits.insert({ packageName }),
    ).pipe(
      Effect.flatMap((editCreation) => {
        if (typeof editCreation.id === 'string') return Effect.succeed(editCreation.id);
        return Effect.fail(
          makeGooglePlayApiError({
            operation: 'create edit',
            message: 'Google Play create edit failed: the generated client returned no edit id.',
            cause: editCreation,
          }),
        );
      }),
    );
  }
  /** Commit an edit, applying every change made inside it atomically. */
  private commitEdit(packageName: string, editId: string): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('commit edit', () =>
      this.publisher.edits.commit({ packageName, editId }),
    ).pipe(Effect.asVoid);
  }
  /** Abandon an edit so no transaction is left dangling (best-effort; callers ignore failures). */
  private deleteEdit(packageName: string, editId: string): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('delete edit', () =>
      this.publisher.edits.delete({ packageName, editId }),
    ).pipe(Effect.asVoid);
  }
  /** Open a throwaway edit for a read, run `read`, then always abandon it (reads never commit). */
  private withReadEdit<T, ReadFailure, ReadRequirements>(
    packageName: string,
    read: (editId: string) => Effect.Effect<T, ReadFailure, ReadRequirements>,
  ): Effect.Effect<T, GooglePlayApiError | ReadFailure, ReadRequirements> {
    return Effect.acquireUseRelease(this.createEdit(packageName), read, (editId) =>
      this.deleteEdit(packageName, editId).pipe(Effect.ignore),
    );
  }
  /**
   * Run edit-scoped **writes** transactionally: open an edit, apply changes via `apply`, then COMMIT so
   * they land atomically. On any error the edit is abandoned (rolled back) so a partial change never
   * lands. This is the write twin of {@link withReadEdit} and the foundation the edit-based Play
   * reconcilers (tracks, testers, country availability, listings) build on. Returns whatever `apply`
   * returns. The Play API requires every track/listing change to live inside such an edit.
   */
  withEdit<T, ApplyFailure, ApplyRequirements>(
    packageName: string,
    apply: (editId: string) => Effect.Effect<T, ApplyFailure, ApplyRequirements>,
  ): Effect.Effect<T, GooglePlayApiError | ApplyFailure, ApplyRequirements> {
    return this.createEdit(packageName).pipe(
      Effect.flatMap((editId) =>
        apply(editId).pipe(
          Effect.tap(() => this.commitEdit(packageName, editId)),
          Effect.onError(() => this.deleteEdit(packageName, editId).pipe(Effect.ignore)),
        ),
      ),
    );
  }
  /**
   * Return the highest `versionCode` already uploaded for an app, or 0 if none exist yet. The caller
   * bumps this for the next upload (parallels {@link AppStoreConnectClient.getLatestBuildNumber}).
   */
  getLatestVersionCode(packageName: string): Effect.Effect<number, GooglePlayApiError> {
    return this.withReadEdit(packageName, (editId) =>
      Effect.gen(this, function* () {
        const bundlePage = yield* this.executeGeneratedRequest('list bundles', () =>
          this.publisher.edits.bundles.list({ packageName, editId }),
        );
        const codes: number[] = [];
        if (Array.isArray(bundlePage.bundles)) {
          for (const bundle of bundlePage.bundles) {
            if (typeof bundle.versionCode === 'number') codes.push(bundle.versionCode);
          }
        }
        if (codes.length === 0) return 0;
        return Math.max(...codes);
      }),
    );
  }
  /** Read the releases currently on a track (for status reporting); empty array when the track is unused. */
  getTrackReleases(
    packageName: string,
    track: string,
  ): Effect.Effect<PlayRelease[], GooglePlayApiError> {
    return this.withReadEdit(packageName, (editId) =>
      this.executeGeneratedRequest('get track', () =>
        this.publisher.edits.tracks.get({ packageName, editId, track }),
      ).pipe(Effect.map((trackSnapshot) => releasesFromGoogleTrack(trackSnapshot.releases))),
    );
  }
  /** Read every track and its releases (for `launch play-tracks status`). */
  listTracks(packageName: string): Effect.Effect<PlayTrackInfo[], GooglePlayApiError> {
    return this.withReadEdit(packageName, (editId) =>
      this.executeGeneratedRequest('list tracks', () =>
        this.publisher.edits.tracks.list({ packageName, editId }),
      ).pipe(
        Effect.map((trackCatalog) => {
          const tracks: PlayTrackInfo[] = [];
          if (!Array.isArray(trackCatalog.tracks)) return tracks;
          for (const googleTrack of trackCatalog.tracks) {
            if (typeof googleTrack.track !== 'string') continue;
            tracks.push({
              track: googleTrack.track,
              releases: releasesFromGoogleTrack(googleTrack.releases),
            });
          }
          return tracks;
        }),
      ),
    );
  }
  /**
   * Replace a track's releases in one committed edit - the promote/rollout/halt write. Play supersedes
   * any prior release on the track, so a single new release is the standard request. Transactional via
   * {@link withEdit}: a failure abandons the edit, leaving the live track untouched.
   */
  setTrackReleases(
    packageName: string,
    track: string,
    releases: readonly PlayRelease[],
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.withEdit(packageName, (editId) =>
      this.executeGeneratedRequest('update track', () =>
        this.publisher.edits.tracks.update({
          packageName,
          editId,
          track,
          requestBody: { track, releases: [...releases] },
        }),
      ).pipe(Effect.asVoid),
    );
  }
  /** Read the Google Groups configured as testers for a track (closed/internal testing). */
  getTesters(packageName: string, track: string): Effect.Effect<string[], GooglePlayApiError> {
    return this.withReadEdit(packageName, (editId) =>
      this.executeGeneratedRequest('get testers', () =>
        this.publisher.edits.testers.get({ packageName, editId, track }),
      ).pipe(
        Effect.map((testerGroupSet) => {
          if (!Array.isArray(testerGroupSet.googleGroups)) return [];
          return testerGroupSet.googleGroups;
        }),
      ),
    );
  }
  /** Set the Google Groups allowed to test a track, in one committed edit. */
  setTesters(
    packageName: string,
    track: string,
    googleGroups: readonly string[],
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.withEdit(packageName, (editId) =>
      this.executeGeneratedRequest('update testers', () =>
        this.publisher.edits.testers.update({
          packageName,
          editId,
          track,
          requestBody: { googleGroups: [...googleGroups] },
        }),
      ).pipe(Effect.asVoid),
    );
  }
  /** Read a track's country availability. Read-only - Play exposes no API to change it. */
  getCountryAvailability(
    packageName: string,
    track: string,
  ): Effect.Effect<PlayCountryAvailability, GooglePlayApiError> {
    return this.withReadEdit(packageName, (editId) =>
      Effect.gen(this, function* () {
        const countryAvailability = yield* this.executeGeneratedRequest(
          'get country availability',
          () => this.publisher.edits.countryavailability.get({ packageName, editId, track }),
        );
        const countries: { countryCode: string }[] = [];
        if (Array.isArray(countryAvailability.countries)) {
          for (const googleCountry of countryAvailability.countries) {
            if (typeof googleCountry.countryCode !== 'string') continue;
            countries.push({ countryCode: googleCountry.countryCode });
          }
        }
        const availability: PlayCountryAvailability = { countries };
        if (typeof countryAvailability.restOfWorld === 'boolean') {
          availability.restOfWorld = countryAvailability.restOfWorld;
        }
        return availability;
      }),
    );
  }
  /**
   * Confirm the service account can reach the app's Play record, failing with {@link PlayAppNotFoundError}
   * when it can't - the detect-and-deep-link probe for `launch doctor` (Play can't create the app).
   */
  assertAppExists(
    packageName: string,
  ): Effect.Effect<void, PlayAppNotFoundError | GooglePlayApiError> {
    return this.createEdit(packageName).pipe(
      Effect.mapError((cause) =>
        makePlayAppNotFoundError({
          packageName,
          message:
            `No reachable Play app for ${packageName} - ${cause.message}. Create it once in Play Console ` +
            `(the API can't), and grant the service account access under Users & Permissions.`,
          cause,
        }),
      ),
      Effect.flatMap((editId) => this.deleteEdit(packageName, editId).pipe(Effect.ignore)),
    );
  }
  /**
   * List the app's in-app **managed products** (`inappproducts`). Not edit-scoped - the products API is a
   * direct CRUD surface (unlike tracks/listings). Pages through Google's token pagination in full.
   */
  listInAppProducts(
    packageName: string,
  ): Effect.Effect<InAppProductResource[], GooglePlayApiError> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Inappproducts$List = {
          packageName,
        };
        if (pageToken !== undefined) listParameters.token = pageToken;
        return this.executeGeneratedRequest('list in-app products', () =>
          this.publisher.inappproducts.list(listParameters),
        );
      },
      (productPage) => {
        const products: InAppProductResource[] = [];
        if (!Array.isArray(productPage.inappproduct)) return products;
        for (const googleProduct of productPage.inappproduct) {
          const product = normalizeInAppProduct(googleProduct);
          if (product !== undefined) products.push(product);
        }
        return products;
      },
      (productPage) => productPage.tokenPagination?.nextPageToken,
    );
  }
  /** Create a new in-app managed product (POST). The product carries its `sku`. */
  insertInAppProduct(
    packageName: string,
    product: InAppProductResource,
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('insert in-app product', () =>
      this.publisher.inappproducts.insert({
        packageName,
        requestBody: { ...product, packageName },
      }),
    ).pipe(Effect.asVoid);
  }
  /** Update an existing in-app managed product by SKU (PUT). */
  updateInAppProduct(
    packageName: string,
    product: InAppProductResource,
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('update in-app product', () =>
      this.publisher.inappproducts.update({
        packageName,
        sku: product.sku,
        requestBody: { ...product, packageName },
      }),
    ).pipe(Effect.asVoid);
  }
  /**
   * Convert a single base price into Google's **recommended local price for every Play market** via
   * `pricing:convertRegionPrices` (today's exchange rate + Google's per-country pricing patterns).
   * Advisory and read-only - it computes a recommendation and changes nothing live; callers apply the
   * numbers through the product/subscription write paths. Regions come back sorted by code; `otherRegions`
   * carries the USD/EUR fallback for markets without a local currency. `productTaxCategoryCode`, when
   * given, factors the matching tax rates into the conversion.
   */
  convertRegionPrices(
    packageName: string,
    price: PlayMoneyUnits,
    productTaxCategoryCode?: string,
  ): Effect.Effect<ConvertedPrices, GooglePlayApiError> {
    const priceRequest: androidpublisher_v3.Schema$ConvertRegionPricesRequest = { price };
    if (productTaxCategoryCode !== undefined) {
      priceRequest.productTaxCategoryCode = productTaxCategoryCode;
    }
    return this.executeGeneratedRequest('convert region prices', () =>
      this.publisher.monetization.convertRegionPrices({
        packageName,
        requestBody: priceRequest,
      }),
    ).pipe(
      Effect.map((priceConversion) => {
        const regions: ConvertedRegionPrice[] = [];
        const regionPrices = priceConversion.convertedRegionPrices;
        if (regionPrices !== null && regionPrices !== undefined) {
          for (const googlePrice of Object.values(regionPrices)) {
            if (typeof googlePrice.regionCode !== 'string') continue;
            regions.push({
              regionCode: googlePrice.regionCode,
              price: normalizeMoney(googlePrice.price),
            });
          }
        }
        regions.sort((leftPrice, rightPrice) =>
          leftPrice.regionCode.localeCompare(rightPrice.regionCode),
        );
        const convertedPrices: ConvertedPrices = { regions };
        const fallbackPrice = priceConversion.convertedOtherRegionsPrice;
        if (fallbackPrice !== undefined) {
          convertedPrices.otherRegions = {
            usdPrice: normalizeMoney(fallbackPrice.usdPrice),
            eurPrice: normalizeMoney(fallbackPrice.eurPrice),
          };
        }
        return convertedPrices;
      }),
    );
  }
  /** List the app's subscription products (`monetization.subscriptions`), paging in full. */
  listSubscriptions(
    packageName: string,
  ): Effect.Effect<SubscriptionResource[], GooglePlayApiError> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$List =
          {
            packageName,
          };
        if (pageToken !== undefined) listParameters.pageToken = pageToken;
        return this.executeGeneratedRequest('list subscriptions', () =>
          this.publisher.monetization.subscriptions.list(listParameters),
        );
      },
      (subscriptionPage) => {
        const subscriptions: SubscriptionResource[] = [];
        if (!Array.isArray(subscriptionPage.subscriptions)) return subscriptions;
        for (const googleSubscription of subscriptionPage.subscriptions) {
          const subscription = normalizeSubscription(googleSubscription);
          if (subscription !== undefined) subscriptions.push(subscription);
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
  createSubscription(
    packageName: string,
    subscription: SubscriptionResource,
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('create subscription', () =>
      this.publisher.monetization.subscriptions.create({
        packageName,
        productId: subscription.productId,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: { ...subscription, packageName },
      }),
    ).pipe(Effect.asVoid);
  }
  /**
   * Patch a subscription's masked fields (PATCH with an `updateMask` - Play requires field-level updates).
   * The masked fields are replaced by `subscription`, so the reconciler sends a merged document
   * (e.g. existing listings + the changed ones) to stay additive.
   */
  patchSubscription(
    packageName: string,
    subscription: SubscriptionResource,
    updateMask: string,
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('patch subscription', () =>
      this.publisher.monetization.subscriptions.patch({
        packageName,
        productId: subscription.productId,
        updateMask,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: { ...subscription, packageName },
      }),
    ).pipe(Effect.asVoid);
  }
  /** Activate a base plan (DRAFT -> ACTIVE), making it purchasable. Idempotent on an already-active plan. */
  activateBasePlan(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('activate base plan', () =>
      this.publisher.monetization.subscriptions.basePlans.activate({
        packageName,
        productId,
        basePlanId,
        requestBody: { packageName, productId, basePlanId },
      }),
    ).pipe(Effect.asVoid);
  }
  /** List the offers on one base plan, paging in full. */
  listSubscriptionOffers(
    packageName: string,
    productId: string,
    basePlanId: string,
  ): Effect.Effect<SubscriptionOfferResource[], GooglePlayApiError> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Monetization$Subscriptions$Baseplans$Offers$List =
          { packageName, productId, basePlanId };
        if (pageToken !== undefined) listParameters.pageToken = pageToken;
        return this.executeGeneratedRequest('list subscription offers', () =>
          this.publisher.monetization.subscriptions.basePlans.offers.list(listParameters),
        );
      },
      (offerPage) => {
        const offers: SubscriptionOfferResource[] = [];
        if (!Array.isArray(offerPage.subscriptionOffers)) return offers;
        for (const googleOffer of offerPage.subscriptionOffers) {
          const offer = normalizeSubscriptionOffer(googleOffer);
          if (offer !== undefined) offers.push(offer);
        }
        return offers;
      },
      (offerPage) => offerPage.nextPageToken,
    );
  }
  /** Create a subscription offer (in DRAFT - activate it separately). `regionsVersion.version` is required. */
  createSubscriptionOffer(
    packageName: string,
    offer: SubscriptionOfferResource,
  ): Effect.Effect<void, GooglePlayApiError> {
    let productId = '';
    let basePlanId = '';
    if (offer.productId !== undefined) productId = offer.productId;
    if (offer.basePlanId !== undefined) basePlanId = offer.basePlanId;
    return this.executeGeneratedRequest('create subscription offer', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.create({
        packageName,
        productId,
        basePlanId,
        offerId: offer.offerId,
        'regionsVersion.version': REGIONS_VERSION,
        requestBody: { ...offer, packageName },
      }),
    ).pipe(Effect.asVoid);
  }
  /** Activate a subscription offer (DRAFT -> ACTIVE), making it available. */
  activateSubscriptionOffer(
    packageName: string,
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Effect.Effect<void, GooglePlayApiError> {
    return this.executeGeneratedRequest('activate subscription offer', () =>
      this.publisher.monetization.subscriptions.basePlans.offers.activate({
        packageName,
        productId,
        basePlanId,
        offerId,
        requestBody: { packageName, productId, basePlanId, offerId },
      }),
    ).pipe(Effect.asVoid);
  }
  /**
   * List the app's customer reviews (flattened to {@link PlayReview}), paging in full. `translationLanguage`
   * asks Play to machine-translate review text into that BCP-47 language. Only reviews with text from the
   * last ~week are returned - a Play platform limit, not Launch's.
   */
  listReviews(
    packageName: string,
    options: Readonly<{
      translationLanguage?: string;
    }> = {},
  ): Effect.Effect<PlayReview[], GooglePlayApiError> {
    return collectGeneratedPages(
      (pageToken) => {
        const listParameters: androidpublisher_v3.Params$Resource$Reviews$List = { packageName };
        if (options.translationLanguage !== undefined) {
          listParameters.translationLanguage = options.translationLanguage;
        }
        if (pageToken !== undefined) listParameters.token = pageToken;
        return this.executeGeneratedRequest('list reviews', () =>
          this.publisher.reviews.list(listParameters),
        );
      },
      (reviewPage) => {
        const reviews: PlayReview[] = [];
        if (!Array.isArray(reviewPage.reviews)) return reviews;
        for (const googleReview of reviewPage.reviews) {
          const review = normalizeReview(googleReview);
          if (review !== undefined) reviews.push(review);
        }
        return reviews;
      },
      (reviewPage) => reviewPage.tokenPagination?.nextPageToken,
    );
  }
  /** Fetch one review by id (flattened to {@link PlayReview}), or null when it doesn't exist / is too old. */
  getReview(
    packageName: string,
    reviewId: string,
  ): Effect.Effect<PlayReview | null, GooglePlayApiError> {
    return this.executeGeneratedRequest('get review', () =>
      this.publisher.reviews.get({ packageName, reviewId }),
    ).pipe(
      Effect.map((googleReview) => {
        const review = normalizeReview(googleReview);
        if (review === undefined) return null;
        return review;
      }),
      Effect.catchTag('GooglePlayApiError', (requestFailure) => {
        if (requestFailure.statusCode === 404) return Effect.succeed(null);
        return Effect.fail(requestFailure);
      }),
    );
  }
  /**
   * Post (or replace) the public developer reply to a review. Play's reply endpoint is an upsert - it
   * edits an existing reply in place - and only accepts reviews from the last ~week.
   */
  replyToReview(
    packageName: string,
    reviewId: string,
    replyText: string,
  ): Effect.Effect<PlayReplyResult, GooglePlayApiError> {
    return this.executeGeneratedRequest('reply to review', () =>
      this.publisher.reviews.reply({
        packageName,
        reviewId,
        requestBody: { replyText },
      }),
    ).pipe(
      Effect.map((replyConfirmation) => {
        let storedReplyText = replyText;
        if (typeof replyConfirmation.result?.replyText === 'string') {
          storedReplyText = replyConfirmation.result.replyText;
        }
        const reply: PlayReplyResult = { replyText: storedReplyText };
        const lastEdited = timestampToIso(replyConfirmation.result?.lastEdited);
        if (lastEdited !== undefined) reply.lastEdited = lastEdited;
        return reply;
      }),
    );
  }
}
/**
 * Extract Google's human-readable error detail, falling back to the raw transport text.
 * Recognizes the sensitive/high-risk permission rejection and appends the fix, so the CLI doesn't just
 * echo a 403 - it tells you the release was blocked on a permission declaration.
 */
export const describePlayErrors = (googleErrorText: string): string => {
  const emptyBodyMessage = 'no response body';
  const decodedErrorDocument = Schema.decodeUnknownOption(
    Schema.parseJson(GoogleErrorDocumentSchema),
  )(googleErrorText);
  if (Option.isNone(decodedErrorDocument)) {
    if (googleErrorText.length > 0) return googleErrorText;
    return emptyBodyMessage;
  }
  const googleErrorDocument = decodedErrorDocument.value;
  const googleError = googleErrorDocument.error;
  let message = '';
  if (typeof googleError === 'string') message = googleError;
  if (typeof googleError === 'object' && googleError !== null) {
    if (typeof googleError.message === 'string') message = googleError.message;
    if (message.length === 0 && typeof googleError.status === 'string') {
      message = googleError.status;
    }
  }
  if (message.length === 0 && typeof googleErrorDocument.error_description === 'string') {
    message = googleErrorDocument.error_description;
  }
  if (message.length === 0) {
    if (googleErrorText.length > 0) return googleErrorText;
    return emptyBodyMessage;
  }
  if (/permission|sensitive|high.?risk|declaration/i.test(message)) {
    return `${message} - a sensitive/high-risk permission likely needs pre-approval (a Permissions Declaration) in Play Console before this release is accepted.`;
  }
  return message;
};
