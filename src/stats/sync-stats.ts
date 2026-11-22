import { loadPortfolioApps } from '../portfolio/load-portfolio-apps.ts';
import { findAppsByName, joinTags } from '../portfolio/portfolio-logic.ts';
import { readDocumentFile } from '../services/platform/atomic-document-file.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { locatePortfolioFilePath } from '../services/platform/paths.ts';
import type {
  AppOwner,
  DiscoveredApp,
  PortfolioApp,
  PortfolioFile,
  PortfolioLoad,
  PortfolioLoadMode,
  PortfolioPlatform,
} from '../types/portfolio.ts';
import type {
  AppCoverage,
  AppFeedSyncReport,
  DateRange,
  FeedCoverage,
  FeedFetchReply,
  StatsSyncReport,
  StatsSyncRequest,
} from '../types/stats.ts';
import {
  createNotesMessage,
  findFeedCoverage,
  markFeedCoverageFailed,
  markFeedCoverageSkipped,
  mergeFeedCoverage,
  subtractCoverage,
} from './coverage-logic.ts';
import { loadAppCoverage, saveAppCoverage } from './coverage-store.ts';
import { createLastDaysRange, readYesterdayUtc } from './date-range.ts';
import { STATS_FEED_PLUGINS } from './feed-registry.ts';
import { StatsCredentials } from './stats-credentials.ts';
import { saveDailyStats } from './stats-store.ts';
import { holdSyncLock } from './sync-lock.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

type StatsAppNotFoundFailure = Readonly<{
  readonly _tag: 'StatsAppNotFoundFailure';
  readonly message: string;
  readonly knownAppNames: readonly string[];
}>;

function makeStatsAppNotFoundFailure(fields: {
  message: string;
  knownAppNames: readonly string[];
}): StatsAppNotFoundFailure {
  return {
    _tag: 'StatsAppNotFoundFailure',
    message: fields.message,
    knownAppNames: fields.knownAppNames,
  };
}

interface FeedSync {
  readonly report: AppFeedSyncReport;
  readonly coverage: FeedCoverage | null;
}

interface FetchedFeed {
  readonly app: PortfolioApp;
  readonly plugin: (typeof STATS_FEED_PLUGINS)[number];
  readonly missingRange: DateRange;
  readonly savedCoverage: FeedCoverage | null;
  readonly syncedAt: string;
  readonly reply: FeedFetchReply;
}

function readRequiredString(document: Record<string, unknown>, fieldName: string): string {
  const field = document[fieldName];

  if (typeof field != 'string') {
    throw new Error(`Expected ${fieldName} to be a string.`);
  }

  return field;
}

function readStringOrNull(document: Record<string, unknown>, fieldName: string): string | null {
  const field = document[fieldName];

  if (field == null) {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error(`Expected ${fieldName} to be a string or null.`);
  }

  return field;
}

function readPlatform(document: Record<string, unknown>): PortfolioPlatform {
  const platform = document['platform'];

  if (platform == 'ios') {
    return 'ios';
  }

  if (platform == 'android') {
    return 'android';
  }

  throw new Error('An app platform is not ios or android.');
}

function readOwner(owner: unknown): AppOwner | null {
  if (owner == null) {
    return null;
  }

  if (owner == 'mine') {
    return 'mine';
  }

  if (owner == 'client') {
    return 'client';
  }

  throw new Error('An app owner is not mine or client.');
}

function decodeDiscoveredApp(appDocument: unknown): DiscoveredApp {
  const appDocumentObject = readPlainObject(appDocument);

  if (appDocumentObject == null) {
    throw new Error('A portfolio app is not an object.');
  }

  return {
    key: readRequiredString(appDocumentObject, 'key'),
    platform: readPlatform(appDocumentObject),
    storeId: readRequiredString(appDocumentObject, 'storeId'),
    name: readRequiredString(appDocumentObject, 'name'),
    bundleId: readStringOrNull(appDocumentObject, 'bundleId'),
    packageName: readStringOrNull(appDocumentObject, 'packageName'),
    accountKeyId: readStringOrNull(appDocumentObject, 'accountKeyId'),
    accountLabel: readRequiredString(appDocumentObject, 'accountLabel'),
  };
}

