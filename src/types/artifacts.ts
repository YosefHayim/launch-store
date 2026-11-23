// Holds built binaries, their download sizes, and what artifact cleanup removes.

import type { Platform } from './app.ts';

/** One row in a {@link SizeReport}: a device variant's estimated store download/install size. */
export interface SizeReportEntry {
  device: string;
  downloadBytes: number;
  installBytes: number;
}

/** Size analysis produced right after the build, before any upload. */
export interface SizeReport {
  artifactBytes: number;
  entries: SizeReportEntry[];
}

/** A built, signed artifact plus the metadata Launch records about it. */
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

/** One build whose binary an artifact-retention sweep removed (or, in a dry run, would remove). */
export type PrunedArtifact = Readonly<{
  app: string;
  platform: Platform;
  version: string;
  buildNumber: number;
  bytes: number;
  path: string;
}>;

/** Options for an artifact-retention sweep ({@link StorageProvider.prune}). */
export type PruneOptions = Readonly<{
  now: number;
  retentionDays: number;
  app?: string;
  platform?: Platform;
  dryRun?: boolean;
}>;

/** The outcome of an artifact-retention sweep. */
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
