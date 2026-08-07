import type { Effect } from 'effect';
import type { ListingLocalization } from './appleCatalog.js';
import type { InAppProductResource, SubscriptionResource } from './googlePlay.js';
import type { AscCatalogApi } from '../store/ascSync.js';
import type { PlannedAction } from './reconcile.js';
import type { AppDescriptor } from './app.js';
import type { LaunchConfig } from './config.js';
import type { PlayCatalogApi } from './plan.js';
/** Which store a source reads from - drives credential resolution and how a capture/diff is grouped. */
export type SnapshotStore = 'appstore' | 'play';
/**
 * A JSON-serializable value - the on-disk form of a captured entity's normalized state. A precise union
 * (not `unknown`) so the snapshot record stays serializable end-to-end and a structural diff can compare
 * two captures field-by-field. Sources build this from plain object/array literals, deliberately dropping
 * volatile portal-internal ids so re-capturing an unchanged catalog produces an identical record.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | Readonly<{
      [key: string]: JsonValue;
    }>;
/**
 * One captured item within a surface - e.g. a single in-app purchase or subscription.
 * - `key` is the item's natural, stable identifier (product id / SKU); it pairs items across two
 *   snapshots so the diff can tell an *added* item from a *changed* one.
 * - `summary` is a one-line human description shown in `snapshot diff` output.
 * - `data` is the normalized state used for the structural change check and `snapshot export`.
 */
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
/**
 * What a source returns, as a discriminated union mirroring {@link import("./plan.js").SurfacePlan}:
 * - `omitted` - nothing in scope (e.g. no iOS apps); dropped from the record entirely.
 * - `skipped` - the store's credentials aren't configured, so live state couldn't be read; benign, but
 *   recorded with a reason so a partial snapshot never masquerades as complete.
 * - `captured` - the source read successfully; `apps` carries the per-app entities.
 */
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
    }>;
/**
 * A {@link SourceCapture} plus the `errored` state the orchestrator synthesizes when a source throws
 * unexpectedly (a real read failure, not an empty surface). Kept distinct so `snapshot create` can exit
 * non-zero when a surface couldn't be captured, rather than silently saving an incomplete record.
 */
export type CaptureOutcome =
  | SourceCapture
  | Readonly<{
      state: 'errored';
      error: string;
    }>;
/**
 * One source's stamped result in a saved snapshot. The orchestrator records the source's identity onto its
 * {@link CaptureOutcome} so a source never restates its own id/title/store, and so the on-disk record is
 * self-describing for `diff`/`export`. Omitted sources are dropped before persisting.
 */
export type CaptureReport = Readonly<{
  id: string;
  title: string;
  store: SnapshotStore;
  outcome: CaptureOutcome;
}>;
/**
 * The persisted snapshot record - the JSON written under `~/.launch/snapshots/<name>.json` and the unit
 * `diff`/`export`/`list` operate on. `version` guards the on-disk format; `reports` excludes omitted
 * surfaces so an Apple-only project never carries empty Play blocks.
 */
export type Snapshot = Readonly<{
  version: number;
  name: string;
  capturedAt: string;
  reports: readonly CaptureReport[];
}>;
/**
 * The read-only App Store Connect surface the snapshot sources share - exactly the methods they call,
 * nothing more. `AppStoreConnectClient` satisfies it structurally (every method already exists on it), so
 * the resolver from `core/storeClients.ts` is assignable here with no cast. Mirrors
 * {@link import("./readiness.js").AscReadinessApi}; grows by one method as each Apple source lands.
 */
