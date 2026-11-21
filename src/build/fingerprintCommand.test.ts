import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  type FingerprintReport,
  FingerprintCommandInputSchema,
  formatFingerprintReport,
} from './fingerprintCommand.js';

const INCREMENTAL_REPORT: FingerprintReport = {
  app: 'demo',
  platform: 'ios',
  current: 'abcdef0123456789abcdef',
  stored: {
    fingerprint: 'abcdef0123456789abcdef',
    builtAt: '2026-06-13T10:00:00.000Z',
    cleanBuilt: true,
  },
  decision: { clean: false, nativeChanged: false, reason: 'cache warm - incremental' },
};

describe('FingerprintCommandInputSchema', () => {
  it('decodes the Commander input shape', () => {
    expect(Schema.decodeUnknownSync(FingerprintCommandInputSchema)({ json: false })).toEqual({
      json: false,
    });
    expect(
      Schema.decodeUnknownSync(FingerprintCommandInputSchema)({ app: 'demo', json: true }),
    ).toEqual({ app: 'demo', json: true });
  });
});

describe('formatFingerprintReport', () => {
  it('shows an incremental decision and prior build', () => {
    const reportText = formatFingerprintReport(INCREMENTAL_REPORT);
    expect(reportText).toContain('demo (ios)');
    expect(reportText).toContain('Current fingerprint: abcdef012345');
    expect(reportText).toContain('2026-06-13T10:00:00.000Z, clean');
    expect(reportText).toContain('incremental (reuses warm caches) - cache warm - incremental');
  });

  it('shows a cold host clean decision', () => {
    const reportText = formatFingerprintReport({
      ...INCREMENTAL_REPORT,
      stored: null,
      decision: { clean: true, nativeChanged: true, reason: 'first build on this host' },
    });
    expect(reportText).toContain('Last build:          none on this host yet');
    expect(reportText).toContain('clean (from scratch) - first build on this host');
  });
});
