import type { FileSystem, HttpClient, Path } from '@effect/platform';
import type { Effect } from 'effect';
import type { AppDescriptor } from './app.js';
import type { LaunchConfig } from './config.js';

/** Store queried by a readiness probe. */
export type ReadinessStore = 'appstore' | 'play';

/** Probe groups selected by readiness commands. */
export type ReadinessCategory = 'account' | 'iap' | 'listing' | 'privacy' | 'signing' | 'submit';

/** One app's finding from one successful probe read. */
export type AppReadiness = {
  app: string;
  identifier: string;
  status: 'ok' | 'warn' | 'blocker';
  detail: string;
  hint?: string;
};
/** Probe outcome before unexpected failures are added by the orchestrator. */
export type ProbeResult =
  | {
      state: 'omitted';
    }
  | {
      state: 'skipped';
      reason: string;
      hint?: string;
    }
  | {
      state: 'checked';
      apps: AppReadiness[];
    };
/** Platform capabilities available to every readiness probe. */
export type ReadinessProbeRequirements = FileSystem.FileSystem | HttpClient.HttpClient | Path.Path;

/** Effect returned by every readiness probe. */
export type ProbeCheckResult = Effect.Effect<ProbeResult, unknown, ReadinessProbeRequirements>;

/** Probe result plus an unexpected read failure captured by the orchestrator. */
export type ProbeOutcome =
  | ProbeResult
  | {
      state: 'errored';
      error: string;
    };
/** Identified probe outcome used by terminal and JSON renderers. */
export type ProbeReport = {
  id: string;
  title: string;
  store: ReadinessStore;
  outcome: ProbeOutcome;
};
/** Read-only App Store Connect methods used by readiness probes. */
export type AscReadinessApi = {
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  checkRequiredAgreements(): Effect.Effect<boolean, unknown>;
  listSubscriptionGroups(appId: string): Effect.Effect<
    {
      id: string;
    }[],
    unknown
  >;
  findBundleId(identifier: string): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  listDistributionCertificates(): Effect.Effect<
    {
      id: string;
      expirationDate?: string | undefined;
    }[],
    unknown
  >;
  listInAppPurchases(appId: string): Effect.Effect<
    {
      id?: string;
      productId: string;
      state?: string | undefined;
    }[],
    unknown
  >;
  listSubscriptions(groupId: string): Effect.Effect<
    {
      id?: string;
      productId: string;
      state?: string | undefined;
    }[],
    unknown
  >;
  listSandboxTesters(): Effect.Effect<
    {
      id: string;
    }[],
    unknown
  >;
  findInAppPurchasePricePoint(
    iapId: string,
    territory: string,
    customerPrice: number,
  ): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  findSubscriptionPricePoint(
    subscriptionId: string,
    territory: string,
    customerPrice: number,
  ): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  listSubscriptionOfferCodes(subscriptionId: string): Effect.Effect<
    {
      name: string;
    }[],
    unknown
  >;
  getEditableAppInfoId(appId: string): Effect.Effect<string | null, unknown>;
  getAgeRatingDeclaration(appInfoId: string): Effect.Effect<
    {
      attributes: Record<string, string | boolean>;
    } | null,
    unknown
  >;
  listAccountDeletionUrls(appInfoId: string): Effect.Effect<
    {
      locale: string;
      url: string;
    }[],
    unknown
  >;
  findEditableAppStoreVersion(
    appId: string,
    platform: string,
  ): Effect.Effect<
    {
      id: string;
    } | null,
    unknown
  >;
  getAppStoreReviewDetail(versionId: string): Effect.Effect<
    {
      attributes: Record<string, string | boolean>;
    } | null,
    unknown
  >;
  listBundleIdCapabilities(bundleIdResourceId: string): Effect.Effect<
    {
      capabilityType: string;
    }[],
    unknown
  >;
  listAppStoreVersionLocalizations(versionId: string): Effect.Effect<
    {
      id: string;
      locale: string;
    }[],
    unknown
  >;
  listScreenshotSets(versionLocalizationId: string): Effect.Effect<
    {
      id: string;
      screenshotDisplayType: string;
    }[],
    unknown
  >;
  listScreenshots(setId: string): Effect.Effect<
    {
      id: string;
    }[],
    unknown
  >;
};
/** Read-only Google Play methods used by readiness probes. */
export type PlayReadinessApi = {
  assertAppExists(packageName: string): Effect.Effect<void, unknown>;
  getLatestVersionCode(packageName: string): Effect.Effect<number, unknown>;
  listTracks(packageName: string): Effect.Effect<
    {
      track: string;
    }[],
    unknown
  >;
};
/** Config, selected apps, and memoized clients shared by readiness probes. */
export type ReadinessContext = {
  config: LaunchConfig;
  apps: AppDescriptor[];
  resolveAscApi(): Effect.Effect<AscReadinessApi | null, unknown>;
  resolvePlayApi(): Effect.Effect<PlayReadinessApi | null, unknown>;
};
/** Registered read-only probe selected by category. */
export type ReadinessProbe = {
  id: string;
  title: string;
  store: ReadinessStore;
  categories: readonly ReadinessCategory[];
  check(readinessContext: ReadinessContext): ProbeCheckResult;
};
/** Aggregate readiness report and its process exit code. */
export type ReadinessOutcome = {
  reports: ProbeReport[];
  okCount: number;
  warnCount: number;
  blockerCount: number;
  errorCount: number;
  skippedCount: number;
  exitCode: number;
};
