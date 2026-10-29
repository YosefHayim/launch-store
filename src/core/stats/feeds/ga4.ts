import type { HttpClient } from '@effect/platform';
import { Effect, Ref } from 'effect';
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
import {
  findAppStream,
  listAllAppStreams,
  listAppStreams,
  type Ga4AppStream,
} from './ga4Streams.js';

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

const readStoreIdentifier = (app: PortfolioApp): string => {
  if (app.platform === 'ios' && app.bundleId !== null) return app.bundleId;
  if (app.platform === 'android' && app.packageName !== null) return app.packageName;
  return app.key;
};

const createNoPropertyReason = (app: PortfolioApp): string =>
  `No GA4 property with a stream for ${readStoreIdentifier(app)}; tag one with launch apps tag --app ${app.name} --ga4-property <id>`;

/** The plugin keeps its auto-find lookup in a cache of its own, so one run reuses it across apps. */
export const makeGa4Feed = (): StatsFeedPlugin => {
  const appStreamCatalog = Effect.runSync(Ref.make<readonly Ga4AppStream[] | null>(null));

  const loadAppStreamCatalog = (
    session: Ga4Session,
  ): Effect.Effect<readonly Ga4AppStream[], Ga4Failure, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const cachedCatalog = yield* Ref.get(appStreamCatalog);
      if (cachedCatalog !== null) return cachedCatalog;
      const loadedCatalog = yield* listAllAppStreams(session);
      yield* Ref.set(appStreamCatalog, loadedCatalog);
      return loadedCatalog;
    });

  const findTarget = (
    session: Ga4Session,
    app: PortfolioApp,
  ): Effect.Effect<Ga4Target | null, Ga4Failure, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      if (app.ga4PropertyId !== null) {
        const propertyStreams = yield* listAppStreams(session, app.ga4PropertyId);
        const taggedStream = findAppStream(app, propertyStreams);
        if (taggedStream === null) return { propertyId: app.ga4PropertyId, streamId: null };
        return { propertyId: app.ga4PropertyId, streamId: taggedStream.streamId };
      }
      const catalog = yield* loadAppStreamCatalog(session);
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
      return { status: 'fetched', stats, coveredThrough: range.to } as const;
    });

  return {
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
};

export const ga4Feed: StatsFeedPlugin = makeGa4Feed();
