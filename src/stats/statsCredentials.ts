import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../config/config.ts';
import { listAccounts, loadAscKeyById } from '../credentials/accounts.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { readDocumentFile } from '../services/platform/atomicDocumentFile.ts';
import { locatePortfolioFilePath, readLaunchDirectories } from '../services/platform/paths.ts';
import { LaunchSecretStore } from '../services/credentials/secretStore.ts';
import { AppleStoreClientService } from '../services/stores/appleStoreClient.ts';
import { GoogleAccessToken } from '../services/stores/googleAccessToken.ts';
import { GoogleReportingClientService } from '../services/stores/googleReportingClient.ts';
import { pathExists } from '../path-exists.ts';
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
  CustomerReviewResource,
  SalesReportQuery,
} from '../types/appleCatalog.ts';
import type { AccountRecord, ServiceAccount } from '../types/credentials.ts';
import type { PortfolioApp } from '../types/portfolio.ts';
import type { StatsCredentialsFailure } from '../types/stats.ts';
import type { PlayVitalsMetric, VitalsTimeline } from '../types/vitals.ts';

export interface AppStoreStatsClient {
  getSalesReport(query: SalesReportQuery): Promise<Buffer>;
  listAnalyticsReportRequests(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource[]>;
  createAnalyticsReportRequest(
    appId: string,
    accessType: string,
  ): Promise<AnalyticsReportRequestResource>;
  listAnalyticsReports(
    requestId: string,
    filters?: { category?: string; name?: string },
  ): Promise<AnalyticsReportResource[]>;
  listAnalyticsReportInstances(
    reportId: string,
    filters?: { granularity?: string; processingDate?: string },
  ): Promise<AnalyticsReportInstanceResource[]>;
  listAnalyticsReportSegments(instanceId: string): Promise<AnalyticsReportSegmentResource[]>;
  downloadAnalyticsSegment(url: string): Promise<Buffer>;
  listCustomerReviews(
    appId: string,
    filters?: { rating?: number; territory?: string },
  ): Promise<CustomerReviewResource[]>;
}

export interface PlayVitalsReader {
  vitalsTimeline(
    packageName: string,
    metric: PlayVitalsMetric,
    days: number,
  ): Promise<VitalsTimeline>;
}

export interface StatsCredentialsApi {
  ascClientForAccount(accountKeyId: string): Promise<AppStoreStatsClient | null>;
  vendorNumberForAccount(accountKeyId: string): Promise<string | null>;
  googlePackageForApp(app: PortfolioApp): Promise<string | null>;
  playServiceAccount(packageName: string | null): Promise<ServiceAccount | null>;
  playReportingClient(packageName: string | null): Promise<PlayVitalsReader | null>;
  playReportsBucket(): Promise<string | null>;
  googleAccessToken(scopes: readonly string[], packageName: string | null): Promise<string | null>;
}

interface ConfiguredApp {
  readonly bundleId?: string;
  readonly packageName?: string;
}

function makeStatsCredentialsFailure(fields: {
  message: string;
  cause: unknown;
}): StatsCredentialsFailure {
  return { _tag: 'StatsCredentialsFailure', message: fields.message, cause: fields.cause };
}

function createCredentialsFailure(operation: string, cause: unknown): StatsCredentialsFailure {
  return makeStatsCredentialsFailure({
    message: `Could not ${operation}: ${errorMessage(cause)}`,
    cause,
  });
}

function isStatsCredentialsFailure(cause: unknown): cause is StatsCredentialsFailure {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  if ('_tag' in cause == false) {
    return false;
  }

  return cause._tag == 'StatsCredentialsFailure';
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
}

function decodeStoredServiceAccount(storedKey: string): string {
  const decodedKey = Buffer.from(storedKey, 'base64').toString('utf8');
  const isJson = decodedKey.trimStart().startsWith('{');

  if (isJson) {
    return decodedKey;
  }

  return storedKey;
}

async function readSavedServiceAccountKey(packageName: string): Promise<string | null> {
  const storedKey = await LaunchSecretStore.readSecret(`play-service-account:${packageName}`);

  if (storedKey == null) {
    return null;
  }

  if (storedKey == '') {
    return null;
  }

  return decodeStoredServiceAccount(storedKey);
}

function readEnvironmentVendorNumber(): string | null {
  const environmentVendorNumber = readLaunchEnvironment().values.appleVendorNumber;

  if (environmentVendorNumber == null) {
    return null;
  }

  return environmentVendorNumber;
}

async function ascClientForAccount(accountKeyId: string): Promise<AppStoreStatsClient | null> {
  try {
    const ascKey = await loadAscKeyById(accountKeyId);

    if (ascKey == null) {
      return null;
    }

    return AppleStoreClientService.createClient(ascKey);
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('load the App Store Connect key', cause);
  }
}

async function vendorNumberForAccount(accountKeyId: string): Promise<string | null> {
  try {
    const accounts = await listAccounts();

    function hasKeyId(account: AccountRecord): boolean {
      return account.keyId == accountKeyId;
    }

    const account = accounts.find(hasKeyId);

    if (account == null) {
      return readEnvironmentVendorNumber();
    }

    if (account.vendorNumber != null) {
      return account.vendorNumber;
    }

    return readEnvironmentVendorNumber();
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('read the vendor number', cause);
  }
}

function readConfiguredApp(parsed: unknown): ConfiguredApp | null {
  if (isRecord(parsed) == false) {
    return null;
  }

  let expoConfig = parsed['expo'];

  if (isRecord(expoConfig) == false) {
    expoConfig = parsed;
  }

  if (isRecord(expoConfig) == false) {
    return null;
  }

  const ios = expoConfig['ios'];
  const android = expoConfig['android'];
  const configuredApp: { bundleId?: string; packageName?: string } = {};

  if (isRecord(ios)) {
    if (typeof ios['bundleIdentifier'] == 'string') {
      configuredApp.bundleId = ios['bundleIdentifier'];
    }
  }

  if (isRecord(android)) {
    if (typeof android['package'] == 'string') {
      configuredApp.packageName = android['package'];
    }
  }

  return configuredApp;
}

async function readAppsFromWorkingDirectory(
  workingDirectory: string,
): Promise<readonly ConfiguredApp[]> {
  const appFilePath = join(workingDirectory, 'app.json');
  const isAppFilePresent = await pathExists(appFilePath);

  if (isAppFilePresent == false) {
    return [];
  }

  const appText = await readFile(appFilePath, 'utf8');
  const configuredApp = readConfiguredApp(JSON.parse(appText));

  if (configuredApp == null) {
    return [];
  }

  return [configuredApp];
}

function readConfiguredApps(launchConfiguration: unknown): readonly ConfiguredApp[] | null {
  if (isRecord(launchConfiguration) == false) {
    return null;
  }

  if (Array.isArray(launchConfiguration['apps']) == false) {
    return null;
  }

  return launchConfiguration['apps'];
}

async function loadConfiguredApps(workingDirectory: string): Promise<readonly ConfiguredApp[]> {
  const loaded = loadConfig(workingDirectory);
  const isPromise = loaded instanceof Promise;

  if (isPromise) {
    const launchConfiguration = await loaded;
    const configuredApps = readConfiguredApps(launchConfiguration);

    if (configuredApps != null) {
      return configuredApps;
    }
  }

  return readAppsFromWorkingDirectory(workingDirectory);
}

function pickUniquePackageName(
  configuredApps: readonly ConfiguredApp[],
  bundleId: string,
): string | null {
  function matchesBundle(candidate: ConfiguredApp): boolean {
    if (candidate.bundleId != bundleId) {
      return false;
    }

    return candidate.packageName != null;
  }

  const matches = configuredApps.filter(matchesBundle);

  if (matches.length != 1) {
    return null;
  }

  const matched = matches[0];

  if (matched == null) {
    return null;
  }

  if (matched.packageName == null) {
    return null;
  }

  return matched.packageName;
}

async function googlePackageForApp(app: PortfolioApp): Promise<string | null> {
  try {
    if (app.packageName != null) {
      return app.packageName;
    }

    if (app.bundleId == null) {
      return null;
    }

    const workingDirectory = readLaunchDirectories().workingDirectory;
    const configuredApps = await loadConfiguredApps(workingDirectory);

    return pickUniquePackageName(configuredApps, app.bundleId);
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('resolve the app Google credentials', cause);
  }
}

async function playServiceAccount(packageName: string | null): Promise<ServiceAccount | null> {
  try {
    if (packageName == null) {
      return null;
    }

    const savedServiceAccountKey = await readSavedServiceAccountKey(packageName);

    if (savedServiceAccountKey == null) {
      return null;
    }

    return GoogleAccessToken.readServiceAccount(savedServiceAccountKey);
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('read the Play service account', cause);
  }
}

async function playReportingClient(packageName: string | null): Promise<PlayVitalsReader | null> {
  try {
    if (packageName == null) {
      return null;
    }

    const savedServiceAccountKey = await readSavedServiceAccountKey(packageName);

    if (savedServiceAccountKey == null) {
      return null;
    }

    return GoogleReportingClientService.createClient(savedServiceAccountKey);
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('create the Play reporting client', cause);
  }
}

function decodePlayReportsBucket(documentText: string): string | null {
  const parsed: unknown = JSON.parse(documentText);

  if (isRecord(parsed) == false) {
    throw new Error('Portfolio file is not an object.');
  }

  const bucket = parsed['playReportsBucket'];

  if (bucket == null) {
    return null;
  }

  if (typeof bucket != 'string') {
    throw new Error('Play reports bucket is not a string.');
  }

  return bucket;
}

async function playReportsBucket(): Promise<string | null> {
  try {
    return await readDocumentFile(locatePortfolioFilePath(), decodePlayReportsBucket);
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('read the Play reports bucket', cause);
  }
}

async function googleAccessToken(
  scopes: readonly string[],
  packageName: string | null,
): Promise<string | null> {
  try {
    const serviceAccount = await playServiceAccount(packageName);

    if (serviceAccount == null) {
      return null;
    }

    return await GoogleAccessToken.createAccessToken(serviceAccount, scopes);
  } catch (cause) {
    if (isStatsCredentialsFailure(cause)) {
      throw cause;
    }

    throw createCredentialsFailure('get a Google access token', cause);
  }
}

export const StatsCredentialsLive: StatsCredentialsApi = {
  ascClientForAccount,
  vendorNumberForAccount,
  googlePackageForApp,
  playServiceAccount,
  playReportingClient,
  playReportsBucket,
  googleAccessToken,
};

let credentialsFixture: StatsCredentialsApi | null = null;

export function useStatsCredentials(credentials: StatsCredentialsApi | null): void {
  credentialsFixture = credentials;
}

function readActiveCredentials(): StatsCredentialsApi {
  if (credentialsFixture != null) {
    return credentialsFixture;
  }

  return StatsCredentialsLive;
}

export const StatsCredentials: StatsCredentialsApi = {
  ascClientForAccount(accountKeyId) {
    return readActiveCredentials().ascClientForAccount(accountKeyId);
  },
  vendorNumberForAccount(accountKeyId) {
    return readActiveCredentials().vendorNumberForAccount(accountKeyId);
  },
  googlePackageForApp(app) {
    return readActiveCredentials().googlePackageForApp(app);
  },
  playServiceAccount(packageName) {
    return readActiveCredentials().playServiceAccount(packageName);
  },
  playReportingClient(packageName) {
    return readActiveCredentials().playReportingClient(packageName);
  },
  playReportsBucket() {
    return readActiveCredentials().playReportsBucket();
  },
  googleAccessToken(scopes, packageName) {
    return readActiveCredentials().googleAccessToken(scopes, packageName);
  },
};

export function makeStatsCredentialsTest(
  overrides: Partial<StatsCredentialsApi> = {},
): StatsCredentialsApi {
  const credentials: StatsCredentialsApi = {
    async ascClientForAccount() {
      return null;
    },
    async vendorNumberForAccount() {
      return null;
    },
    async googlePackageForApp(app) {
      return app.packageName;
    },
    async playServiceAccount() {
      return null;
    },
    async playReportingClient() {
      return null;
    },
    async playReportsBucket() {
      return null;
    },
    async googleAccessToken() {
      return null;
    },
    ...overrides,
  };

  useStatsCredentials(credentials);

  return credentials;
}
