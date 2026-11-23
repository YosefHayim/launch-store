// Saves and loads one app's daily stats, keeping a separate file for each month.

import { join } from 'node:path';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomic-document-file.ts';
import { locateAppStatsDirectory } from '../services/platform/paths.ts';
import type { DailyStat, StatsFeed, StatsMetric } from '../types/stats.ts';
import { groupStatsByMonth, mergeStats } from './stats-logic.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const statsFeeds: readonly StatsFeed[] = ['app-store', 'google-play', 'ga4'];
const statsMetrics: readonly StatsMetric[] = [
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

function isStatsFeed(feed: unknown): feed is StatsFeed {
  function isSameFeed(knownFeed: StatsFeed): boolean {
    return knownFeed == feed;
  }

  return statsFeeds.some(isSameFeed);
}

function isStatsMetric(metric: unknown): metric is StatsMetric {
  function isSameMetric(knownMetric: StatsMetric): boolean {
    return knownMetric == metric;
  }

  return statsMetrics.some(isSameMetric);
}

function decodeDailyStat(statDocument: unknown): DailyStat {
  const statDocumentObject = readPlainObject(statDocument);

  if (statDocumentObject == null) {
    throw new Error('A daily stat is not an object.');
  }

  const feed = statDocumentObject['feed'];
  const metric = statDocumentObject['metric'];
  const amount = statDocumentObject['value'];
  const currency = statDocumentObject['currency'];

  if (typeof statDocumentObject['date'] != 'string') {
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
    date: statDocumentObject['date'],
    feed,
    metric,
    value: amount,
    currency: savedCurrency,
  };
}

function decodeStatsMonthFile(documentText: string): StatsMonthFile {
  const parsed: unknown = JSON.parse(documentText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw new Error('A stats month file is not an object.');
  }

  const isVersionOne = parsedObject['version'] == 1;

  if (isVersionOne == false) {
    throw new Error('A stats month file version is not 1.');
  }

  if (typeof parsedObject['appKey'] != 'string') {
    throw new Error('A stats month file app key is not a string.');
  }

  if (typeof parsedObject['month'] != 'string') {
    throw new Error('A stats month file month is not a string.');
  }

  if (Array.isArray(parsedObject['stats']) == false) {
    throw new Error('A stats month file has no stats list.');
  }

  return {
    version: 1,
    appKey: parsedObject['appKey'],
    month: parsedObject['month'],
    stats: parsedObject['stats'].map(decodeDailyStat),
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
  const joinedPath = join(appDirectory, `${month}.json`);
  const monthFile = await readDocumentFile(joinedPath, decodeStatsMonthFile);

  if (monthFile == null) {
    return [];
  }

  return monthFile.stats;
}
