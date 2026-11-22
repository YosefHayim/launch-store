import type { PortfolioApp } from '../../types/portfolio.ts';
import {
  ANALYTICS_ADMIN_URL,
  createGa4Failure,
  requestGa4Document,
  type Ga4Session,
} from './ga4-client.ts';

interface Ga4AppStream {
  readonly propertyId: string;
  readonly streamId: string;
  readonly bundleId: string | null;
  readonly packageName: string | null;
}

interface PagedList {
  readonly url: string;
  readonly pageSize: number;
  readonly propertyId: string | null;
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  return typeof candidate == 'object';
}

function readIdAfterSegment(resourceName: string, segment: string): string | null {
  const nameParts = resourceName.split('/');
  const segmentIndex = nameParts.indexOf(segment);

  if (segmentIndex == -1) {
    return null;
  }

  const idPart = nameParts[segmentIndex + 1];

  if (idPart == null) {
    return null;
  }

  return idPart;
}

function hasSameBundle(app: PortfolioApp, stream: Ga4AppStream): boolean {
  if (app.bundleId == null) {
    return false;
  }

  return stream.bundleId == app.bundleId;
}

function hasSamePackage(app: PortfolioApp, stream: Ga4AppStream): boolean {
  if (app.packageName == null) {
    return false;
  }

  return stream.packageName == app.packageName;
}

/** An app matches a stream by iOS bundle id or Android package name. */
export function findAppStream(
  app: PortfolioApp,
  streams: readonly Ga4AppStream[],
): Ga4AppStream | null {
  function streamMatches(stream: Ga4AppStream): boolean {
    if (hasSameBundle(app, stream)) {
      return true;
    }

    return hasSamePackage(app, stream);
  }

  const appStream = streams.find(streamMatches);

  if (appStream == null) {
    return null;
  }

  return appStream;
}

function createPageUrl(listUrl: string, pageSize: number, pageToken: string | null): string {
  const pageUrl = new URL(listUrl);
  pageUrl.searchParams.set('pageSize', String(pageSize));

  if (pageToken != null) {
    pageUrl.searchParams.set('pageToken', pageToken);
  }

  return pageUrl.toString();
}

function readNextPageToken(pageDocument: unknown): string | null {
  if (isRecord(pageDocument) == false) {
    throw new Error('Unreadable Google Analytics page');
  }

  const nextPageToken = pageDocument['nextPageToken'];

  if (nextPageToken == null) {
    return null;
  }

  if (nextPageToken == '') {
    return null;
  }

  if (typeof nextPageToken != 'string') {
    throw new Error('Unreadable Google Analytics page');
  }

  return nextPageToken;
}

function readOptionalIdentifier(parent: unknown, fieldName: string): string | null {
  if (parent == null) {
    return null;
  }

  if (isRecord(parent) == false) {
    throw new Error('Unreadable GA4 data streams');
  }

  const field = parent[fieldName];

  if (field == null) {
    return null;
  }

  if (typeof field != 'string') {
    throw new Error('Unreadable GA4 data streams');
  }

  return field;
}

function decodeDataStream(streamDocument: unknown): {
  name: string;
  bundleId: string | null;
  packageName: string | null;
} {
  if (isRecord(streamDocument) == false) {
    throw new Error('Unreadable GA4 data streams');
  }

  if (typeof streamDocument['name'] != 'string') {
    throw new Error('Unreadable GA4 data streams');
  }

  return {
    name: streamDocument['name'],
    bundleId: readOptionalIdentifier(streamDocument['iosAppStreamData'], 'bundleId'),
    packageName: readOptionalIdentifier(streamDocument['androidAppStreamData'], 'packageName'),
  };
}

function decodeDataStreams(pageDocument: unknown): readonly ReturnType<typeof decodeDataStream>[] {
  if (isRecord(pageDocument) == false) {
    throw new Error('Unreadable GA4 data streams');
  }

  if (pageDocument['dataStreams'] == null) {
    return [];
  }

  if (Array.isArray(pageDocument['dataStreams']) == false) {
    throw new Error('Unreadable GA4 data streams');
  }

  return pageDocument['dataStreams'].map(decodeDataStream);
}

