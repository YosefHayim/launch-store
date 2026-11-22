// Probes App Store Connect features to explain which roles the active key can use.
// The probe reads only; it never changes store state.

import type { AppleTransportFailure } from '../../services/stores/apple-store-client.ts';
import { errorMessage } from '../../services/platform/error-message.ts';

/** App Store Connect reads that represent distinct role-gated feature groups. */
export type AscPermissionProbeApi = Readonly<{
  listDistributionCertificates: () => Promise<unknown>;
  listBetaGroups: (appId: string) => Promise<unknown>;
  listAppStoreVersions: (appId: string, platform: string) => Promise<unknown>;
  listCustomerReviews: (
    appId: string,
    filters?: {
      rating?: number;
      territory?: string;
    },
  ) => Promise<unknown>;
  listSubscriptionGroups: (appId: string) => Promise<unknown>;
  listAnalyticsReportRequests: (appId: string, accessType: string) => Promise<unknown>;
}>;

/** Verdict of probing one role-gated feature with the active key. */
type AscPermissionStatus = 'available' | 'forbidden' | 'unauthorized' | 'inconclusive';

/** One feature, its accepted roles, and the active key's probe verdict. */
export type AscPermissionResult = Readonly<{
  feature: string;
  label: string;
  roles: readonly string[];
  status: AscPermissionStatus;
  detail?: string;
}>;

/** A role-gated feature and the read used to test access. */
type FeatureProbe = Readonly<{
  feature: string;
  label: string;
  roles: readonly string[];
  needsApp: boolean;
  run: (permissionClient: AscPermissionProbeApi, appId: string) => Promise<unknown>;
}>;

function probeProvisioning(permissionClient: AscPermissionProbeApi): Promise<unknown> {
  return permissionClient.listDistributionCertificates();
}

function probeTestFlight(permissionClient: AscPermissionProbeApi, appId: string): Promise<unknown> {
  return permissionClient.listBetaGroups(appId);
}

function probeAppStoreRelease(
  permissionClient: AscPermissionProbeApi,
  appId: string,
): Promise<unknown> {
  return permissionClient.listAppStoreVersions(appId, 'IOS');
}

function probeMonetization(
  permissionClient: AscPermissionProbeApi,
  appId: string,
): Promise<unknown> {
  return permissionClient.listSubscriptionGroups(appId);
}

function probeCustomerReviews(
  permissionClient: AscPermissionProbeApi,
  appId: string,
): Promise<unknown> {
  return permissionClient.listCustomerReviews(appId);
}

function probeAnalytics(permissionClient: AscPermissionProbeApi, appId: string): Promise<unknown> {
  return permissionClient.listAnalyticsReportRequests(appId, 'ONGOING');
}

async function classifyProbe(
  featureProbe: FeatureProbe,
  permissionClient: AscPermissionProbeApi,
  appId: string,
): Promise<AscPermissionResult> {
  const featureSummary = {
    feature: featureProbe.feature,
    label: featureProbe.label,
    roles: featureProbe.roles,
  };

  try {
    await featureProbe.run(permissionClient, appId);
    return { ...featureSummary, status: 'available' };
  } catch (cause) {
    const failure = cause as AppleTransportFailure;
    const isForbidden = failure.status == 403;

    if (isForbidden) {
      return { ...featureSummary, status: 'forbidden' };
    }

    const isUnauthorized = failure.status == 401;

    if (isUnauthorized) {
      return { ...featureSummary, status: 'unauthorized' };
    }

    return {
      ...featureSummary,
      status: 'inconclusive',
      detail: errorMessage(failure),
    };
  }
}

function isProbeBlocked(needsApp: boolean, appId: string | null): boolean {
  const isAppMissing = appId == null;

  if (isAppMissing == false) {
    return false;
  }

  return needsApp;
}

async function probeFeature(
  permissionClient: AscPermissionProbeApi,
  appId: string | null,
  featureProbe: FeatureProbe,
): Promise<AscPermissionResult> {
  const needsApp = featureProbe.needsApp;
  const cannotProbe = isProbeBlocked(needsApp, appId);

  if (cannotProbe) {
    return {
      feature: featureProbe.feature,
      label: featureProbe.label,
      roles: featureProbe.roles,
      status: 'inconclusive',
      detail: 'no app record to probe',
    };
  }

  let resolvedAppId = '';
  if (appId != null) resolvedAppId = appId;
  return classifyProbe(featureProbe, permissionClient, resolvedAppId);
}

export async function probeKeyPermissions(
  permissionClient: AscPermissionProbeApi,
  appId: string | null,
): Promise<readonly AscPermissionResult[]> {
  async function probeOne(featureProbe: FeatureProbe): Promise<AscPermissionResult> {
    return probeFeature(permissionClient, appId, featureProbe);
  }

  return Promise.all(
    [
      {
        feature: 'provisioning',
        label: 'Provisioning & signing (certificates, identifiers, profiles)',
        roles: ['Admin', 'App Manager', 'Developer'],
        needsApp: false,
        run: probeProvisioning,
      },
      {
        feature: 'testflight',
        label: 'TestFlight (beta groups & testers)',
        roles: ['Admin', 'App Manager'],
        needsApp: true,
        run: probeTestFlight,
      },
      {
        feature: 'app-store-release',
        label: 'App Store release (versions, submission, rollout)',
        roles: ['Admin', 'App Manager'],
        needsApp: true,
        run: probeAppStoreRelease,
      },
      {
        feature: 'monetization',
        label: 'In-app purchases & subscriptions',
        roles: ['Admin', 'App Manager'],
        needsApp: true,
        run: probeMonetization,
      },
      {
        feature: 'customer-reviews',
        label: 'Customer reviews (read & respond)',
        roles: ['Admin', 'App Manager', 'Customer Support'],
        needsApp: true,
        run: probeCustomerReviews,
      },
      {
        feature: 'analytics-reports',
        label: 'Analytics reports',
        roles: ['Admin', 'App Manager', 'Developer', 'Marketing'],
        needsApp: true,
        run: probeAnalytics,
      },
    ].map(probeOne),
  );
}

export const formatPermissionLine = (permission: AscPermissionResult): string => {
  switch (permission.status) {
    case 'available':
      return `OK ${permission.label}`;
    case 'forbidden':
      return `x ${permission.label} - key lacks the role (needs one of: ${permission.roles.join(', ')})`;
    case 'unauthorized':
      return `x ${permission.label} - key unauthorized (401); re-check the key id, issuer id, and expiry`;
    case 'inconclusive': {
      const explanation = permission.detail;
      if (explanation == null) return `- ${permission.label} - couldn't determine`;
      return `- ${permission.label} - couldn't determine (${explanation})`;
    }
  }
};
