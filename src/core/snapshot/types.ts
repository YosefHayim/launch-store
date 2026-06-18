/**
 * Shared vocabulary for `launch snapshot` — a read-only, point-in-time capture of live App Store Connect
 * + Google Play state, saved as a named record so destructive store automation (`launch sync` / `apply`)
 * has a trustworthy "before" to diff and, later, restore against (see issue #169).
 *
 * Where `core/plan` *diffs* config against live state and `core/readiness` *grades* it, snapshot just
 * *records* it: it runs every registered {@link SnapshotSource} against the live read-only clients and
 * serializes what each returns. The mechanism mirrors the {@link import("../plan/types.js").SurfacePlanner}
 * and {@link import("../readiness/types.js").ReadinessProbe} registries — each source owns one surface,
 * the orchestrator never names a concrete one, so adding a captured surface is a new source file + one
 * `registerSnapshotSource()` line.
 *
 * These types describe the snapshot *mechanism* and its on-disk record, not a config shape, so — like
 * `core/plan/types.ts` — they live here beside the feature rather than in `core/types.ts`.
 */

import type { AppDescriptor, LaunchConfig } from "../types.js";
import type { ListingLocalization } from "../../apple/ascClient.js";
import type { InAppProductResource, SubscriptionResource } from "../../google/playClient.js";

/** Which store a source reads from — drives credential resolution and how a capture/diff is grouped. */
export type SnapshotStore = "appstore" | "play";

/**
 * A JSON-serializable value — the on-disk form of a captured entity's normalized state. A precise union
 * (not `unknown`) so the snapshot record stays serializable end-to-end and a structural diff can compare
 * two captures field-by-field. Sources build this from plain object/array literals, deliberately dropping
 * volatile portal-internal ids so re-capturing an unchanged catalog produces an identical record.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * One captured item within a surface — e.g. a single in-app purchase or subscription.
 * - `key` is the item's natural, stable identifier (product id / SKU); it pairs items across two
 *   snapshots so the diff can tell an *added* item from a *changed* one.
 * - `summary` is a one-line human description shown in `snapshot diff` output.
 * - `data` is the normalized state used for the structural change check and `snapshot export`.
 */
export interface SnapshotEntity {
  key: string;
  summary: string;
  data: JsonValue;
}

/** One app's captured entities for one source (the per-app grouping inside a captured surface). */
export interface AppEntities {
  /** App handle as discovered (used for grouping and the `-a` selector). */
  app: string;
  /** The app's identifier on this store — iOS bundle id / Android package name. */
  identifier: string;
  /** The items captured for this app under this source; empty means the surface exists but holds nothing. */
  entities: SnapshotEntity[];
}

/**
 * What a source returns, as a discriminated union mirroring {@link import("../plan/types.js").SurfacePlan}:
 * - `omitted` — nothing in scope (e.g. no iOS apps); dropped from the record entirely.
 * - `skipped` — the store's credentials aren't configured, so live state couldn't be read; benign, but
 *   recorded with a reason so a partial snapshot never masquerades as complete.
 * - `captured` — the source read successfully; `apps` carries the per-app entities.
 */
export type SourceCapture =
  | { state: "omitted" }
  | { state: "skipped"; reason: string; hint?: string }
  | { state: "captured"; apps: AppEntities[] };

/**
 * A {@link SourceCapture} plus the `errored` state the orchestrator synthesizes when a source throws
 * unexpectedly (a real read failure, not an empty surface). Kept distinct so `snapshot create` can exit
 * non-zero when a surface couldn't be captured, rather than silently saving an incomplete record.
 */
export type CaptureOutcome = SourceCapture | { state: "errored"; error: string };

/**
 * One source's stamped result in a saved snapshot. The orchestrator records the source's identity onto its
 * {@link CaptureOutcome} so a source never restates its own id/title/store, and so the on-disk record is
 * self-describing for `diff`/`export`. Omitted sources are dropped before persisting.
 */
export interface CaptureReport {
  /** Stable source key (e.g. `apple-products`), the join key the diff pairs surfaces on. */
  id: string;
  /** Human-readable surface title shown in capture/diff output. */
  title: string;
  /** The store this source read from. */
  store: SnapshotStore;
  /** What was captured (or that the surface was skipped/errored). */
  outcome: CaptureOutcome;
}

/**
 * The persisted snapshot record — the JSON written under `~/.launch/snapshots/<name>.json` and the unit
 * `diff`/`export`/`list` operate on. `version` guards the on-disk format; `reports` excludes omitted
 * surfaces so an Apple-only project never carries empty Play blocks.
 */
