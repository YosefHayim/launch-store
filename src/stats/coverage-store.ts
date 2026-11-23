// Loads and saves which days each App Store Connect, Google Play, and Analytics feed covers.

import { join } from 'node:path';
import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomic-document-file.ts';
import { locateAppStatsDirectory } from '../services/platform/paths.ts';
import type { AppCoverage, FeedCoverage, StatsFeed } from '../types/stats.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const coverageFeeds: readonly StatsFeed[] = ['app-store', 'google-play', 'ga4'];

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
  const feedDocumentObject = readPlainObject(feedDocument);

  if (feedDocumentObject == null) {
    throw new Error('A feed coverage is not an object.');
  }

  let lastNote: string | null = null;

  const hasLastNote = 'lastNote' in feedDocumentObject;

  if (hasLastNote) {
    lastNote = readStringOrNull(feedDocumentObject, 'lastNote');
  }

  return {
    lastSyncedAt: readRequiredString(feedDocumentObject, 'lastSyncedAt'),
    coveredFrom: readStringOrNull(feedDocumentObject, 'coveredFrom'),
    coveredThrough: readStringOrNull(feedDocumentObject, 'coveredThrough'),
    lastError: readStringOrNull(feedDocumentObject, 'lastError'),
    lastNote,
  };
}

function decodeAppCoverage(documentText: string): AppCoverage {
  const parsed: unknown = JSON.parse(documentText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw new Error('Coverage file is not an object.');
  }

  const isVersionOne = parsedObject['version'] == 1;

  if (isVersionOne == false) {
    throw new Error('Coverage file version is not 1.');
  }

  const feedsDocument = parsedObject['feeds'];

  const feedsDocumentObject = readPlainObject(feedsDocument);

  if (feedsDocumentObject == null) {
    throw new Error('Coverage feeds are not an object.');
  }

  const feeds: AppCoverage['feeds'] = {};

  for (const feed of coverageFeeds) {
    const hasFeed = feed in feedsDocumentObject;

    if (hasFeed == false) {
      continue;
    }

    feeds[feed] = decodeFeedCoverage(feedsDocumentObject[feed]);
  }

  return {
    version: 1,
    appKey: readRequiredString(parsedObject, 'appKey'),
    feeds,
  };
}

export function createEmptyAppCoverage(appKey: string): AppCoverage {
  return { version: 1, appKey, feeds: {} };
}

function locateCoverageFile(appKey: string): string {
  const appStatsDirectory = locateAppStatsDirectory(appKey);
  return join(appStatsDirectory, 'coverage.json');
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
