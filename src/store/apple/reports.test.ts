import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from '../../types/apple-catalog.ts';
import {
  collectAnalyticsSegments,
  decompressReport,
  eachDate,
  ensureAnalyticsRequest,
  parseTsv,
  type AscReportsApi,
} from './reports.ts';

function readThrownMessage(cause: unknown): string | null {
  const isMissing = cause == null;

  if (isMissing) return null;

  const isNotObject = typeof cause != 'object';

  if (isNotObject) return null;

  const fields = Object.entries(cause);

  for (const field of fields) {
    const message = readMessageField(field[0], field[1]);
    const hasMessage = message != null;

    if (hasMessage) return message;
  }

  return null;
}

function readMessageField(fieldName: string | undefined, fieldText: unknown): string | null {
  const isNotMessage = fieldName != 'message';

  if (isNotMessage) return null;

  const isText = typeof fieldText == 'string';

  if (isText) return fieldText;

  return null;
}

function thrownDateMessage(from: string, to: string): string {
  try {
    eachDate(from, to);
  } catch (cause) {
    const message = readThrownMessage(cause);
    const isMissingMessage = message == null;

    if (isMissingMessage) throw new Error('expected a failure');

    return message;
  }

  throw new Error('expected a failure');
}
function describeDecompressReportParseTsv() {
  function decompressesAGzippedTSVAndParsesItIntoHeaderKeyedRows() {
    const tsv = 'Provider\tUnits\tProceeds\nAPPLE\t10\t6.99\nAPPLE\t3\t2.10\n';
    const bufferBytes = Buffer.from(tsv, 'utf8');
    const text = decompressReport(gzipSync(bufferBytes));
    const parsed = parseTsv(text);
    expect(parsed.headers).toEqual(['Provider', 'Units', 'Proceeds']);
    expect(parsed.rows).toEqual([
      { Provider: 'APPLE', Units: '10', Proceeds: '6.99' },
      { Provider: 'APPLE', Units: '3', Proceeds: '2.10' },
    ]);
  }

  it(
    'decompresses a gzipped TSV and parses it into header-keyed rows',
    decompressesAGzippedTSVAndParsesItIntoHeaderKeyedRows,
  );
  function toleratesCRLFEndingsAndPadsShortRowsToEveryHeader() {
    const parsed = parseTsv('A\tB\tC\r\n1\t2\r\n');
    expect(parsed.rows).toEqual([{ A: '1', B: '2', C: '' }]);
  }

  it(
    'tolerates CRLF endings and pads short rows to every header',
    toleratesCRLFEndingsAndPadsShortRowsToEveryHeader,
  );
  function returnsEmptyForAnEmptyReport() {
    const tsv = parseTsv('');
    expect(tsv).toEqual({ headers: [], rows: [] });
  }

  it('returns empty for an empty report', returnsEmptyForAnEmptyReport);
}

describe('decompressReport + parseTsv', describeDecompressReportParseTsv);
function describeEachDate() {
  function yieldsEveryDateInAnInclusiveRange() {
    expect(eachDate('2026-06-01', '2026-06-03')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);
  }

  it('yields every date in an inclusive range', yieldsEveryDateInAnInclusiveRange);
  function yieldsASingleDateWhenFromTo() {
    expect(eachDate('2026-06-01', '2026-06-01')).toEqual(['2026-06-01']);
  }

  it('yields a single date when from == to', yieldsASingleDateWhenFromTo);
  function crossesAMonthBoundaryCorrectly() {
    expect(eachDate('2026-01-31', '2026-02-01')).toEqual(['2026-01-31', '2026-02-01']);
  }

  it('crosses a month boundary correctly', crossesAMonthBoundaryCorrectly);
  function failsOnAnInvertedRangeAMalformedDateAndAnOutOfRangeDate() {
    expect(thrownDateMessage('2026-06-03', '2026-06-01')).toMatch(/before start/);
    expect(thrownDateMessage('nope', '2026-06-01')).toMatch(/Invalid date/);
    expect(thrownDateMessage('2026-6-1', '2026-06-01')).toMatch(/Invalid date/);
    // June has 30 days - 2026-06-31 would silently normalize to July 1 without the round-trip guard.
    expect(thrownDateMessage('2026-06-31', '2026-06-31')).toMatch(/Invalid calendar date/);
  }

  it(
    'fails on an inverted range, a malformed date, and an out-of-range date',
    failsOnAnInvertedRangeAMalformedDateAndAnOutOfRangeDate,
  );
}

describe('eachDate', describeEachDate);
type ReportsApiFixtures = Readonly<{
  appId?: Record<string, string>;
  requests?: AnalyticsReportRequestResource[];
  reports?: Record<string, AnalyticsReportResource[]>;
  instances?: Record<string, AnalyticsReportInstanceResource[]>;
  segments?: Record<string, AnalyticsReportSegmentResource[]>;
}>;

/** Read one optional fixture map and return an empty collection when the key is absent. */
function fixtureEntries<Entry>(
  entriesByParent: Record<string, Entry[]> | undefined,
  parentId: string,
): Entry[] {
  if (entriesByParent == null) return [];
  const entries = entriesByParent[parentId];
  if (entries == null) return [];
  return entries;
}

