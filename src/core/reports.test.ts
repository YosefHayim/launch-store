import { describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type {
  AnalyticsReportInstanceResource,
  AnalyticsReportRequestResource,
  AnalyticsReportResource,
  AnalyticsReportSegmentResource,
} from '../apple/ascClient.js';
import {
  collectAnalyticsSegments,
  decompressReport,
  eachDate,
  ensureAnalyticsRequest,
  parseTsv,
  type AscReportsApi,
} from './reports.js';

describe('decompressReport + parseTsv', () => {
  it('decompresses a gzipped TSV and parses it into header-keyed rows', () => {
    const tsv = 'Provider\tUnits\tProceeds\nAPPLE\t10\t6.99\nAPPLE\t3\t2.10\n';
    const text = decompressReport(gzipSync(Buffer.from(tsv, 'utf8')));
    const parsed = parseTsv(text);
    expect(parsed.headers).toEqual(['Provider', 'Units', 'Proceeds']);
    expect(parsed.rows).toEqual([
      { Provider: 'APPLE', Units: '10', Proceeds: '6.99' },
      { Provider: 'APPLE', Units: '3', Proceeds: '2.10' },
    ]);
  });

  it('tolerates CRLF endings and pads short rows to every header', () => {
    const parsed = parseTsv('A\tB\tC\r\n1\t2\r\n');
    expect(parsed.rows).toEqual([{ A: '1', B: '2', C: '' }]);
  });

  it('returns empty for an empty report', () => {
    expect(parseTsv('')).toEqual({ headers: [], rows: [] });
  });
});

describe('eachDate', () => {
  it('yields every date in an inclusive range', () => {
    expect(eachDate('2026-06-01', '2026-06-03')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
    ]);
  });

  it('yields a single date when from === to', () => {
    expect(eachDate('2026-06-01', '2026-06-01')).toEqual(['2026-06-01']);
  });

  it('crosses a month boundary correctly', () => {
    expect(eachDate('2026-01-31', '2026-02-01')).toEqual(['2026-01-31', '2026-02-01']);
  });

  it('throws on an inverted range, a malformed date, and an out-of-range (normalized) date', () => {
    expect(() => eachDate('2026-06-03', '2026-06-01')).toThrow(/before start/);
    expect(() => eachDate('nope', '2026-06-01')).toThrow(/Invalid date/);
    expect(() => eachDate('2026-6-1', '2026-06-01')).toThrow(/Invalid date/);
    // June has 30 days — 2026-06-31 would silently normalize to July 1 without the round-trip guard.
    expect(() => eachDate('2026-06-31', '2026-06-31')).toThrow(/Invalid calendar date/);
  });
});

/** A configurable {@link AscReportsApi} fake backed by simple lookup maps keyed by parent id. */
function makeApi(opts: {
  appId?: Record<string, string>;
  requests?: AnalyticsReportRequestResource[];
  reports?: Record<string, AnalyticsReportResource[]>;
  instances?: Record<string, AnalyticsReportInstanceResource[]>;
  segments?: Record<string, AnalyticsReportSegmentResource[]>;
}): AscReportsApi {
  return {
    getAppId: vi.fn((bundleId: string) => Promise.resolve(opts.appId?.[bundleId] ?? null)),
    listAnalyticsReportRequests: vi.fn(() => Promise.resolve(opts.requests ?? [])),
    createAnalyticsReportRequest: vi.fn((_appId: string, accessType: string) =>
      Promise.resolve({ id: 'new-req', accessType }),
    ),
    listAnalyticsReports: vi.fn((requestId: string) =>
      Promise.resolve(opts.reports?.[requestId] ?? []),
    ),
    listAnalyticsReportInstances: vi.fn((reportId: string) =>
      Promise.resolve(opts.instances?.[reportId] ?? []),
    ),
    listAnalyticsReportSegments: vi.fn((instanceId: string) =>
      Promise.resolve(opts.segments?.[instanceId] ?? []),
    ),
  };
}

describe('ensureAnalyticsRequest', () => {
  it('reuses an existing active request instead of creating one', async () => {
    const api = makeApi({ requests: [{ id: 'req1', accessType: 'ONGOING' }] });
    const { request, created } = await ensureAnalyticsRequest(api, 'app1', 'ONGOING');
    expect(created).toBe(false);
    expect(request.id).toBe('req1');
    expect(api.createAnalyticsReportRequest).not.toHaveBeenCalled();
  });

  it('skips a request stopped for inactivity and creates a fresh one', async () => {
    const api = makeApi({
      requests: [{ id: 'stale', accessType: 'ONGOING', stoppedDueToInactivity: true }],
    });
    const { request, created } = await ensureAnalyticsRequest(api, 'app1', 'ONGOING');
    expect(created).toBe(true);
    expect(request.id).toBe('new-req');
  });
});

describe('collectAnalyticsSegments', () => {
  it('throws an actionable error when the app record is missing', async () => {
    const api = makeApi({ appId: {} });
    await expect(
      collectAnalyticsSegments(api, {
        bundleId: 'com.x.missing',
        accessType: 'ONGOING',
        granularity: 'DAILY',
      }),
    ).rejects.toThrow(/No App Store Connect app record/);
  });

  it('signals a freshly-created request with no data yet', async () => {
    const api = makeApi({ appId: { 'com.x': 'app1' }, requests: [] });
    const result = await collectAnalyticsSegments(api, {
      bundleId: 'com.x',
      accessType: 'ONGOING',
      granularity: 'DAILY',
    });
    expect(result).toEqual({ requestCreated: true, reportCount: 0, downloads: [] });
  });

  it('walks request→reports→instances→segments and flattens with context', async () => {
    const api = makeApi({
      appId: { 'com.x': 'app1' },
      requests: [{ id: 'req1', accessType: 'ONGOING' }],
      reports: { req1: [{ id: 'rep1', name: 'App Store Installations', category: 'APP_USAGE' }] },
      instances: { rep1: [{ id: 'inst1', granularity: 'DAILY', processingDate: '2026-06-01' }] },
      segments: {
        inst1: [{ id: 'seg1', url: 'https://store.example/seg1.gz', checksum: 'abc' }],
      },
    });
    const result = await collectAnalyticsSegments(api, {
      bundleId: 'com.x',
      accessType: 'ONGOING',
      category: 'APP_USAGE',
      granularity: 'DAILY',
      processingDate: '2026-06-01',
    });
    expect(result.requestCreated).toBe(false);
    expect(result.reportCount).toBe(1);
    expect(result.downloads).toEqual([
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
  });
});
