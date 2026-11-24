// Finds the Google Analytics app stream for an iOS bundle id or Android package name.

import type { PortfolioApp } from '../../types/portfolio.ts';
import {
  ANALYTICS_ADMIN_URL,
  createGa4Failure,
  requestGa4Document,
  type Ga4Session,
} from './ga4-client.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';

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
  readonly fields: string | null;
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

// Analytics Admin list methods document a maximum pageSize of 200.
// https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list
const GA4_ADMIN_PAGE_SIZE_MIN = 1;
const GA4_ADMIN_PAGE_SIZE_MAX = 200;

function clampGa4PageSize(asked: number | null): number {
  if (asked == null) {
    return GA4_ADMIN_PAGE_SIZE_MAX;
  }

  if (asked < GA4_ADMIN_PAGE_SIZE_MIN) {
    return GA4_ADMIN_PAGE_SIZE_MIN;
  }

  if (asked > GA4_ADMIN_PAGE_SIZE_MAX) {
    return GA4_ADMIN_PAGE_SIZE_MAX;
  }

  return asked;
}

function createPageUrl(
  listUrl: string,
  pageSize: number,
  pageToken: string | null,
  fields: string | null,
): string {
  const pageUrl = new URL(listUrl);
  const asString = String(pageSize);

  pageUrl.searchParams.set('pageSize', asString);

  if (pageToken != null) {
    pageUrl.searchParams.set('pageToken', pageToken);
  }

  if (fields != null) {
    pageUrl.searchParams.set('fields', fields);
  }

  return pageUrl.toString();
}

function readNextPageToken(pageDocument: unknown): string | null {
  const pageDocumentObject = readPlainObject(pageDocument);

  if (pageDocumentObject == null) {
    throw new Error('Unreadable Google Analytics page');
  }

  const nextPageToken = pageDocumentObject['nextPageToken'];

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

  const parentObject = readPlainObject(parent);

  if (parentObject == null) {
    throw new Error('Unreadable GA4 data streams');
  }

  const field = parentObject[fieldName];

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
  const streamDocumentObject = readPlainObject(streamDocument);

  if (streamDocumentObject == null) {
    throw new Error('Unreadable GA4 data streams');
  }

  if (typeof streamDocumentObject['name'] != 'string') {
    throw new Error('Unreadable GA4 data streams');
  }

  return {
    name: streamDocumentObject['name'],
    bundleId: readOptionalIdentifier(streamDocumentObject['iosAppStreamData'], 'bundleId'),
    packageName: readOptionalIdentifier(
      streamDocumentObject['androidAppStreamData'],
      'packageName',
    ),
  };
}

function decodeDataStreams(pageDocument: unknown): readonly ReturnType<typeof decodeDataStream>[] {
  const pageDocumentObject = readPlainObject(pageDocument);

  if (pageDocumentObject == null) {
    throw new Error('Unreadable GA4 data streams');
  }

  if (pageDocumentObject['dataStreams'] == null) {
    return [];
  }

  if (Array.isArray(pageDocumentObject['dataStreams']) == false) {
    throw new Error('Unreadable GA4 data streams');
  }

  return pageDocumentObject['dataStreams'].map(decodeDataStream);
}

function decodePropertySummary(propertyDocument: unknown): { property: string } {
  const propertyDocumentObject = readPlainObject(propertyDocument);

  if (propertyDocumentObject == null) {
    throw new Error('Unreadable GA4 account summaries');
  }

  if (typeof propertyDocumentObject['property'] != 'string') {
    throw new Error('Unreadable GA4 account summaries');
  }

  return { property: propertyDocumentObject['property'] };
}

function decodeAccountSummary(summaryDocument: unknown): {
  propertySummaries: readonly { property: string }[];
} {
  const summaryDocumentObject = readPlainObject(summaryDocument);

  if (summaryDocumentObject == null) {
    throw new Error('Unreadable GA4 account summaries');
  }

  if (summaryDocumentObject['propertySummaries'] == null) {
    return { propertySummaries: [] };
  }

  if (Array.isArray(summaryDocumentObject['propertySummaries']) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  return {
    propertySummaries: summaryDocumentObject['propertySummaries'].map(decodePropertySummary),
  };
}

function decodeAccountSummaries(
  pageDocument: unknown,
): readonly { propertySummaries: readonly { property: string }[] }[] {
  const pageDocumentObject = readPlainObject(pageDocument);

  if (pageDocumentObject == null) {
    throw new Error('Unreadable GA4 account summaries');
  }

  if (pageDocumentObject['accountSummaries'] == null) {
    return [];
  }

  if (Array.isArray(pageDocumentObject['accountSummaries']) == false) {
    throw new Error('Unreadable GA4 account summaries');
  }

  return pageDocumentObject['accountSummaries'].map(decodeAccountSummary);
}

async function listPages(
  session: Ga4Session,
  pagedList: PagedList,
  pageToken: string | null,
): Promise<readonly unknown[]> {
  const pageUrl = createPageUrl(pagedList.url, pagedList.pageSize, pageToken, pagedList.fields);
  const pageDocument = await requestGa4Document(session, {
    url: pageUrl,
    requestDocument: null,
    propertyId: pagedList.propertyId,
  });

  try {
    var nextPageToken = readNextPageToken(pageDocument);
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
  pageSize?: number,
  fields: string | null = null,
): Promise<readonly Ga4AppStream[]> {
  let askedPageSize: number | null = null;

  if (pageSize != null) {
    askedPageSize = pageSize;
  }

  const searchPageSize = clampGa4PageSize(askedPageSize);
  const pages = await listPages(
    session,
    {
      url: `${ANALYTICS_ADMIN_URL}/properties/${propertyId}/dataStreams`,
      pageSize: searchPageSize,
      propertyId,
      fields,
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
      const streamFromStream = streamFromDataStream(propertyId, dataStream);
      streams.push(...streamFromStream);
    }
  }

  return streams;
}

async function listPropertyIds(
  session: Ga4Session,
  pageSize: number,
  fields: string | null,
): Promise<readonly string[]> {
  const pages = await listPages(
    session,
    {
      url: `${ANALYTICS_ADMIN_URL}/accountSummaries`,
      pageSize,
      propertyId: null,
      fields,
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
export async function listAllAppStreams(
  session: Ga4Session,
  pageSize?: number,
  fields: string | null = null,
): Promise<readonly Ga4AppStream[]> {
  let askedPageSize: number | null = null;

  if (pageSize != null) {
    askedPageSize = pageSize;
  }

  const searchPageSize = clampGa4PageSize(askedPageSize);
  const propertyIds = await listPropertyIds(session, searchPageSize, fields);

  async function listPropertyStreams(propertyId: string): Promise<readonly Ga4AppStream[]> {
    return listAppStreams(session, propertyId, searchPageSize, fields);
  }

  const streamsPerProperty = await Promise.all(propertyIds.map(listPropertyStreams));

  return streamsPerProperty.flat();
}
