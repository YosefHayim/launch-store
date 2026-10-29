import type { HttpClient } from '@effect/platform';
import { Effect, Schema } from 'effect';
import type { PortfolioApp } from '../../types/portfolio.js';
import {
  ANALYTICS_ADMIN_URL,
  createGa4Failure,
  requestGa4Document,
  type Ga4Failure,
  type Ga4Session,
} from './ga4Client.js';

const ACCOUNT_SUMMARIES_PAGE_SIZE = 200;
const DATA_STREAMS_PAGE_SIZE = 200;

export interface Ga4AppStream {
  readonly propertyId: string;
  readonly streamId: string;
  readonly bundleId: string | null;
  readonly packageName: string | null;
}

const NextPageSchema = Schema.Struct({ nextPageToken: Schema.optional(Schema.String) });

const AccountSummariesSchema = Schema.Struct({
  accountSummaries: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        propertySummaries: Schema.optionalWith(
          Schema.Array(Schema.Struct({ property: Schema.String })),
          { default: () => [] },
        ),
      }),
    ),
    { default: () => [] },
  ),
});

const DataStreamsSchema = Schema.Struct({
  dataStreams: Schema.optionalWith(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        iosAppStreamData: Schema.optionalWith(
          Schema.Struct({
            bundleId: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
          }),
          { default: () => ({ bundleId: null }) },
        ),
        androidAppStreamData: Schema.optionalWith(
          Schema.Struct({
            packageName: Schema.optionalWith(Schema.NullOr(Schema.String), {
              default: () => null,
            }),
          }),
          { default: () => ({ packageName: null }) },
        ),
      }),
    ),
    { default: () => [] },
  ),
});

const readIdAfterSegment = (resourceName: string, segment: string): string | null => {
  const nameParts = resourceName.split('/');
  const segmentIndex = nameParts.indexOf(segment);
  if (segmentIndex === -1) return null;
  const idPart = nameParts[segmentIndex + 1];
  if (idPart === undefined) return null;
  return idPart;
};

/** An app matches a stream by iOS bundle id or Android package name. */
export const findAppStream = (
  app: PortfolioApp,
  streams: readonly Ga4AppStream[],
): Ga4AppStream | null => {
  const appStream = streams.find((stream) => {
    const isSameBundleId = app.bundleId !== null && stream.bundleId === app.bundleId;
    const isSamePackageName = app.packageName !== null && stream.packageName === app.packageName;
    return isSameBundleId || isSamePackageName;
  });
  if (appStream === undefined) return null;
  return appStream;
};

const createPageUrl = (listUrl: string, pageSize: number, pageToken: string | null): string => {
  const pageUrl = new URL(listUrl);
  pageUrl.searchParams.set('pageSize', String(pageSize));
  if (pageToken !== null) pageUrl.searchParams.set('pageToken', pageToken);
  return pageUrl.toString();
};

interface PagedList {
  readonly url: string;
  readonly pageSize: number;
  readonly propertyId: string | null;
}

const listPages = (
  session: Ga4Session,
  pagedList: PagedList,
  pageToken: string | null,
): Effect.Effect<readonly unknown[], Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const pageDocument = yield* requestGa4Document(session, {
      url: createPageUrl(pagedList.url, pagedList.pageSize, pageToken),
      requestDocument: null,
      propertyId: pagedList.propertyId,
    });
    const nextPage = yield* Schema.decodeUnknown(NextPageSchema)(pageDocument).pipe(
      Effect.mapError((cause) =>
        createGa4Failure(session, 'Unreadable Google Analytics page', cause),
      ),
    );
    const nextPageToken = nextPage.nextPageToken;
    const isLastPage = nextPageToken === undefined || nextPageToken === '';
    if (isLastPage) return [pageDocument];
    const laterPages = yield* listPages(session, pagedList, nextPageToken);
    return [pageDocument, ...laterPages];
  });

/** The app streams (iOS or Android) of one property. */
export const listAppStreams = (
  session: Ga4Session,
  propertyId: string,
): Effect.Effect<readonly Ga4AppStream[], Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const pages = yield* listPages(
      session,
      {
        url: `${ANALYTICS_ADMIN_URL}/properties/${propertyId}/dataStreams`,
        pageSize: DATA_STREAMS_PAGE_SIZE,
        propertyId,
      },
      null,
    );
    const appStreams: Ga4AppStream[] = [];
    for (const page of pages) {
      const decodedPage = yield* Schema.decodeUnknown(DataStreamsSchema)(page).pipe(
        Effect.mapError((cause) => createGa4Failure(session, 'Unreadable GA4 data streams', cause)),
      );
      for (const dataStream of decodedPage.dataStreams) {
        const streamId = readIdAfterSegment(dataStream.name, 'dataStreams');
        const bundleId = dataStream.iosAppStreamData.bundleId;
        const packageName = dataStream.androidAppStreamData.packageName;
        const isAppStream = bundleId !== null || packageName !== null;
        if (streamId === null || !isAppStream) continue;
        appStreams.push({ propertyId, streamId, bundleId, packageName });
      }
    }
    return appStreams;
  });

const listPropertyIds = (
  session: Ga4Session,
): Effect.Effect<readonly string[], Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const pages = yield* listPages(
      session,
      {
        url: `${ANALYTICS_ADMIN_URL}/accountSummaries`,
        pageSize: ACCOUNT_SUMMARIES_PAGE_SIZE,
        propertyId: null,
      },
      null,
    );
    const propertyIds: string[] = [];
    for (const page of pages) {
      const decodedPage = yield* Schema.decodeUnknown(AccountSummariesSchema)(page).pipe(
        Effect.mapError((cause) =>
          createGa4Failure(session, 'Unreadable GA4 account summaries', cause),
        ),
      );
      for (const accountSummary of decodedPage.accountSummaries) {
        for (const propertySummary of accountSummary.propertySummaries) {
          const propertyId = readIdAfterSegment(propertySummary.property, 'properties');
          if (propertyId !== null) propertyIds.push(propertyId);
        }
      }
    }
    return propertyIds;
  });

/** Every app stream of every property the service account can see. */
export const listAllAppStreams = (
  session: Ga4Session,
): Effect.Effect<readonly Ga4AppStream[], Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const propertyIds = yield* listPropertyIds(session);
    const streamsPerProperty = yield* Effect.forEach(propertyIds, (propertyId) =>
      listAppStreams(session, propertyId),
    );
    return streamsPerProperty.flat();
  });
