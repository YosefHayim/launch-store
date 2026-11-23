import { errorMessage } from '@/services/platform/error-message.js';
import type { PortfolioApp } from '@/types/portfolio.js';
import type { DateRange, FeedFetchReply, StatsFeedFailure } from '@/types/stats.js';
import type { StatsCredentialsApi } from '../stats-credentials.ts';
import { isGa4SkipSignal, readProjectIdFromClientEmail, type Ga4Session } from './ga4-client.ts';
import { loadGa4Report } from './ga4-report.ts';
import { findAppStream, listAllAppStreams, listAppStreams } from './ga4-streams.ts';

interface Ga4Target {
  readonly propertyId: string;
  readonly streamId: string | null;
}

interface Ga4FetchRequest {
  readonly app: PortfolioApp;
  readonly range: DateRange;
  readonly credentials: StatsCredentialsApi;
}

function createCredentialsFailure(app: PortfolioApp, cause: unknown): StatsFeedFailure {
  return {
    _tag: 'StatsFeedFailure',
    feed: 'ga4',
    appKey: app.key,
    message: `Could not read the Google credentials: ${errorMessage(cause)}`,
    cause,
  };
}

function createWholePropertyNotes(target: Ga4Target): readonly string[] {
  if (target.streamId != null) {
    return [];
  }

  return [
    `GA4 property ${target.propertyId} has no stream for this app, so the numbers cover the whole property`,
  ];
}

function readIosBundle(app: PortfolioApp): string | null {
  if (app.platform != 'ios') {
    return null;
  }

  return app.bundleId;
}

function readAndroidPackage(app: PortfolioApp): string | null {
  if (app.platform != 'android') {
    return null;
  }

  return app.packageName;
}

function readStoreIdentifier(app: PortfolioApp): string {
  const bundleId = readIosBundle(app);

  if (bundleId != null) {
    return bundleId;
  }

  const packageName = readAndroidPackage(app);

  if (packageName != null) {
    return packageName;
  }

  return app.key;
}

function createNoPropertyReason(app: PortfolioApp): string {
  return `No GA4 property with a stream for ${readStoreIdentifier(app)}; tag one with launch-store apps tag --app ${app.name} --ga4-property <id>`;
}

async function readPackageName(request: Ga4FetchRequest): Promise<string | null> {
  try {
    return await request.credentials.googlePackageForApp(request.app);
  } catch (cause) {
    throw createCredentialsFailure(request.app, cause);
  }
}

async function readAccessToken(
  request: Ga4FetchRequest,
  packageName: string | null,
): Promise<string | null> {
  try {
    return await request.credentials.googleAccessToken(
      ['https://www.googleapis.com/auth/analytics.readonly'],
      packageName,
    );
  } catch (cause) {
    throw createCredentialsFailure(request.app, cause);
  }
}

async function readProjectId(
  request: Ga4FetchRequest,
  packageName: string | null,
): Promise<string | null> {
  try {
    var serviceAccount = await request.credentials.playServiceAccount(packageName);
  } catch (cause) {
    throw createCredentialsFailure(request.app, cause);
  }

  if (serviceAccount == null) {
    return null;
  }

  return readProjectIdFromClientEmail(serviceAccount.clientEmail);
}

async function findTaggedTarget(
  session: Ga4Session,
  app: PortfolioApp,
  propertyId: string,
): Promise<Ga4Target> {
  const propertyStreams = await listAppStreams(session, propertyId);
  const taggedStream = findAppStream(app, propertyStreams);

  if (taggedStream == null) {
    return { propertyId, streamId: null };
  }

  return { propertyId, streamId: taggedStream.streamId };
}

async function findTarget(session: Ga4Session, app: PortfolioApp): Promise<Ga4Target | null> {
  if (app.ga4PropertyId != null) {
    return findTaggedTarget(session, app, app.ga4PropertyId);
  }

  const catalog = await listAllAppStreams(session);
  const foundStream = findAppStream(app, catalog);

  if (foundStream == null) {
    return null;
  }

  return { propertyId: foundStream.propertyId, streamId: foundStream.streamId };
}

async function fetchWithSession(
  session: Ga4Session,
  app: PortfolioApp,
  range: DateRange,
): Promise<FeedFetchReply> {
  const target = await findTarget(session, app);

  if (target == null) {
    return { status: 'skipped', reason: createNoPropertyReason(app) };
  }

  const stats = await loadGa4Report(session, {
    propertyId: target.propertyId,
    streamId: target.streamId,
    range,
  });

  return {
    status: 'fetched',
    stats,
    coveredThrough: range.to,
    notes: createWholePropertyNotes(target),
  };
}

function isGa4Applicable(): boolean {
  return true;
}

async function fetchGa4Days(request: Ga4FetchRequest): Promise<FeedFetchReply> {
  const packageName = await readPackageName(request);
  const accessToken = await readAccessToken(request, packageName);

  if (accessToken == null) {
    return {
      status: 'skipped',
      reason: 'No Google service account saved; add one with launch-store credentials',
    };
  }

  const projectId = await readProjectId(request, packageName);
  const session = { appKey: request.app.key, accessToken, projectId };

  try {
    return await fetchWithSession(session, request.app, request.range);
  } catch (cause) {
    if (isGa4SkipSignal(cause)) {
      return { status: 'skipped', reason: cause.reason };
    }

    throw cause;
  }
}

export const ga4Feed = {
  feed: 'ga4' as const,
  isApplicable: isGa4Applicable,
  fetchDays: fetchGa4Days,
};
