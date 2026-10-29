import type { HttpClient } from '@effect/platform';
import { Effect } from 'effect';
import type { PortfolioApp } from '../../types/portfolio.js';
import type {
  FeedFetchReply,
  StatsCredentialsShape,
  StatsFeedFailure,
  StatsFeedPlugin,
} from '../../types/stats.js';
import { errorMessage } from '../../services/errorMessage.js';
import { readProjectIdFromClientEmail, type Ga4Failure, type Ga4Session } from './ga4Client.js';
import { loadGa4Report } from './ga4Report.js';
import { findAppStream, listAllAppStreams, listAppStreams } from './ga4Streams.js';

const GA4_READONLY_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

interface Ga4Target {
  readonly propertyId: string;
  readonly streamId: string | null;
}

const createCredentialsFailure = (app: PortfolioApp, cause: unknown): StatsFeedFailure => ({
  _tag: 'StatsFeedFailure',
  feed: 'ga4',
  appKey: app.key,
  message: `Could not read the Google credentials: ${errorMessage(cause)}`,
  cause,
});

const readAccessToken = (
  credentials: StatsCredentialsShape,
  app: PortfolioApp,
): Effect.Effect<string | null, StatsFeedFailure> =>
  credentials
    .googleAccessToken([GA4_READONLY_SCOPE])
    .pipe(Effect.mapError((cause) => createCredentialsFailure(app, cause)));

const readProjectId = (
  credentials: StatsCredentialsShape,
  app: PortfolioApp,
): Effect.Effect<string | null, StatsFeedFailure> =>
  Effect.gen(function* () {
    const serviceAccount = yield* credentials
      .playServiceAccount()
      .pipe(Effect.mapError((cause) => createCredentialsFailure(app, cause)));
    if (serviceAccount === null) return null;
    return readProjectIdFromClientEmail(serviceAccount.clientEmail);
  });

const createWholePropertyNotes = (target: Ga4Target): readonly string[] => {
  if (target.streamId !== null) return [];
  return [
    `GA4 property ${target.propertyId} has no stream for this app, so the numbers cover the whole property`,
  ];
};

const readStoreIdentifier = (app: PortfolioApp): string => {
  if (app.platform === 'ios' && app.bundleId !== null) return app.bundleId;
  if (app.platform === 'android' && app.packageName !== null) return app.packageName;
  return app.key;
};

const createNoPropertyReason = (app: PortfolioApp): string =>
  `No GA4 property with a stream for ${readStoreIdentifier(app)}; tag one with launch apps tag --app ${app.name} --ga4-property <id>`;

const findTaggedTarget = (
  session: Ga4Session,
  app: PortfolioApp,
  propertyId: string,
): Effect.Effect<Ga4Target, Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const propertyStreams = yield* listAppStreams(session, propertyId);
    const taggedStream = findAppStream(app, propertyStreams);
    if (taggedStream === null) return { propertyId, streamId: null };
    return { propertyId, streamId: taggedStream.streamId };
  });

const findTarget = (
  session: Ga4Session,
  app: PortfolioApp,
): Effect.Effect<Ga4Target | null, Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    if (app.ga4PropertyId !== null) return yield* findTaggedTarget(session, app, app.ga4PropertyId);
    const catalog = yield* listAllAppStreams(session);
    const foundStream = findAppStream(app, catalog);
    if (foundStream === null) return null;
    return { propertyId: foundStream.propertyId, streamId: foundStream.streamId };
  });

const fetchWithSession = (
  session: Ga4Session,
  app: PortfolioApp,
  range: { readonly from: string; readonly to: string },
): Effect.Effect<FeedFetchReply, Ga4Failure, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const target = yield* findTarget(session, app);
    if (target === null) {
      return { status: 'skipped', reason: createNoPropertyReason(app) } as const;
    }
    const stats = yield* loadGa4Report(session, {
      propertyId: target.propertyId,
      streamId: target.streamId,
      range,
    });
    const notes: readonly string[] = createWholePropertyNotes(target);
    return { status: 'fetched', stats, coveredThrough: range.to, notes } as const;
  });

export const ga4Feed: StatsFeedPlugin = {
  feed: 'ga4',
  isApplicable: () => true,
  fetchDays: ({ app, range, credentials }) =>
    Effect.gen(function* () {
      const accessToken = yield* readAccessToken(credentials, app);
      if (accessToken === null) {
        return {
          status: 'skipped',
          reason: 'No Google service account saved; add one with launch credentials',
        } as const;
      }
      const projectId = yield* readProjectId(credentials, app);
      const session = { appKey: app.key, accessToken, projectId };
      return yield* fetchWithSession(session, app, range).pipe(
        Effect.catchTag('Ga4SkipSignal', (skipSignal) =>
          Effect.succeed({ status: 'skipped', reason: skipSignal.reason } as const),
        ),
      );
    }),
};
