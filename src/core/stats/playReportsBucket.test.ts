import { describe, expect, test } from 'vitest';
import { parsePlayReportsBucket } from './playReportsBucket.js';

describe('parsePlayReportsBucket', () => {
  test('reads a bare bucket name', () => {
    expect(parsePlayReportsBucket('pubsite_prod_rev_0123456789')).toBe(
      'pubsite_prod_rev_0123456789',
    );
    expect(parsePlayReportsBucket('pubsite_prod_0123456789')).toBe('pubsite_prod_0123456789');
  });

  test('strips the gs:// prefix, the trailing slash and surrounding spaces', () => {
    expect(parsePlayReportsBucket('  gs://pubsite_prod_rev_123/  ')).toBe('pubsite_prod_rev_123');
  });

  test('keeps only the bucket when the URI continues with a folder', () => {
    expect(parsePlayReportsBucket('gs://pubsite_prod_123/stats/installs')).toBe('pubsite_prod_123');
  });

  test('returns null for text that is not a Play reports bucket', () => {
    expect(parsePlayReportsBucket('')).toBeNull();
    expect(parsePlayReportsBucket('gs://my-own-bucket/')).toBeNull();
    expect(parsePlayReportsBucket('pubsite_prod_rev_abc')).toBeNull();
  });
});
