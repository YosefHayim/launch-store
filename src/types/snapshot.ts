// Holds a saved copy of App Store Connect or Google Play state and the reads that capture it.

import type { ListingLocalization } from './apple/app-store-versions.ts';
import type { InAppProductResource } from './google/in-app-products.ts';
import type { SubscriptionResource } from './google/subscriptions.ts';
import type { AscCatalogApi } from '../apple/app-store-sync.ts';
import type { PlannedAction } from './reconcile.ts';
import type { AppDescriptor } from './app.ts';
import type { LaunchConfig } from './config.ts';
import type { PlayCatalogApi } from './plan.ts';

/** Which store a source reads from - drives credential resolution and how a capture/diff is grouped. */
export type SnapshotStore = 'appstore' | 'play';

/** A JSON-serializable value - the on-disk form of a captured entity's normalized state. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | Readonly<{
      [key: string]: JsonValue;
    }>;

/** One captured item within a surface - e.g. */
export type SnapshotEntity = Readonly<{
  key: string;
  summary: string;
  data: JsonValue;
}>;

/** One app's captured entities for one source (the per-app grouping inside a captured surface). */
export type AppEntities = Readonly<{
  app: string;
  identifier: string;
  entities: readonly SnapshotEntity[];
}>;

/** What a source returns: omitted, skipped, or captured. */
export type SourceCapture =
  | Readonly<{
      state: 'omitted';
    }>
  | Readonly<{
      state: 'skipped';
      reason: string;
      hint?: string;
    }>
  | Readonly<{
      state: 'captured';
      apps: readonly AppEntities[];
      skippedApps?: readonly Readonly<{ app: string; identifier: string; reason: string }>[];
    }>;

/** A source result, plus errored when the source throws. */
export type CaptureOutcome =
  | SourceCapture
  | Readonly<{
      state: 'errored';
      error: string;
    }>;

/** One source's stamped result in a saved snapshot. */
export type CaptureReport = Readonly<{
  id: string;
  title: string;
  store: SnapshotStore;
  outcome: CaptureOutcome;
}>;

/** The persisted snapshot record */
export type Snapshot = Readonly<{
  version: number;
  name: string;
  capturedAt: string;
  reports: readonly CaptureReport[];
}>;

/** The read-only App Store Connect surface the snapshot sources share */
export type SnapshotAscApi = Readonly<{
  getAppId(bundleId: string): Promise<string | null>;

  listInAppPurchases(appId: string): Promise<
    Readonly<{
      productId: string;
      inAppPurchaseType: string;
      state?: string | undefined;
    }>[]
  >;

  listSubscriptionGroups(appId: string): Promise<
    Readonly<{
      id: string;
      referenceName: string;
    }>[]
  >;

  listSubscriptions(groupId: string): Promise<
    Readonly<{
      productId: string;
      subscriptionPeriod?: string | undefined;
      state?: string | undefined;
    }>[]
  >;

  getCurrentAppInfoId(appId: string): Promise<string | null>;

  listAppInfoLocalizations(appInfoId: string): Promise<readonly ListingLocalization[]>;

  getCurrentVersionId(appId: string): Promise<string | null>;

  listVersionLocalizations(versionId: string): Promise<readonly ListingLocalization[]>;

  findBundleId(identifier: string): Promise<Readonly<{
    id: string;
    identifier: string;
  }> | null>;

  listBundleIdCapabilities(bundleIdResourceId: string): Promise<
    Readonly<{
      capabilityType: string;
    }>[]
  >;
}>;

/** The read-only Google Play surface the snapshot sources share */
export type SnapshotPlayApi = Readonly<{
  listInAppProducts(packageName: string): Promise<readonly InAppProductResource[]>;

  listSubscriptions(packageName: string): Promise<readonly SubscriptionResource[]>;
}>;

/** What a {@link SnapshotSource} is handed */
export type SnapshotContext = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];

  resolveAscApi(): Promise<SnapshotAscApi | null>;

  resolvePlayApi(packageName?: string): Promise<SnapshotPlayApi | null>;
}>;

/** What a {@link SnapshotSource.restore} pass is handed */
export type RestoreContext = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];

  resolveAscWriteClient(): Promise<AscCatalogApi | null>;

  resolvePlayWriteClient(packageName?: string): Promise<PlayCatalogApi | null>;
}>;

/** One source's restore request */
export type RestoreInput = Readonly<{
  ctx: RestoreContext;
  saved: readonly AppEntities[];
  dryRun: boolean;
}>;

/** The result of a restore pass: the actions planned (dry-run) or applied, in order. */
type RestoreReport = Readonly<{
  actions: readonly PlannedAction[];
}>;

/** One captured surface. */
export type SnapshotSource = Readonly<{
  id: string;
  title: string;
  store: SnapshotStore;

  capture(snapshotContext: SnapshotContext): Promise<SourceCapture>;

  restore?(input: RestoreInput): Promise<RestoreReport>;
}>;
