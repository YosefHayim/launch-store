// Holds the shapes for copying a live App Store Connect setup back into launch.config.ts.

import type {
  BundleIdCapabilityResource,
  BundleIdResource,
  CertificateResource,
  InAppPurchaseResource,
  LocalizationResource,
  MerchantIdResource,
  ProfileResource,
  SubscriptionGroupResource,
  SubscriptionResource,
} from './apple-catalog.ts';
import type { AppDescriptor } from './app.ts';
import type { InAppPurchaseConfig, SubscriptionGroupConfig } from './catalog.ts';

/** How faithfully a domain reverse-maps from App Store Connect into config */
export type Fidelity = 'importable' | 'advisory' | 'detect';

/** A JSON-compatible iOS entitlement value (string toggle, identifier array, boolean flag, nested dict). */
export type EntitlementValue =
  | string
  | number
  | boolean
  | null
  | EntitlementValue[]
  | Readonly<{
      [key: string]: EntitlementValue;
    }>;

/** The read-only slice of the App Store Connect client the adopters depend on. */
export type AdoptCatalogApi = Readonly<{
  getAppId(bundleId: string): Promise<string | null>;

  getLatestMarketingVersion(bundleId: string): Promise<string | null>;

  getLatestBuildNumber(bundleId: string): Promise<number>;

  findBundleId(identifier: string): Promise<BundleIdResource | null>;

  listBundleIdCapabilities(
    bundleIdResourceId: string,
  ): Promise<readonly BundleIdCapabilityResource[]>;

  listProfilesForBundleId(bundleIdResourceId: string): Promise<readonly ProfileResource[]>;

  listMerchantIds(): Promise<readonly MerchantIdResource[]>;

  listInAppPurchases(appId: string): Promise<readonly InAppPurchaseResource[]>;

  listInAppPurchaseLocalizations(iapId: string): Promise<readonly LocalizationResource[]>;

  inAppPurchaseHasPrice(iapId: string): Promise<boolean>;

  listSubscriptionGroups(appId: string): Promise<readonly SubscriptionGroupResource[]>;

  listSubscriptionGroupLocalizations(groupId: string): Promise<readonly LocalizationResource[]>;

  listSubscriptions(groupId: string): Promise<readonly SubscriptionResource[]>;

  listSubscriptionLocalizations(subscriptionId: string): Promise<readonly LocalizationResource[]>;

  subscriptionHasPrice(subscriptionId: string): Promise<boolean>;

  listDistributionCertificates(): Promise<readonly CertificateResource[]>;
}>;

/** One app being adopted, resolved by the orchestrator before any adopter runs. */
export type AdoptTarget = Readonly<{
  app: AppDescriptor;
  appId: string;
  bundleId: string;
  keyId: string;
  cwd: string;
  hasLaunchConfig: boolean;
}>;

/** One imported product piece destined for `products[bundleId]` in `launch.config.ts`. */
export type ProductPiece =
  | Readonly<{
      type: 'iap';
      iap: InAppPurchaseConfig;
    }>
  | Readonly<{
      type: 'subscriptionGroup';
      group: SubscriptionGroupConfig;
    }>;

/** The concrete change a {@link PlannedWrite} carries */
type AdoptChange =
  | Readonly<{
      home: 'launch.config';
      bundleId: string;
      piece: ProductPiece;
    }>
  | Readonly<{
      home: 'app.json';
      configPath: string;
      key: string;
      value: EntitlementValue;
    }>
  | Readonly<{
      home: 'store.config';
      bundleId: string;
      configPath: string;
      appName: string;
    }>
  | Readonly<{
      home: 'keychain';
    }>;

/** One proposed change surfaced in the plan and (after confirm) applied. */
export type PlannedWrite = Readonly<{
  description: string;
  fidelity: Fidelity;
  note?: string;
  change: AdoptChange;
}>;

/** One domain's importer. */
export type Adopter = {
  domain: string;
  fidelity: Fidelity;

  read(asc: AdoptCatalogApi, target: AdoptTarget): Promise<PlannedWrite[]>;
};
