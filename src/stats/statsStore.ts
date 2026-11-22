import { join } from 'node:path';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomicDocumentFile.js';
import { locateAppStatsDirectory } from '../services/platform/paths.js';
import type { DailyStat, StatsFeed, StatsMetric } from '../types/stats.js';
import { groupStatsByMonth, mergeStats } from './statsLogic.js';

const STATS_FEEDS: readonly StatsFeed[] = ['app-store', 'google-play', 'ga4'];
const STATS_METRICS: readonly StatsMetric[] = [
  'downloads',
  'redownloads',
  'updates',
  'proceeds',
  'impressions',
  'productPageViews',
  'sessions',
  'activeDevices',
  'crashes',
  'ratingAverage',
  'ratingCount',
  'installs',
  'uninstalls',
  'activeInstalls',
  'crashRate',
  'anrRate',
  'activeUsers',
  'newUsers',
];

interface StatsMonthFile {
  readonly version: 1;
  readonly appKey: string;
  readonly month: string;
  readonly stats: readonly DailyStat[];
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
}

function isStatsFeed(feed: unknown): feed is StatsFeed {
  function isSameFeed(knownFeed: StatsFeed): boolean {
    return knownFeed == feed;
  }

  return STATS_FEEDS.some(isSameFeed);
}

function isStatsMetric(metric: unknown): metric is StatsMetric {
  function isSameMetric(knownMetric: StatsMetric): boolean {
    return knownMetric == metric;
  }

  return STATS_METRICS.some(isSameMetric);
}

function decodeDailyStat(statDocument: unknown): DailyStat {
  if (isRecord(statDocument) == false) {
    throw new Error('A daily stat is not an object.');
  }

  const feed = statDocument['feed'];
  const metric = statDocument['metric'];
  const amount = statDocument['value'];
  const currency = statDocument['currency'];

  if (typeof statDocument['date'] != 'string') {
    throw new Error('A daily stat date is not a string.');
  }

  if (isStatsFeed(feed) == false) {
    throw new Error('A daily stat feed is not known.');
  }

  if (isStatsMetric(metric) == false) {
    throw new Error('A daily stat metric is not known.');
  }

  if (typeof amount != 'number') {
    throw new Error('A daily stat value is not a number.');
  }

  if (currency != null) {
    if (typeof currency != 'string') {
      throw new Error('A daily stat currency is not a string.');
    }
  }

  let savedCurrency: string | null = null;

  if (typeof currency == 'string') {
    savedCurrency = currency;
  }

  return {
    date: statDocument['date'],
    feed,
    metric,
    value: amount,
    currency: savedCurrency,
  };
}

function decodeStatsMonthFile(documentText: string): StatsMonthFile {
  const parsed: unknown = JSON.parse(documentText);

  if (isRecord(parsed) == false) {
    throw new Error('A stats month file is not an object.');
  }

  const isVersionOne = parsed['version'] == 1;

  if (isVersionOne == false) {
    throw new Error('A stats month file version is not 1.');
  }

  if (typeof parsed['appKey'] != 'string') {
    throw new Error('A stats month file app key is not a string.');
  }

  if (typeof parsed['month'] != 'string') {
    throw new Error('A stats month file month is not a string.');
  }

  if (Array.isArray(parsed['stats']) == false) {
    throw new Error('A stats month file has no stats list.');
  }

  return {
    version: 1,
    appKey: parsed['appKey'],
    month: parsed['month'],
    stats: parsed['stats'].map(decodeDailyStat),
  };
}

function listSavedStats(savedFile: StatsMonthFile | null): readonly DailyStat[] {
  const isFileMissing = savedFile == null;

  if (isFileMissing) {
    return [];
  }

  return savedFile.stats;
}

export async function saveDailyStats(appKey: string, stats: readonly DailyStat[]): Promise<void> {
  const appDirectory = locateAppStatsDirectory(appKey);
  const statsByMonth = groupStatsByMonth(stats);

  for (const [month, monthStats] of statsByMonth) {
    const monthFilePath = join(appDirectory, `${month}.json`);
    const savedFile = await readDocumentFile(monthFilePath, decodeStatsMonthFile);
    const savedStats = listSavedStats(savedFile);
    const mergedStats = mergeStats(savedStats, monthStats);
    const monthFile: StatsMonthFile = { version: 1, appKey, month, stats: mergedStats };

    await writeDocumentFileAtomically(monthFilePath, monthFile);
  }
}

/** Read the saved daily stats of one app and month; an empty list when nothing was saved yet. */
export async function loadMonthStats(appKey: string, month: string): Promise<readonly DailyStat[]> {
  const appDirectory = locateAppStatsDirectory(appKey);
  const monthFile = await readDocumentFile(
    join(appDirectory, `${month}.json`),
    decodeStatsMonthFile,
  );

  if (monthFile == null) {
    return [];
  }

  return monthFile.stats;
}
