import type { Platform } from './app.ts';

/**
 * One row in a {@link SizeReport}: a device variant's estimated store download/install size.
 *
 * On iOS these come per-device from Xcode's App Thinning Size Report. On Android there is no thinning
 * report; `bundletool get-size` yields a single worst-case download, surfaced as one representative
 * row (`installBytes` left 0 - Play doesn't expose an honest install figure).
 */
export interface SizeReportEntry {
  device: string;
  downloadBytes: number;
  installBytes: number;
}

/**
 * Size analysis produced right after the build, before any upload.
 *
 * Surfacing this locally is the whole point of the size step: know the real per-device download
 * before spending a store round-trip discovering the app is too large.
 */
export interface SizeReport {
  artifactBytes: number;
  entries: SizeReportEntry[];
}

/**
 * A built, signed artifact plus the metadata Launch records about it.
 *
 * Stored by a {@link StorageProvider} and used to build the run summary and the local index.
 */
export interface BuildArtifact {
  path: string;
  platform: Platform;
  appName: string;
  profile: string;
  version: string;
  buildNumber: number;
  sizeReport: SizeReport;
  clean: boolean;
  createdAt: string;
  prunedAt?: string;
}
/**
 * One build whose binary an artifact-retention sweep removed (or, in a dry run, would remove). A flat,
 * presentation-ready projection of the pruned {@link BuildArtifact} plus the bytes it freed - what the
 * `builds prune` preview/table renders and `--json` emits, kept stable apart from the persisted record.
 */
export type PrunedArtifact = Readonly<{
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  bytes: number;
  path: string;
}>;
/**
 * Options for an artifact-retention sweep ({@link StorageProvider.prune}). `now` is injected (not read
 * from the clock) so the policy is deterministic and unit-testable; `retentionDays` is the resolved
 * window. An absent `app`/`platform` matches everything; `dryRun` plans without deleting.
 */
export type PruneOptions = Readonly<{
  now: number;
  retentionDays: number;
  app?: string;
  platform?: Platform;
  dryRun?: boolean;
}>;
/**
 * The outcome of an artifact-retention sweep. `pruned` is empty when nothing was eligible (a no-op);
 * `freedBytes` sums the removed binaries' sizes. When `dryRun` is true, `pruned`/`freedBytes` describe
 * what *would* be removed and nothing was deleted.
 */
export type PruneResult = Readonly<{
  pruned: readonly PrunedArtifact[];
  freedBytes: number;
  dryRun: boolean;
}>;
/** A pointer to an artifact after a {@link StorageProvider} has stored it. */
export type StoredArtifact = Readonly<{
  id: string;
  location: string;
}>;