export interface Snapshot {
  /** On-disk schema version, so a future format change can migrate or reject an old record. */
  version: number;
  /** The label the user gave (or a timestamp default) — also the file's basename and the `diff`/`export` handle. */
  name: string;
  /** ISO-8601 capture time. */
  capturedAt: string;
  /** One block per source that produced output (captured/skipped/errored). */
  reports: CaptureReport[];
}

/**
 * The read-only App Store Connect surface the snapshot sources share — exactly the methods they call,
 * nothing more. `AppStoreConnectClient` satisfies it structurally (every method already exists on it), so
 * the resolver from `core/storeClients.ts` is assignable here with no cast. Mirrors
 * {@link import("../readiness/types.js").AscReadinessApi}; grows by one method as each Apple source lands.
 */
export interface SnapshotAscApi {
  /** The app's App Store Connect id for a bundle id, or `null` when no app record exists. */
  getAppId(bundleId: string): Promise<string | null>;
  /** The app's one-time in-app purchases (product id, type, and lifecycle `state`). */
  listInAppPurchases(
    appId: string,
  ): Promise<{ productId: string; inAppPurchaseType: string; state?: string | undefined }[]>;
  /** The app's auto-renewable subscription groups. */
  listSubscriptionGroups(appId: string): Promise<{ id: string; referenceName: string }[]>;
  /** A subscription group's subscriptions (product id, billing period, lifecycle `state`). */
  listSubscriptions(
    groupId: string,
  ): Promise<{ productId: string; subscriptionPeriod?: string | undefined; state?: string | undefined }[]>;
  /** The app's current editable `appInfo` id (app-level listing container), or `null` when none is editable. */
  getEditableAppInfoId(appId: string): Promise<string | null>;
  /** The app-level listing localizations (name / subtitle / privacy URL) under an `appInfo`. */
  listAppInfoLocalizations(appInfoId: string): Promise<ListingLocalization[]>;
  /** The app's current editable App Store version id, or `null` when only a live/in-review version exists. */
  getEditableVersionId(appId: string): Promise<string | null>;
  /** The version-level listing localizations (description / keywords / whatsNew / …) under a version. */
  listVersionLocalizations(versionId: string): Promise<ListingLocalization[]>;
}

/**
 * The read-only Google Play surface the snapshot sources share — the Play counterpart to
 * {@link SnapshotAscApi}: exactly the two readers they call, never the reconcilers' write methods, so the
 * read-only invariant is enforced by the type. The return shapes reuse the Play reconcilers' resource
 * types (`InAppProductResource` / `SubscriptionResource`) rather than re-declaring the wire shape, keeping
 * one source of truth; `GooglePlayClient` satisfies it structurally with no cast.
 */
export interface SnapshotPlayApi {
  /** The app's managed in-app products (`inappproducts`), including pricing and listings. */
  listInAppProducts(packageName: string): Promise<InAppProductResource[]>;
  /** The app's auto-renewable subscriptions, including base plans and listings. */
  listSubscriptions(packageName: string): Promise<SubscriptionResource[]>;
}

/**
 * What a {@link SnapshotSource} is handed: the loaded config, the apps in scope (already narrowed by `-a`),
 * and the lazy, memoized store-client resolvers from `core/storeClients.ts`. A resolver returns `null` when
 * the account isn't configured, letting a source emit a `skipped` capture instead of throwing.
 */
export interface SnapshotContext {
  config: LaunchConfig;
  apps: AppDescriptor[];
  /** Resolve the read-only App Store Connect client, or `null` when no Apple account is active. */
  resolveAscApi(): Promise<SnapshotAscApi | null>;
  /** Resolve the read-only Google Play client, or `null` when no Play service account is configured. */
  resolvePlayApi(): Promise<SnapshotPlayApi | null>;
}

/**
 * One captured surface. {@link capture} is **read-only**: it resolves live state and serializes it, never
 * writing. Registered like a provider/planner (see {@link import("./registry.js")}); the orchestrator
 * resolves every registered source and never names a concrete one.
 */
export interface SnapshotSource {
  /** Stable source key shown in the record and used to pair surfaces across two snapshots in a diff. */
  id: string;
  /** Human-readable surface title for capture/diff output. */
  title: string;
  /** Which store this source reads from. */
  store: SnapshotStore;
  /** Read live state for the in-scope apps and return its normalized capture, performing no writes. */
  capture(ctx: SnapshotContext): Promise<SourceCapture>;
}
