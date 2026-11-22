import { join } from 'node:path';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomicDocumentFile.ts';
import { locateAppStatsDirectory } from '../services/platform/paths.ts';
import type { AppCoverage, FeedCoverage, StatsFeed } from '../types/stats.ts';

const COVERAGE_FEEDS: readonly StatsFeed[] = ['app-store', 'google-play', 'ga4'];

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
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

function decodeFeedCoverage(feedDocument: unknown): FeedCoverage {
  if (isRecord(feedDocument) == false) {
    throw new Error('A feed coverage is not an object.');
  }

  let lastNote: string | null = null;
  const hasLastNote = 'lastNote' in feedDocument;

  if (hasLastNote) {
    lastNote = readStringOrNull(feedDocument, 'lastNote');
  }

  return {
    lastSyncedAt: readRequiredString(feedDocument, 'lastSyncedAt'),
    coveredFrom: readStringOrNull(feedDocument, 'coveredFrom'),
    coveredThrough: readStringOrNull(feedDocument, 'coveredThrough'),
    lastError: readStringOrNull(feedDocument, 'lastError'),
    lastNote,
  };
}

function decodeAppCoverage(documentText: string): AppCoverage {
  const parsed: unknown = JSON.parse(documentText);

  if (isRecord(parsed) == false) {
    throw new Error('Coverage file is not an object.');
  }

  const isVersionOne = parsed['version'] == 1;

  if (isVersionOne == false) {
    throw new Error('Coverage file version is not 1.');
  }

  const feedsDocument = parsed['feeds'];

  if (isRecord(feedsDocument) == false) {
    throw new Error('Coverage feeds are not an object.');
  }

  const feeds: AppCoverage['feeds'] = {};

  for (const feed of COVERAGE_FEEDS) {
    const hasFeed = feed in feedsDocument;

    if (hasFeed == false) {
      continue;
    }

    feeds[feed] = decodeFeedCoverage(feedsDocument[feed]);
  }

  return {
    version: 1,
    appKey: readRequiredString(parsed, 'appKey'),
    feeds,
  };
}

export function createEmptyAppCoverage(appKey: string): AppCoverage {
  return { version: 1, appKey, feeds: {} };
}

function locateCoverageFile(appKey: string): string {
  return join(locateAppStatsDirectory(appKey), 'coverage.json');
}

export async function loadAppCoverage(appKey: string): Promise<AppCoverage> {
  const coverageFilePath = locateCoverageFile(appKey);
  const savedCoverage = await readDocumentFile(coverageFilePath, decodeAppCoverage);
  const isCoverageMissing = savedCoverage == null;

  if (isCoverageMissing) {
    return createEmptyAppCoverage(appKey);
  }

  return savedCoverage;
}

export async function saveAppCoverage(appCoverage: AppCoverage): Promise<void> {
  const coverageFilePath = locateCoverageFile(appCoverage.appKey);

  await writeDocumentFileAtomically(coverageFilePath, appCoverage);
}
