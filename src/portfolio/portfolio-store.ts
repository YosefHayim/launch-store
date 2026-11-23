// Reads and writes the file that remembers discovered apps and their tags.

import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomic-document-file.ts';
import { locatePortfolioFilePath } from '../services/platform/paths.ts';
import type {
  AppOwner,
  DiscoveredApp,
  PortfolioFile,
  PortfolioPlatform,
} from '../types/portfolio.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

export function createEmptyPortfolioFile(): PortfolioFile {
  return {
    version: 1,
    discoveredAt: null,
    apps: [],
    tags: [],
    playReportsBucket: null,
  };
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

function readPlayReportsBucket(document: Record<string, unknown>): string | null {
  const hasBucket = 'playReportsBucket' in document;

  if (hasBucket == false) {
    return null;
  }

  return readStringOrNull(document, 'playReportsBucket');
}

function decodePortfolioFile(documentText: string): PortfolioFile {
  const parsed: unknown = JSON.parse(documentText);

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw new Error('Portfolio file is not an object.');
  }

  const version = parsedObject['version'];

  if (typeof version != 'number') {
    throw new Error('Portfolio file version is not 1.');
  }

  if (version != 1) {
    throw new Error('Portfolio file version is not 1.');
  }

  if (Array.isArray(parsedObject['apps']) == false) {
    throw new Error('Portfolio apps are not a list.');
  }

  if (Array.isArray(parsedObject['tags']) == false) {
    throw new Error('Portfolio tags are not a list.');
  }

  return {
    version: 1,
    discoveredAt: readStringOrNull(parsedObject, 'discoveredAt'),
    apps: parsedObject['apps'].map(decodeDiscoveredApp),
    tags: parsedObject['tags'].map(decodeAppTag),
    playReportsBucket: readPlayReportsBucket(parsedObject),
  };
}

export async function loadPortfolioFile(): Promise<PortfolioFile | null> {
  const portfolioFilePath = locatePortfolioFilePath();

  return readDocumentFile(portfolioFilePath, decodePortfolioFile);
}

export function pickSavedPortfolioFile(cachedFile: PortfolioFile | null): PortfolioFile {
  if (cachedFile == null) {
    return createEmptyPortfolioFile();
  }

  return cachedFile;
}

export async function savePortfolioFile(portfolioFile: PortfolioFile): Promise<void> {
  const portfolioFilePath = locatePortfolioFilePath();

  await writeDocumentFileAtomically(portfolioFilePath, portfolioFile);
}
