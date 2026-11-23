// Holds probe results for submitting an app to App Store Connect or Google Play.

import type { AppDescriptor } from './app.ts';
import type { LaunchConfig } from './config.ts';

/** Store queried by a readiness probe. */
export type ReadinessStore = 'appstore' | 'play';

/** Probe groups selected by readiness commands. */
export type ReadinessCategory = 'account' | 'iap' | 'listing' | 'privacy' | 'signing' | 'submit';

/** One app's finding from one successful probe read. */
export type AppReadiness = Readonly<{
  app: string;
  identifier: string;
  status: 'ok' | 'warn' | 'blocker';
  detail: string;
  hint?: string;
}>;

/** Probe outcome before unexpected failures are added by the orchestrator. */
export type ProbeResult =
  | Readonly<{
      state: 'omitted';
    }>
  | Readonly<{
      state: 'skipped';
      reason: string;
      hint?: string;
    }>
  | Readonly<{
      state: 'checked';
      apps: readonly AppReadiness[];
    }>;

type ProbeCheckResult = Promise<ProbeResult>;

/** Probe result plus an unexpected read failure captured by the orchestrator. */
export type ProbeOutcome =
  | ProbeResult
  | Readonly<{
      state: 'errored';
      error: string;
    }>;

/** Identified probe outcome used by terminal and JSON renderers. */
export type ProbeReport = Readonly<{
  id: string;
  title: string;
  store: ReadinessStore;
  outcome: ProbeOutcome;
}>;

/** Read-only App Store Connect methods used by readiness probes. */
export type AscReadinessApi = Readonly<{
  getAppId(bundleId: string): Promise<string | null>;

  checkRequiredAgreements(): Promise<boolean>;

  listSubscriptionGroups(appId: string): Promise<
    Readonly<{
      id: string;
    }>[]
  >;

  findBundleId(identifier: string): Promise<Readonly<{
    id: string;
  }> | null>;

  listDistributionCertificates(): Promise<
    Readonly<{
      id: string;
      expirationDate?: string | undefined;
    }>[]
  >;

  listInAppPurchases(appId: string): Promise<
    Readonly<{
      id?: string;
      productId: string;
      state?: string | undefined;
    }>[]
  >;

  listSubscriptions(groupId: string): Promise<
    Readonly<{
      id?: string;
      productId: string;
      state?: string | undefined;
    }>[]
  >;

  listSandboxTesters(): Promise<
    Readonly<{
      id: string;
    }>[]
  >;

  findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Promise<Readonly<{
    id: string;
  }> | null>;

  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Promise<Readonly<{
    id: string;
  }> | null>;

  listSubscriptionOfferCodes(subscriptionId: string): Promise<
    Readonly<{
      name: string;
    }>[]
  >;

  getEditableAppInfoId(appId: string): Promise<string | null>;

  getAgeRatingDeclaration(appInfoId: string): Promise<Readonly<{
    attributes: Record<string, string | boolean>;
  }> | null>;

  listAccountDeletionUrls(appInfoId: string): Promise<
    Readonly<{
      locale: string;
      url: string;
    }>[]
  >;

  listAppStoreVersions(
    appId: string,
    platform: string,
  ): Promise<
    ReadonlyArray<
      Readonly<{
        appStoreState: string;
      }>
    >
  >;

  findEditableAppStoreVersion(
    appId: string,
    platform: string,
  ): Promise<Readonly<{
    id: string;
    copyright: string;
  }> | null>;

  getAppStoreReviewDetail(versionId: string): Promise<Readonly<{
    attributes: Record<string, string | boolean>;
  }> | null>;

  listBundleIdCapabilities(bundleIdResourceId: string): Promise<
    Readonly<{
      capabilityType: string;
    }>[]
  >;

  listAppStoreVersionLocalizations(versionId: string): Promise<
    Readonly<{
      id: string;
      locale: string;
    }>[]
  >;

  listScreenshotSets(versionLocalizationId: string): Promise<
    Readonly<{
      id: string;
      screenshotDisplayType: string;
    }>[]
  >;

  listScreenshots(setId: string): Promise<
    Readonly<{
      id: string;
    }>[]
  >;
}>;

/** Read-only Google Play methods used by readiness probes. */
export type PlayReadinessApi = Readonly<{
  assertAppExists(packageName: string): Promise<void>;

  getLatestVersionCode(packageName: string): Promise<number>;

  listTracks(packageName: string): Promise<
    Readonly<{
      track: string;
    }>[]
  >;
}>;

/** Config, selected apps, and memoized clients shared by readiness probes. */
export type ReadinessContext = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];

  resolveAscApi(): Promise<AscReadinessApi | null>;

  resolvePlayApi(packageName?: string): Promise<PlayReadinessApi | null>;
}>;

/** Registered read-only probe selected by category. */
export type ReadinessProbe = Readonly<{
  id: string;
  title: string;
  store: ReadinessStore;
  categories: readonly ReadinessCategory[];

  check(readinessContext: ReadinessContext): ProbeCheckResult;
}>;

/** Aggregate readiness report and its process exit code. */
export type ReadinessOutcome = Readonly<{
  reports: readonly ProbeReport[];
  okCount: number;
  warnCount: number;
  blockerCount: number;
  errorCount: number;
  skippedCount: number;
  exitCode: number;
}>;
