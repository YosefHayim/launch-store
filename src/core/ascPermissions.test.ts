import { describe, expect, it, vi } from 'vitest';
import { AscRequestError } from '../apple/ascClient.js';
import {
  formatPermissionLine,
  probeKeyPermissions,
  type AscPermissionProbeApi,
  type AscPermissionResult,
} from './ascPermissions.js';

/** A probe API where every read resolves (a full-access key); override one to simulate a role gap. */
function makeApi(overrides: Partial<AscPermissionProbeApi> = {}): AscPermissionProbeApi {
  return {
    listDistributionCertificates: vi.fn().mockResolvedValue([]),
    listBetaGroups: vi.fn().mockResolvedValue([]),
    listAppStoreVersions: vi.fn().mockResolvedValue([]),
    listSubscriptionGroups: vi.fn().mockResolvedValue([]),
    listCustomerReviews: vi.fn().mockResolvedValue([]),
    listAnalyticsReportRequests: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/** Pick the verdict for one feature, failing loudly if the probe set didn't produce it. */
function byFeature(results: AscPermissionResult[], feature: string): AscPermissionResult {
  const found = results.find((result) => result.feature === feature);
  if (!found) throw new Error(`no result for ${feature}`);
  return found;
}

describe('probeKeyPermissions', () => {
  it('marks every feature available when all probes resolve', async () => {
    const results = await probeKeyPermissions(makeApi(), 'app1');
    expect(results).toHaveLength(6);
    expect(results.every((result) => result.status === 'available')).toBe(true);
  });

  it('flags a 403 as forbidden for just that feature, leaving the rest available', async () => {
    const api = makeApi({
      listCustomerReviews: vi.fn().mockRejectedValue(new AscRequestError('Forbidden', 403)),
    });
    const results = await probeKeyPermissions(api, 'app1');
    expect(byFeature(results, 'customer-reviews').status).toBe('forbidden');
    expect(byFeature(results, 'testflight').status).toBe('available');
  });

  it('maps a 401 to unauthorized', async () => {
    const api = makeApi({
      listBetaGroups: vi.fn().mockRejectedValue(new AscRequestError('Unauthorized', 401)),
    });
    const results = await probeKeyPermissions(api, 'app1');
    expect(byFeature(results, 'testflight').status).toBe('unauthorized');
  });

  it('maps a non-HTTP failure to inconclusive, preserving the error message', async () => {
    const api = makeApi({
      listAppStoreVersions: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const release = byFeature(await probeKeyPermissions(api, 'app1'), 'app-store-release');
    expect(release.status).toBe('inconclusive');
    expect(release.detail).toBe('network down');
  });

  it('skips app-scoped probes (inconclusive) without an app record, but still runs account-wide ones', async () => {
    const api = makeApi();
    const results = await probeKeyPermissions(api, null);
    expect(byFeature(results, 'provisioning').status).toBe('available');
    expect(byFeature(results, 'testflight').status).toBe('inconclusive');
    expect(byFeature(results, 'testflight').detail).toBe('no app record to probe');
    expect(api.listBetaGroups).not.toHaveBeenCalled();
    expect(api.listDistributionCertificates).toHaveBeenCalledTimes(1);
  });
});

describe('formatPermissionLine', () => {
  const base = { feature: 'x', label: 'Feature X', roles: ['Admin', 'App Manager'] } as const;

  it('renders available with a check', () => {
    expect(formatPermissionLine({ ...base, status: 'available' })).toBe('✓ Feature X');
  });

  it('renders forbidden with the role hint', () => {
    expect(formatPermissionLine({ ...base, status: 'forbidden' })).toBe(
      '✗ Feature X — key lacks the role (needs one of: Admin, App Manager)',
    );
  });

  it('renders unauthorized', () => {
    expect(formatPermissionLine({ ...base, status: 'unauthorized' })).toContain(
      'unauthorized (401)',
    );
  });

  it('renders inconclusive with the detail', () => {
    expect(
      formatPermissionLine({ ...base, status: 'inconclusive', detail: 'no app record to probe' }),
    ).toBe("• Feature X — couldn't determine (no app record to probe)");
  });

  it('renders inconclusive without a detail', () => {
    expect(formatPermissionLine({ ...base, status: 'inconclusive' })).toBe(
      "• Feature X — couldn't determine",
    );
  });
});
