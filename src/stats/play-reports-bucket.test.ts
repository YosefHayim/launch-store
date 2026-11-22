import { describe, expect, test } from 'vitest';
import { parsePlayReportsBucket } from './play-reports-bucket.ts';

describe('parsePlayReportsBucket', () => {
  test('reads a bare bucket name', () => {
    const playReportsBucket = parsePlayReportsBucket('pubsite_prod_rev_0123456789');
    expect(playReportsBucket).toBe('pubsite_prod_rev_0123456789');
    expect(parsePlayReportsBucket('pubsite_prod_0123456789')).toBe('pubsite_prod_0123456789');
  });

  test('strips the gs:// prefix, the trailing slash and surrounding spaces', () => {
    const playReportsBucket = parsePlayReportsBucket('  gs://pubsite_prod_rev_123/  ');
    expect(playReportsBucket).toBe('pubsite_prod_rev_123');
  });

  test('keeps only the bucket when the URI continues with a folder', () => {
    const playReportsBucket = parsePlayReportsBucket('gs://pubsite_prod_123/stats/installs');
    expect(playReportsBucket).toBe('pubsite_prod_123');
  });

  test('returns null for text that is not a Play reports bucket', () => {
    const playReportsBucket = parsePlayReportsBucket('');
    expect(playReportsBucket).toBeNull();
    expect(parsePlayReportsBucket('gs://my-own-bucket/')).toBeNull();
    expect(parsePlayReportsBucket('pubsite_prod_rev_abc')).toBeNull();
  });
});
