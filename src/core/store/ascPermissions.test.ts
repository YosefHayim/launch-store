import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { makeAppleTransportFailure } from '../services/appleStoreClient.js';
import {
  formatPermissionLine,
  probeKeyPermissions,
  type AscPermissionProbeApi,
  type AscPermissionResult,
} from './ascPermissions.js';

const makePermissionClient = (
  overrides: Partial<AscPermissionProbeApi> = {},
): AscPermissionProbeApi => ({
  listDistributionCertificates: vi.fn(() => Effect.succeed([])),
  listBetaGroups: vi.fn(() => Effect.succeed([])),
  listAppStoreVersions: vi.fn(() => Effect.succeed([])),
  listSubscriptionGroups: vi.fn(() => Effect.succeed([])),
  listCustomerReviews: vi.fn(() => Effect.succeed([])),
  listAnalyticsReportRequests: vi.fn(() => Effect.succeed([])),
  ...overrides,
});

const permissionFor = (
  permissions: readonly AscPermissionResult[],
  feature: string,
): AscPermissionResult => {
  const permission = permissions.find((candidate) => candidate.feature === feature);
  if (!permission) throw new Error(`no permission verdict for ${feature}`);
  return permission;
};

const transportFailure = (message: string, status?: number) => {
  const cause = new Error(message);
  if (status === undefined) return makeAppleTransportFailure({ message, cause });
  return makeAppleTransportFailure({ message, cause, status });
};

describe('probeKeyPermissions', () => {
  it('marks every feature available when all probes succeed', async () => {
    const permissions = await Effect.runPromise(
      probeKeyPermissions(makePermissionClient(), 'app1'),
    );
    expect(permissions).toHaveLength(6);
    expect(permissions.every((permission) => permission.status === 'available')).toBe(true);
  });

  it('flags a 403 as forbidden for just that feature', async () => {
    const permissionClient = makePermissionClient({
      listCustomerReviews: vi.fn(() => Effect.fail(transportFailure('Forbidden', 403))),
    });
    const permissions = await Effect.runPromise(probeKeyPermissions(permissionClient, 'app1'));
    expect(permissionFor(permissions, 'customer-reviews').status).toBe('forbidden');
    expect(permissionFor(permissions, 'testflight').status).toBe('available');
  });

  it('maps a 401 to unauthorized', async () => {
    const permissionClient = makePermissionClient({
      listBetaGroups: vi.fn(() => Effect.fail(transportFailure('Unauthorized', 401))),
    });
    const permissions = await Effect.runPromise(probeKeyPermissions(permissionClient, 'app1'));
    expect(permissionFor(permissions, 'testflight').status).toBe('unauthorized');
  });

  it('maps a transport failure to inconclusive and keeps its message', async () => {
    const permissionClient = makePermissionClient({
      listAppStoreVersions: vi.fn(() => Effect.fail(transportFailure('network down'))),
    });
    const permissions = await Effect.runPromise(probeKeyPermissions(permissionClient, 'app1'));
    const releasePermission = permissionFor(permissions, 'app-store-release');
    expect(releasePermission.status).toBe('inconclusive');
    expect(releasePermission.detail).toBe('network down');
  });

  it('skips app reads without an app record but still runs account reads', async () => {
    const permissionClient = makePermissionClient();
    const permissions = await Effect.runPromise(probeKeyPermissions(permissionClient, null));
    expect(permissionFor(permissions, 'provisioning').status).toBe('available');
    expect(permissionFor(permissions, 'testflight').status).toBe('inconclusive');
    expect(permissionFor(permissions, 'testflight').detail).toBe('no app record to probe');
    expect(permissionClient.listBetaGroups).not.toHaveBeenCalled();
    expect(permissionClient.listDistributionCertificates).toHaveBeenCalledTimes(1);
  });
});

describe('formatPermissionLine', () => {
  const permissionBase = {
    feature: 'x',
    label: 'Feature X',
    roles: ['Admin', 'App Manager'],
  } as const;

  it('renders available with ASCII text', () => {
    expect(formatPermissionLine({ ...permissionBase, status: 'available' })).toBe('OK Feature X');
  });

  it('renders forbidden with the role hint', () => {
    expect(formatPermissionLine({ ...permissionBase, status: 'forbidden' })).toBe(
      'x Feature X - key lacks the role (needs one of: Admin, App Manager)',
    );
  });

  it('renders unauthorized', () => {
    expect(formatPermissionLine({ ...permissionBase, status: 'unauthorized' })).toContain(
      'unauthorized (401)',
    );
  });

  it('renders inconclusive with the detail', () => {
    expect(
      formatPermissionLine({
        ...permissionBase,
        status: 'inconclusive',
        detail: 'no app record to probe',
      }),
    ).toBe("- Feature X - couldn't determine (no app record to probe)");
  });

  it('renders inconclusive without a detail', () => {
    expect(formatPermissionLine({ ...permissionBase, status: 'inconclusive' })).toBe(
      "- Feature X - couldn't determine",
    );
  });
});