/** Create a configurable reports API fake backed by parent-id lookup maps. */
function makeApi(fixtures: ReportsApiFixtures): AscReportsApi {
  function mockCall(bundleId: string) {
    if (fixtures.appId == null) return Promise.resolve(null);
    const appId = fixtures.appId[bundleId];
    if (appId == null) return Promise.resolve(null);
    return Promise.resolve(appId);
  }

  function mockCall2() {
    if (fixtures.requests == null) return Promise.resolve([]);
    return Promise.resolve(fixtures.requests);
  }

  function mockCall3(_appId: string, accessType: string) {
    return Promise.resolve({ id: 'new-req', accessType });
  }

  function mockCall4(requestId: string) {
    return Promise.resolve(fixtureEntries(fixtures.reports, requestId));
  }

  function mockCall5(reportId: string) {
    return Promise.resolve(fixtureEntries(fixtures.instances, reportId));
  }

  function mockCall6(instanceId: string) {
    return Promise.resolve(fixtureEntries(fixtures.segments, instanceId));
  }

  return {
    getAppId: vi.fn(mockCall),
    listAnalyticsReportRequests: vi.fn(mockCall2),
    createAnalyticsReportRequest: vi.fn(mockCall3),
    listAnalyticsReports: vi.fn(mockCall4),
    listAnalyticsReportInstances: vi.fn(mockCall5),
    listAnalyticsReportSegments: vi.fn(mockCall6),
  };
}
function describeEnsureAnalyticsRequest() {
  async function reusesAnExistingActiveRequestInsteadOfCreatingOne() {
    const api = makeApi({ requests: [{ id: 'req1', accessType: 'ONGOING' }] });
    const { request, created } = await ensureAnalyticsRequest(api, 'app1', 'ONGOING');
    expect(created).toBe(false);
    expect(request.id).toBe('req1');
    expect(api.createAnalyticsReportRequest).not.toHaveBeenCalled();
  }

  it(
    'reuses an existing active request instead of creating one',
    reusesAnExistingActiveRequestInsteadOfCreatingOne,
  );
  async function skipsARequestStoppedForInactivityAndCreatesAFreshOne() {
    const api = makeApi({
      requests: [{ id: 'stale', accessType: 'ONGOING', stoppedDueToInactivity: true }],
    });
    const { request, created } = await ensureAnalyticsRequest(api, 'app1', 'ONGOING');
    expect(created).toBe(true);
    expect(request.id).toBe('new-req');
  }

  it(
    'skips a request stopped for inactivity and creates a fresh one',
    skipsARequestStoppedForInactivityAndCreatesAFreshOne,
  );
}

describe('ensureAnalyticsRequest', describeEnsureAnalyticsRequest);
function describeCollectAnalyticsSegments() {
  async function throwsAnActionableErrorWhenTheAppPieceIsMissing() {
    const api = makeApi({ appId: {} });
    const analyticsSegments = collectAnalyticsSegments(api, {
      bundleId: 'com.x.missing',
      accessType: 'ONGOING',
      granularity: 'DAILY',
    });
    await expect(analyticsSegments).rejects.toThrow(/No App Store Connect app record/);
  }

  it(
    'throws an actionable error when the app record is missing',
    throwsAnActionableErrorWhenTheAppPieceIsMissing,
  );
  async function signalsAFreshlyCreatedRequestWithNoPieceYet() {
    const api = makeApi({ appId: { 'com.x': 'app1' }, requests: [] });
    const analyticsCollection = await collectAnalyticsSegments(api, {
      bundleId: 'com.x',
      accessType: 'ONGOING',
      granularity: 'DAILY',
    });
    expect(analyticsCollection).toEqual({ requestCreated: true, reportCount: 0, downloads: [] });
  }

  it(
    'signals a freshly-created request with no data yet',
    signalsAFreshlyCreatedRequestWithNoPieceYet,
  );
  async function walksRequestReportsInstancesSegmentsAndFlattensWithPiece() {
    const api = makeApi({
      appId: { 'com.x': 'app1' },
      requests: [{ id: 'req1', accessType: 'ONGOING' }],
      reports: { req1: [{ id: 'rep1', name: 'App Store Installations', category: 'APP_USAGE' }] },
      instances: { rep1: [{ id: 'inst1', granularity: 'DAILY', processingDate: '2026-06-01' }] },
      segments: {
        inst1: [{ id: 'seg1', url: 'https://store.example/seg1.gz', checksum: 'abc' }],
      },
    });
    const analyticsCollection = await collectAnalyticsSegments(api, {
      bundleId: 'com.x',
      accessType: 'ONGOING',
      category: 'APP_USAGE',
      granularity: 'DAILY',
      processingDate: '2026-06-01',
    });
    expect(analyticsCollection.requestCreated).toBe(false);
    expect(analyticsCollection.reportCount).toBe(1);
    expect(analyticsCollection.downloads).toEqual([
      {
        reportName: 'App Store Installations',
        category: 'APP_USAGE',
        granularity: 'DAILY',
        processingDate: '2026-06-01',
        url: 'https://store.example/seg1.gz',
        checksum: 'abc',
      },
    ]);
    expect(api.listAnalyticsReports).toHaveBeenCalledWith('req1', { category: 'APP_USAGE' });
    expect(api.listAnalyticsReportInstances).toHaveBeenCalledWith('rep1', {
      granularity: 'DAILY',
      processingDate: '2026-06-01',
    });
  }

  it(
    'walks request->reports->instances->segments and flattens with context',
    walksRequestReportsInstancesSegmentsAndFlattensWithPiece,
  );
}

describe('collectAnalyticsSegments', describeCollectAnalyticsSegments);
