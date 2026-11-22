import {
  readDocumentFile,
  writeDocumentFileAtomically,
} from '../services/platform/atomicDocumentFile.ts';
import { locatePortfolioFilePath } from '../services/platform/paths.ts';
import type {
  AppOwner,
  DiscoveredApp,
  PortfolioFile,
  PortfolioPlatform,
} from '../types/portfolio.ts';

export function createEmptyPortfolioFile(): PortfolioFile {
  return {
    version: 1,
    discoveredAt: null,
    apps: [],
    tags: [],
    playReportsBucket: null,
  };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
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
  if (isRecord(appDocument) == false) {
    throw new Error('A portfolio app is not an object.');
  }

  return {
    key: readRequiredString(appDocument, 'key'),
    platform: readPlatform(appDocument),
    storeId: readRequiredString(appDocument, 'storeId'),
    name: readRequiredString(appDocument, 'name'),
    bundleId: readStringOrNull(appDocument, 'bundleId'),
    packageName: readStringOrNull(appDocument, 'packageName'),
    accountKeyId: readStringOrNull(appDocument, 'accountKeyId'),
    accountLabel: readRequiredString(appDocument, 'accountLabel'),
  };
}

function decodeAppTag(tagDocument: unknown): PortfolioFile['tags'][number] {
  if (isRecord(tagDocument) == false) {
    throw new Error('A portfolio tag is not an object.');
  }

  return {
    appKey: readRequiredString(tagDocument, 'appKey'),
    owner: readOwner(tagDocument['owner']),
    ga4PropertyId: readStringOrNull(tagDocument, 'ga4PropertyId'),
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

  if (isRecord(parsed) == false) {
    throw new Error('Portfolio file is not an object.');
  }

  const version = parsed['version'];

  if (typeof version != 'number') {
    throw new Error('Portfolio file version is not 1.');
  }

  if (version != 1) {
    throw new Error('Portfolio file version is not 1.');
  }

  if (Array.isArray(parsed['apps']) == false) {
    throw new Error('Portfolio apps are not a list.');
  }

  if (Array.isArray(parsed['tags']) == false) {
    throw new Error('Portfolio tags are not a list.');
  }

  return {
    version: 1,
    discoveredAt: readStringOrNull(parsed, 'discoveredAt'),
    apps: parsed['apps'].map(decodeDiscoveredApp),
    tags: parsed['tags'].map(decodeAppTag),
    playReportsBucket: readPlayReportsBucket(parsed),
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
