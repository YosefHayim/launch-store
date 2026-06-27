/**
 * Build outputs and size analysis: the {@link BuildArtifact} a build engine emits, its {@link SizeReport},
 * and the prune shapes for cleaning up stored artifacts under `~/.launch`.
 */

import type { Platform } from './app.js';

/**
 * One row in a {@link SizeReport}: a device variant's estimated store download/install size.
 *
 * On iOS these come per-device from Xcode's App Thinning Size Report. On Android there is no thinning
 * report; `bundletool get-size` yields a single worst-case download, surfaced as one representative
 * row (`installBytes` left 0 — Play doesn't expose an honest install figure).
 */
export interface SizeReportEntry {
  /** Variant name, e.g. `iPhone15,2` (iOS) or `worst-case device` (Android bundletool estimate). */
  device: string;
  /** Estimated bytes the device downloads from the store (after iOS thinning / Android splits). */
  downloadBytes: number;
  /** Estimated bytes installed on the device. 0 when the platform gives no honest install figure. */
  installBytes: number;
}

/**
 * Size analysis produced right after the build, before any upload.
 *
 * Surfacing this locally is the whole point of the size step: know the real per-device download
 * before spending a store round-trip discovering the app is too large.
 */
export interface SizeReport {
  /** Raw artifact file size on disk — the `.ipa` (iOS) or `.aab` (Android); NOT what users download. */
  artifactBytes: number;
  /** Per-device download/install estimates. Empty when no per-device report was produced. */
  entries: SizeReportEntry[];
}

/**
 * A built, signed artifact plus the metadata Launch records about it.
 *
 * Stored by a {@link StorageProvider} and used to build the run summary and the local index.
 */
export interface BuildArtifact {
  /** Absolute path to the signed `.ipa` (or `.aab`) on disk. */
  path: string;
  platform: Platform;
  appName: string;
  profile: string;
  /** App version string, e.g. `1.0.0`. */
  version: string;
  /** Unique, monotonically increasing build identifier — iOS `CFBundleVersion` or Android `versionCode`. */
  buildNumber: number;
  sizeReport: SizeReport;
  /**
   * Whether this artifact was compiled clean (from scratch) vs incrementally off warm caches. Read by
   * `launch release` to ask a second confirmation before promoting an incremental build to production —
   * the reproducibility guard, since release reuses this stored artifact rather than rebuilding.
   */
  clean: boolean;
  /** ISO-8601 creation timestamp, stamped by the caller (the pipeline). */
  createdAt: string;
  /**
   * ISO-8601 stamp set when artifact retention removed this build's binary to reclaim disk (see
   * {@link LaunchConfig.artifactRetentionDays}). The index row is kept as history — `builds list` shows it
   * as `pruned` and `builds view`/`release` explain the binary is gone — so absence means the file is still
   * on disk. The newest build per app+platform is never pruned, so a promotable artifact always survives.
   */
  prunedAt?: string;
}

/**
 * One build whose binary an artifact-retention sweep removed (or, in a dry run, would remove). A flat,
 * presentation-ready projection of the pruned {@link BuildArtifact} plus the bytes it freed — what the
 * `builds prune` preview/table renders and `--json` emits, kept stable apart from the persisted record.
 */
export interface PrunedArtifact {
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  /** Size of the removed binary in bytes — what this row reclaimed (or would reclaim). */
  bytes: number;
  /** The artifact's recorded path (the file is gone after a real run). */
  path: string;
}

/**
 * Options for an artifact-retention sweep ({@link StorageProvider.prune}). `now` is injected (not read
 * from the clock) so the policy is deterministic and unit-testable; `retentionDays` is the resolved
 * window. An absent `app`/`platform` matches everything; `dryRun` plans without deleting.
 */
export interface PruneOptions {
  /** Reference "now" in epoch ms — the age of each build is measured against this. */
  now: number;
  /** Builds strictly older than this many days are eligible (the newest per app+platform is always kept). */
  retentionDays: number;
  /** Limit the sweep to one app handle. */
  app?: string;
  /** Limit the sweep to one platform. */
  platform?: Platform;
  /** Plan and report what would be removed, deleting nothing. */
  dryRun?: boolean;
}

/**
 * The outcome of an artifact-retention sweep. `pruned` is empty when nothing was eligible (a no-op);
 * `freedBytes` sums the removed binaries' sizes. When `dryRun` is true, `pruned`/`freedBytes` describe
 * what *would* be removed and nothing was deleted.
 */
export interface PruneResult {
  pruned: PrunedArtifact[];
  freedBytes: number;
  dryRun: boolean;
}

/** A pointer to an artifact after a {@link StorageProvider} has stored it. */
export interface StoredArtifact {
  /** Stable identifier within the provider (e.g. a path or object key). */
  id: string;
  /** A URL or path a human can use to retrieve the artifact. */
  location: string;
}
