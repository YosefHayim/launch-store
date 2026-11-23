import { describe, expect, it, vi } from 'vitest';
import { makeAppleTransportFailure } from '@/services/stores/apple-store-client.js';
import {
  formatPermissionLine,
  probeKeyPermissions,
  type AscPermissionProbeApi,
  type AscPermissionResult,
} from './asc-permissions.ts';

function mockCall() {
  return Promise.resolve([]);
}

function mockCall2() {
  return Promise.resolve([]);
}

function mockCall3() {
  return Promise.resolve([]);
}

function mockCall4() {
  return Promise.resolve([]);
}

function mockCall5() {
  return Promise.resolve([]);
}

function mockCall6() {
  return Promise.resolve([]);
}

function makePermissionClient(
  overrides: Partial<AscPermissionProbeApi> = {},
): AscPermissionProbeApi {
  return {
    listDistributionCertificates: vi.fn(mockCall),
    listBetaGroups: vi.fn(mockCall2),
    listAppStoreVersions: vi.fn(mockCall3),
    listSubscriptionGroups: vi.fn(mockCall4),
    listCustomerReviews: vi.fn(mockCall5),
    listAnalyticsReportRequests: vi.fn(mockCall6),
    ...overrides,
  };
}

function permissionFor(
  permissions: readonly AscPermissionResult[],
  feature: string,
): AscPermissionResult {
  function isRequestedFeature(candidate: {
    readonly feature: string;
    readonly label: string;
    readonly roles: readonly string[];
    readonly status: 'available' | 'forbidden' | 'unauthorized' | 'inconclusive';
    readonly detail?: string;
  }) {
    return candidate.feature == feature;
  }

  const permission = permissions.find(isRequestedFeature);

  if (!permission) throw new Error(`no permission verdict for ${feature}`);

  return permission;
}

function transportFailure(message: string, status?: number) {
  const cause = new Error(message);

  if (status == null) return makeAppleTransportFailure({ message, cause });

  return makeAppleTransportFailure({ message, cause, status });
}

function describeProbeKeyPermissions() {
  async function marksEveryFeatureAvailableWhenAllProbesSucceed() {
    const permissionClient = makePermissionClient();
    const permissions = await probeKeyPermissions(permissionClient, 'app1');

    expect(permissions).toHaveLength(6);

    function isAvailablePermission(permission: {
      readonly feature: string;
      readonly label: string;
      readonly roles: readonly string[];
      readonly status: 'available' | 'forbidden' | 'unauthorized' | 'inconclusive';
      readonly detail?: string;
    }) {
      return permission.status == 'available';
    }

    expect(permissions.every(isAvailablePermission)).toBe(true);
  }

  it(
    'marks every feature available when all probes succeed',
    marksEveryFeatureAvailableWhenAllProbesSucceed,
  );

  async function flagsA403AsForbiddenForJustThatFeature() {
    function mockCall7() {
      return Promise.reject(transportFailure('Forbidden', 403));
    }

    const permissionClient = makePermissionClient({
      listCustomerReviews: vi.fn(mockCall7),
    });
    const permissions = await probeKeyPermissions(permissionClient, 'app1');

    expect(permissionFor(permissions, 'customer-reviews').status).toBe('forbidden');
    expect(permissionFor(permissions, 'testflight').status).toBe('available');
  }

  it('flags a 403 as forbidden for just that feature', flagsA403AsForbiddenForJustThatFeature);

  async function mapsA401ToUnauthorized() {
    function mockCall8() {
      return Promise.reject(transportFailure('Unauthorized', 401));
    }

    const permissionClient = makePermissionClient({
      listBetaGroups: vi.fn(mockCall8),
    });
    const permissions = await probeKeyPermissions(permissionClient, 'app1');

    expect(permissionFor(permissions, 'testflight').status).toBe('unauthorized');
  }

  it('maps a 401 to unauthorized', mapsA401ToUnauthorized);

  async function mapsATransportFailureToInconclusiveAndKeepsItsMessage() {
    function mockCall9() {
      return Promise.reject(transportFailure('network down'));
    }

    const permissionClient = makePermissionClient({
      listAppStoreVersions: vi.fn(mockCall9),
    });
    const permissions = await probeKeyPermissions(permissionClient, 'app1');
    const releasePermission = permissionFor(permissions, 'app-store-release');

    expect(releasePermission.status).toBe('inconclusive');
    expect(releasePermission.detail).toBe('network down');
  }

  it(
    'maps a transport failure to inconclusive and keeps its message',
    mapsATransportFailureToInconclusiveAndKeepsItsMessage,
  );

  async function skipsAppReadsWithoutAnAppPieceButStillRunsAccountReads() {
    const permissionClient = makePermissionClient();
    const permissions = await probeKeyPermissions(permissionClient, null);

    expect(permissionFor(permissions, 'provisioning').status).toBe('available');
    expect(permissionFor(permissions, 'testflight').status).toBe('inconclusive');
    expect(permissionFor(permissions, 'testflight').detail).toBe('no app record to probe');
    expect(permissionClient.listBetaGroups).not.toHaveBeenCalled();
    expect(permissionClient.listDistributionCertificates).toHaveBeenCalledTimes(1);
  }

  it(
    'skips app reads without an app record but still runs account reads',
    skipsAppReadsWithoutAnAppPieceButStillRunsAccountReads,
  );
}

describe('probeKeyPermissions', describeProbeKeyPermissions);

function describeFormatPermissionLine() {
  const permissionBase = {
    feature: 'x',
    label: 'Feature X',
    roles: ['Admin', 'App Manager'],
  } as const;

  function rendersAvailableWithASCIIPiece() {
    const permissionLine = formatPermissionLine({ ...permissionBase, status: 'available' });
    expect(permissionLine).toBe('OK Feature X');
  }

  it('renders available with ASCII text', rendersAvailableWithASCIIPiece);

  function rendersForbiddenWithTheRoleHint() {
    const permissionLine = formatPermissionLine({ ...permissionBase, status: 'forbidden' });
    expect(permissionLine).toBe(
      'x Feature X - key lacks the role (needs one of: Admin, App Manager)',
    );
  }

  it('renders forbidden with the role hint', rendersForbiddenWithTheRoleHint);

  function rendersUnauthorized() {
    const permissionLine = formatPermissionLine({ ...permissionBase, status: 'unauthorized' });
    expect(permissionLine).toContain('unauthorized (401)');
  }

  it('renders unauthorized', rendersUnauthorized);

  function rendersInconclusiveWithTheDetail() {
    const permissionLine = formatPermissionLine({
      ...permissionBase,
      status: 'inconclusive',
      detail: 'no app record to probe',
    });

    expect(permissionLine).toBe("- Feature X - couldn't determine (no app record to probe)");
  }

  it('renders inconclusive with the detail', rendersInconclusiveWithTheDetail);

  function rendersInconclusiveWithoutADetail() {
    const permissionLine = formatPermissionLine({ ...permissionBase, status: 'inconclusive' });
    expect(permissionLine).toBe("- Feature X - couldn't determine");
  }

  it('renders inconclusive without a detail', rendersInconclusiveWithoutADetail);
}

describe('formatPermissionLine', describeFormatPermissionLine);