function decodeAppTag(tagDocument: unknown): PortfolioFile['tags'][number] {
  const tagDocumentObject = readPlainObject(tagDocument);

  if (tagDocumentObject == null) {
    throw new Error('A portfolio tag is not an object.');
  }

  return {
    appKey: readRequiredString(tagDocumentObject, 'appKey'),
    owner: readOwner(tagDocumentObject['owner']),
    ga4PropertyId: readStringOrNull(tagDocumentObject, 'ga4PropertyId'),
  };
}

function decodePortfolioFile(documentText: string): PortfolioFile {
  const parsed: unknown = JSON.parse(documentText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw new Error('Portfolio file is not an object.');
  }

  const isVersionOne = parsedObject['version'] == 1;

  if (isVersionOne == false) {
    throw new Error('Portfolio file version is not 1.');
  }

  if (Array.isArray(parsedObject['apps']) == false) {
    throw new Error('Portfolio apps are not a list.');
  }

  if (Array.isArray(parsedObject['tags']) == false) {
    throw new Error('Portfolio tags are not a list.');
  }

  let playReportsBucket: string | null = null;
  const hasBucket = 'playReportsBucket' in parsedObject;

  if (hasBucket) {
    playReportsBucket = readStringOrNull(parsedObject, 'playReportsBucket');
  }

  return {
    version: 1,
    discoveredAt: readStringOrNull(parsedObject, 'discoveredAt'),
    apps: parsedObject['apps'].map(decodeDiscoveredApp),
    tags: parsedObject['tags'].map(decodeAppTag),
    playReportsBucket,
  };
}

function isPortfolioLoad(candidate: unknown): candidate is PortfolioLoad {
  const candidateObject = readPlainObject(candidate);

  if (candidateObject == null) {
    return false;
  }

  return Array.isArray(candidateObject['apps']);
}

async function loadDiscoveredPortfolio(mode: PortfolioLoadMode): Promise<PortfolioLoad> {
  const portfolioLoad: unknown = await loadPortfolioApps(mode);

  if (isPortfolioLoad(portfolioLoad)) {
    return portfolioLoad;
  }

  throw new Error('Portfolio discovery is not available yet.');
}

export async function loadStatsPortfolio(mode: PortfolioLoadMode): Promise<PortfolioLoad> {
  const isDiscoverMode = mode == 'discover';

  if (isDiscoverMode) {
    return loadDiscoveredPortfolio(mode);
  }

  const portfolioFilePath = locatePortfolioFilePath();
  const savedFile = await readDocumentFile(portfolioFilePath, decodePortfolioFile);

  if (savedFile == null) {
    return loadDiscoveredPortfolio(mode);
  }

  return {
    apps: joinTags(savedFile.apps, savedFile.tags),
    warnings: [],
    isFromCache: true,
  };
}

async function recordFetchedFeed(fetched: FetchedFeed): Promise<FeedSync> {
  const reply = fetched.reply;
  const isFeedSkipped = reply.status == 'skipped';

  if (isFeedSkipped) {
    return {
      report: {
        appKey: fetched.app.key,
        feed: fetched.plugin.feed,
        status: 'skipped',
        statsWritten: 0,
        message: reply.reason,
      },
      coverage: markFeedCoverageSkipped(fetched.savedCoverage, fetched.syncedAt, reply.reason),
    };
  }

  await saveDailyStats(fetched.app.key, reply.stats);

  const notesMessage = createNotesMessage(reply.notes);
  const mergedCoverage = mergeFeedCoverage(
    fetched.savedCoverage,
    fetched.missingRange,
    reply.coveredThrough,
    fetched.syncedAt,
  );

  return {
    report: {
      appKey: fetched.app.key,
      feed: fetched.plugin.feed,
      status: 'synced',
      statsWritten: reply.stats.length,
      message: notesMessage,
    },
    coverage: { ...mergedCoverage, lastNote: notesMessage },
  };
}