export type SnapshotAscApi = Readonly<{
  getAppId(bundleId: string): Effect.Effect<string | null, unknown>;
  listInAppPurchases(appId: string): Effect.Effect<
    Readonly<{
      productId: string;
      inAppPurchaseType: string;
      state?: string | undefined;
    }>[],
    unknown
  >;
  listSubscriptionGroups(appId: string): Effect.Effect<
    Readonly<{
      id: string;
      referenceName: string;
    }>[],
    unknown
  >;
  listSubscriptions(groupId: string): Effect.Effect<
    Readonly<{
      productId: string;
      subscriptionPeriod?: string | undefined;
      state?: string | undefined;
    }>[],
    unknown
  >;
  getEditableAppInfoId(appId: string): Effect.Effect<string | null, unknown>;
  listAppInfoLocalizations(
    appInfoId: string,
  ): Effect.Effect<readonly ListingLocalization[], unknown>;
  getEditableVersionId(appId: string): Effect.Effect<string | null, unknown>;
  listVersionLocalizations(
    versionId: string,
  ): Effect.Effect<readonly ListingLocalization[], unknown>;
  findBundleId(identifier: string): Effect.Effect<
    Readonly<{
      id: string;
      identifier: string;
    }> | null,
    unknown
  >;
  listBundleIdCapabilities(bundleIdResourceId: string): Effect.Effect<
    Readonly<{
      capabilityType: string;
    }>[],
    unknown
  >;
}>;
/**
 * The read-only Google Play surface the snapshot sources share - the Play counterpart to
 * {@link SnapshotAscApi}: exactly the two readers they call, never the reconcilers' write methods, so the
 * read-only invariant is enforced by the type. The return shapes reuse the Play reconcilers' resource
 * types (`InAppProductResource` / `SubscriptionResource`) rather than re-declaring the wire shape, keeping
 * one source of truth; `GooglePlayClient` satisfies it structurally with no cast.
 */
export type SnapshotPlayApi = Readonly<{
  listInAppProducts(packageName: string): Effect.Effect<readonly InAppProductResource[], unknown>;
  listSubscriptions(packageName: string): Effect.Effect<readonly SubscriptionResource[], unknown>;
}>;
/**
 * What a {@link SnapshotSource} is handed: the loaded config, the apps in scope (already narrowed by `-a`),
 * and the lazy, memoized store-client resolvers from `core/storeClients.ts`. A resolver returns `null` when
 * the account isn't configured, letting a source emit a `skipped` capture instead of throwing.
 */
export type SnapshotContext = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  resolveAscApi(): Effect.Effect<SnapshotAscApi | null, unknown>;
  resolvePlayApi(): Effect.Effect<SnapshotPlayApi | null, unknown>;
}>;
/**
 * What a {@link SnapshotSource.restore} pass is handed: the write-capable counterpart to
 * {@link SnapshotContext}. Each resolver returns the reconciler write surface its store's sources need -
 * the {@link AscCatalogApi} for App Store sources, the {@link PlayCatalogApi} (products + subscriptions)
 * for Play sources - or `null` when that account isn't configured, so a source emits a skipped action
 * instead of throwing. The concrete clients satisfy these structurally, like the read side's
 * {@link SnapshotAscApi} / {@link SnapshotPlayApi}.
 */
export type RestoreContext = Readonly<{
  config: LaunchConfig;
  apps: readonly AppDescriptor[];
  resolveAscWriteClient(): Effect.Effect<AscCatalogApi | null, unknown>;
  resolvePlayWriteClient(): Effect.Effect<PlayCatalogApi | null, unknown>;
}>;
/**
 * One source's restore request: the write context plus the per-app entities loaded from the saved snapshot
 * (already narrowed by `-a`). `dryRun` drives the same plan-then-apply contract the reconcilers use - a
 * dry-run produces the planned actions for the preview and performs no writes.
 */
export type RestoreInput = Readonly<{
  ctx: RestoreContext;
  saved: readonly AppEntities[];
  dryRun: boolean;
}>;
/** The result of a restore pass: the actions planned (dry-run) or applied, in order. */
export type RestoreReport = Readonly<{
  actions: readonly PlannedAction[];
}>;
/**
 * One captured surface. {@link capture} is **read-only**: it resolves live state and serializes it, never
 * writing. Registered like a provider/planner (see {@link import("./registry.js")}); the orchestrator
 * resolves every registered source and never names a concrete one.
 *
 * {@link restore} is the optional write counterpart to {@link capture}: it pushes a saved capture back to
 * the store. Only **config-complete** sources implement it - `apple-listing` (full per-locale listing) and
 * the Play catalog sources (`play-products` / `play-subscriptions`, which capture price + listings and
 * restore additively via the same reconcilers `launch sync` uses). The Apple catalog sources
 * (`apple-products` / `apple-subscriptions`) stay capture-only: App Store Connect exposes no reader for an
 * in-app purchase's current price/territory, so their capture is summary-grade and can't be faithfully
 * restored. A source without `restore` is preview-only in `snapshot restore`.
 */
export type SnapshotSource = Readonly<{
  id: string;
  title: string;
  store: SnapshotStore;
  capture(snapshotContext: SnapshotContext): Effect.Effect<SourceCapture, unknown>;
  restore?(input: RestoreInput): Effect.Effect<RestoreReport, unknown>;
}>;