function decodePropertySummary(propertyDocument: unknown): { property: string } {
  if (isRecord(propertyDocument) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  if (typeof propertyDocument['property'] != 'string') {
    throw new Error('Unreadable GA4 account summaries');
  }

  return { property: propertyDocument['property'] };
}

function decodeAccountSummary(summaryDocument: unknown): {
  propertySummaries: readonly { property: string }[];
} {
  if (isRecord(summaryDocument) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  if (summaryDocument['propertySummaries'] == null) {
    return { propertySummaries: [] };
  }

  if (Array.isArray(summaryDocument['propertySummaries']) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  return { propertySummaries: summaryDocument['propertySummaries'].map(decodePropertySummary) };
}

function decodeAccountSummaries(
  pageDocument: unknown,
): readonly { propertySummaries: readonly { property: string }[] }[] {
  if (isRecord(pageDocument) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  if (pageDocument['accountSummaries'] == null) {
    return [];
  }

  if (Array.isArray(pageDocument['accountSummaries']) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  return pageDocument['accountSummaries'].map(decodeAccountSummary);
}

async function listPages(
  session: Ga4Session,
  pagedList: PagedList,
  pageToken: string | null,
): Promise<readonly unknown[]> {
  const pageDocument = await requestGa4Document(session, {
    url: createPageUrl(pagedList.url, pagedList.pageSize, pageToken),
    requestDocument: null,
    propertyId: pagedList.propertyId,
  });

  let nextPageToken: string | null;

  try {
    nextPageToken = readNextPageToken(pageDocument);
  } catch (cause) {
    throw createGa4Failure(session, 'Unreadable Google Analytics page', cause);
  }

  if (nextPageToken == null) {
    return [pageDocument];
  }

  const laterPages = await listPages(session, pagedList, nextPageToken);

  return [pageDocument, ...laterPages];
}

function isMobileStream(dataStream: ReturnType<typeof decodeDataStream>): boolean {
  if (dataStream.bundleId != null) {
    return true;
  }

  return dataStream.packageName != null;
}

function streamFromDataStream(
  propertyId: string,
  dataStream: ReturnType<typeof decodeDataStream>,
): Ga4AppStream[] {
  const streamId = readIdAfterSegment(dataStream.name, 'dataStreams');

  if (streamId == null) {
    return [];
  }

  if (isMobileStream(dataStream) == false) {
    return [];
  }

  return [
    { propertyId, streamId, bundleId: dataStream.bundleId, packageName: dataStream.packageName },
  ];
}

/** The app streams (iOS or Android) of one property. */
export async function listAppStreams(
  session: Ga4Session,
  propertyId: string,
): Promise<readonly Ga4AppStream[]> {
  const pages = await listPages(
    session,
    {
      url: `${ANALYTICS_ADMIN_URL}/properties/${propertyId}/dataStreams`,
      pageSize: 200,
      propertyId,
    },
    null,
  );
  const streams: Ga4AppStream[] = [];

  for (const page of pages) {
    let decodedStreams: ReturnType<typeof decodeDataStreams>;

    try {
      decodedStreams = decodeDataStreams(page);
    } catch (cause) {
      throw createGa4Failure(session, 'Unreadable GA4 data streams', cause);
    }

    for (const dataStream of decodedStreams) {
      streams.push(...streamFromDataStream(propertyId, dataStream));
    }
  }

  return streams;
}

async function listPropertyIds(session: Ga4Session): Promise<readonly string[]> {
  const pages = await listPages(
    session,
    {
      url: `${ANALYTICS_ADMIN_URL}/accountSummaries`,
      pageSize: 200,
      propertyId: null,
    },
    null,
  );
  const propertyIds: string[] = [];

  for (const page of pages) {
    let summaries: ReturnType<typeof decodeAccountSummaries>;

    try {
      summaries = decodeAccountSummaries(page);
    } catch (cause) {
      throw createGa4Failure(session, 'Unreadable GA4 account summaries', cause);
    }

    for (const accountSummary of summaries) {
      for (const propertySummary of accountSummary.propertySummaries) {
        const propertyId = readIdAfterSegment(propertySummary.property, 'properties');

        if (propertyId != null) {
          propertyIds.push(propertyId);
        }
      }
    }
  }

  return propertyIds;
}

/** Every app stream of every property the service account can see. */
export async function listAllAppStreams(session: Ga4Session): Promise<readonly Ga4AppStream[]> {
  const propertyIds = await listPropertyIds(session);

  async function listPropertyStreams(propertyId: string): Promise<readonly Ga4AppStream[]> {
    return listAppStreams(session, propertyId);
  }

  const streamsPerProperty = await Promise.all(propertyIds.map(listPropertyStreams));

  return streamsPerProperty.flat();
}