async function syncOneFeed(
  app: PortfolioApp,
  plugin: (typeof STATS_FEED_PLUGINS)[number],
  requestedRange: DateRange,
  savedCoverage: FeedCoverage | null,
  syncedAt: string,
): Promise<FeedSync> {
  const missingRange = subtractCoverage(requestedRange, savedCoverage);
  const isFeedUpToDate = missingRange == null;

  if (isFeedUpToDate) {
    return {
      report: {
        appKey: app.key,
        feed: plugin.feed,
        status: 'up-to-date',
        statsWritten: 0,
        message: null,
      },
      coverage: savedCoverage,
    };
  }

  var reply: FeedFetchReply;

  try {
    reply = await plugin.fetchDays({ app, range: missingRange, credentials: StatsCredentials });
  } catch (cause) {
    const message = errorMessage(cause);

    return {
      report: {
        appKey: app.key,
        feed: plugin.feed,
        status: 'failed',
        statsWritten: 0,
        message,
      },
      coverage: markFeedCoverageFailed(savedCoverage, message),
    };
  }

  return recordFetchedFeed({
    app,
    plugin,
    missingRange,
    savedCoverage,
    syncedAt,
    reply,
  });
}

async function syncOneApp(
  app: PortfolioApp,
  requestedRange: DateRange,
  syncedAt: string,
): Promise<AppFeedSyncReport[]> {
  const savedCoverage = await loadAppCoverage(app.key);
  const appFeedReports: AppFeedSyncReport[] = [];
  const feedCoverages: AppCoverage['feeds'] = { ...savedCoverage.feeds };

  for (const plugin of STATS_FEED_PLUGINS) {
    const isFeedApplicable = plugin.isApplicable(app);

    if (isFeedApplicable == false) {
      continue;
    }

    const savedFeedCoverage = findFeedCoverage(savedCoverage, plugin.feed);
    const feedSync = await syncOneFeed(app, plugin, requestedRange, savedFeedCoverage, syncedAt);
    appFeedReports.push(feedSync.report);
    const nextCoverage = feedSync.coverage;

    if (nextCoverage != null) {
      feedCoverages[plugin.feed] = nextCoverage;
    }
  }

  await saveAppCoverage({ ...savedCoverage, feeds: feedCoverages });

  return appFeedReports;
}

async function loadAppsToSync(appName: string | null): Promise<PortfolioApp[]> {
  const cachedLoad = await loadStatsPortfolio('cache-first');
  const isEveryAppWanted = appName == null;

  if (isEveryAppWanted) {
    return [...cachedLoad.apps];
  }

  const appsFoundInCache = findAppsByName(cachedLoad.apps, appName);
  const isAppInCache = appsFoundInCache.length > 0;

  if (isAppInCache) {
    return appsFoundInCache;
  }

  const discoveredLoad = await loadDiscoveredPortfolio('discover');
  const appsFoundByDiscovery = findAppsByName(discoveredLoad.apps, appName);
  const isAppDiscovered = appsFoundByDiscovery.length > 0;

  if (isAppDiscovered) {
    return appsFoundByDiscovery;
  }

  const knownAppNames = discoveredLoad.apps.map(function readAppName(app: PortfolioApp): string {
    return app.name;
  });
  const notFoundFailure = makeStatsAppNotFoundFailure({
    message: `No app matched "${appName}". Known apps: ${knownAppNames.join(', ')}.`,
    knownAppNames,
  });

  throw notFoundFailure;
}

export async function syncStats(request: StatsSyncRequest): Promise<StatsSyncReport> {
  async function syncLocked(): Promise<StatsSyncReport> {
    const apps = await loadAppsToSync(request.appName);
    const yesterday = readYesterdayUtc();
    const nowMilliseconds = Date.now();
    const syncedAt = new Date(nowMilliseconds).toISOString();
    const requestedRange = createLastDaysRange(yesterday, request.days);
    const appFeeds: AppFeedSyncReport[] = [];

    for (const app of apps) {
      const appFeedReports = await syncOneApp(app, requestedRange, syncedAt);
      appFeeds.push(...appFeedReports);
    }

    return { syncedAt, appFeeds };
  }

  return holdSyncLock(syncLocked);
}
