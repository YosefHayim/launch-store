// Probes App Store Connect features to explain which roles the active key can use.
// The probe reads only; it never changes store state.

import { Effect } from 'effect';
import type { AppleTransportFailure } from '../services/appleStoreClient.js';
import { errorMessage } from '../services/errorMessage.js';

/** App Store Connect reads that represent distinct role-gated feature groups. */
export type AscPermissionProbeApi = Readonly<{
  listDistributionCertificates: () => Effect.Effect<unknown, AppleTransportFailure>;
  listBetaGroups: (appId: string) => Effect.Effect<unknown, AppleTransportFailure>;
  listAppStoreVersions: (
    appId: string,
    platform: string,
  ) => Effect.Effect<unknown, AppleTransportFailure>;
  listSubscriptionGroups: (appId: string) => Effect.Effect<unknown, AppleTransportFailure>;
  listCustomerReviews: (
    appId: string,
    filters?: {
      rating?: number;
      territory?: string;
    },
  ) => Effect.Effect<unknown, AppleTransportFailure>;
  listAnalyticsReportRequests: (
    appId: string,
    accessType: string,
  ) => Effect.Effect<unknown, AppleTransportFailure>;
}>;

/** Verdict of probing one role-gated feature with the active key. */
export type AscPermissionStatus = 'available' | 'forbidden' | 'unauthorized' | 'inconclusive';

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
  run: (
    permissionClient: AscPermissionProbeApi,
    appId: string,
  ) => Effect.Effect<unknown, AppleTransportFailure>;
}>;

const IOS_PLATFORM = 'IOS';
const ANALYTICS_ACCESS_TYPE = 'ONGOING';

const FEATURE_PROBES: readonly FeatureProbe[] = [
  {
    feature: 'provisioning',
    label: 'Provisioning & signing (certificates, identifiers, profiles)',
    roles: ['Admin', 'App Manager', 'Developer'],
    needsApp: false,
    run: (permissionClient) => permissionClient.listDistributionCertificates(),
  },
  {
    feature: 'testflight',
    label: 'TestFlight (beta groups & testers)',
    roles: ['Admin', 'App Manager'],
    needsApp: true,
    run: (permissionClient, appId) => permissionClient.listBetaGroups(appId),
  },
  {
    feature: 'app-store-release',
    label: 'App Store release (versions, submission, rollout)',
    roles: ['Admin', 'App Manager'],
    needsApp: true,
    run: (permissionClient, appId) => permissionClient.listAppStoreVersions(appId, IOS_PLATFORM),
  },
  {
    feature: 'monetization',
    label: 'In-app purchases & subscriptions',
    roles: ['Admin', 'App Manager'],
    needsApp: true,
    run: (permissionClient, appId) => permissionClient.listSubscriptionGroups(appId),
  },
  {
    feature: 'customer-reviews',
    label: 'Customer reviews (read & respond)',
    roles: ['Admin', 'App Manager', 'Customer Support'],
    needsApp: true,
    run: (permissionClient, appId) => permissionClient.listCustomerReviews(appId),
  },
  {
    feature: 'analytics-reports',
    label: 'Analytics reports',
    roles: ['Admin', 'App Manager', 'Developer', 'Marketing'],
    needsApp: true,
    run: (permissionClient, appId) =>
      permissionClient.listAnalyticsReportRequests(appId, ANALYTICS_ACCESS_TYPE),
  },
];

const classifyProbe = (
  featureProbe: FeatureProbe,
  permissionClient: AscPermissionProbeApi,
  appId: string,
): Effect.Effect<AscPermissionResult> => {
  const featureSummary = {
    feature: featureProbe.feature,
    label: featureProbe.label,
    roles: featureProbe.roles,
  };

  return featureProbe.run(permissionClient, appId).pipe(
    Effect.match({
      onFailure: (failure): AscPermissionResult => {
        if (failure.status === 403) return { ...featureSummary, status: 'forbidden' };
        if (failure.status === 401) return { ...featureSummary, status: 'unauthorized' };
        return {
          ...featureSummary,
          status: 'inconclusive',
          detail: errorMessage(failure),
        };
      },
      onSuccess: (): AscPermissionResult => ({ ...featureSummary, status: 'available' }),
    }),
  );
};

export const probeKeyPermissions = (
  permissionClient: AscPermissionProbeApi,
  appId: string | null,
): Effect.Effect<readonly AscPermissionResult[]> =>
  Effect.forEach(
    FEATURE_PROBES,
    (featureProbe): Effect.Effect<AscPermissionResult> => {
      if (featureProbe.needsApp && appId === null) {
        return Effect.succeed({
          feature: featureProbe.feature,
          label: featureProbe.label,
          roles: featureProbe.roles,
          status: 'inconclusive',
          detail: 'no app record to probe',
        });
      }
      let resolvedAppId = '';
      if (appId !== null) resolvedAppId = appId;
      return classifyProbe(featureProbe, permissionClient, resolvedAppId);
    },
    { concurrency: 'unbounded' },
  );

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
      if (explanation === undefined) return `- ${permission.label} - couldn't determine`;
      return `- ${permission.label} - couldn't determine (${explanation})`;
    }
  }
};
