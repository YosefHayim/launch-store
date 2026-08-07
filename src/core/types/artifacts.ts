import { Schema } from 'effect';
import { PLATFORMS, type Platform } from './app.js';

export const SizeReportEntrySchema = Schema.mutable(
  Schema.Struct({
    device: Schema.String,
    downloadBytes: Schema.Number,
    installBytes: Schema.Number,
  }),
);

export const SizeReportSchema = Schema.mutable(
  Schema.Struct({
    artifactBytes: Schema.Number,
    entries: Schema.mutable(Schema.Array(SizeReportEntrySchema)),
  }),
);

export const BuildArtifactSchema = Schema.mutable(
  Schema.Struct({
    path: Schema.String,
    platform: Schema.Literal(...PLATFORMS),
    appName: Schema.String,
    profile: Schema.String,
    version: Schema.String,
    buildNumber: Schema.Number,
    sizeReport: SizeReportSchema,
    clean: Schema.Boolean,
    createdAt: Schema.String,
    prunedAt: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

export const ArtifactIndexSchema = Schema.mutable(Schema.Array(BuildArtifactSchema));

/**
 * One row in a {@link SizeReport}: a device variant's estimated store download/install size.
 *
 * On iOS these come per-device from Xcode's App Thinning Size Report. On Android there is no thinning
 * report; `bundletool get-size` yields a single worst-case download, surfaced as one representative
 * row (`installBytes` left 0 - Play doesn't expose an honest install figure).
 */
export type SizeReportEntry = Schema.Schema.Type<typeof SizeReportEntrySchema>;
/**
 * Size analysis produced right after the build, before any upload.
 *
 * Surfacing this locally is the whole point of the size step: know the real per-device download
 * before spending a store round-trip discovering the app is too large.
 */
export type SizeReport = Schema.Schema.Type<typeof SizeReportSchema>;
/**
 * One build target discovered in a generated Xcode project's `project.pbxproj` - a target name paired
 * with its authoritative `PRODUCT_BUNDLE_IDENTIFIER`.
 *
 * The pbxproj is the source of truth for what a multi-target app actually signs: `@bacons/apple-targets`
 * derives an extension's bundle id from the target FOLDER name (`targets/widget/` => `...​.widget`), NOT
 * the `name:` field, so neither the config nor the target name can be trusted to reconstruct it - only
 * the `PRODUCT_BUNDLE_IDENTIFIER` Xcode wrote into the project is. Used by signing preflight + discovery
 * to feed every embedded extension's bundle id into provisioning. `productType` distinguishes the main
 * app (`com.apple.product-type.application`) from its app-extension targets.
 */
export type DiscoveredTarget = Readonly<{
  name: string;
  bundleId: string;
  productType: string;
}>;
/**
 * A built, signed artifact plus the metadata Launch records about it.
 *
 * Stored by a {@link StorageProvider} and used to build the run summary and the local index.
 */
export type BuildArtifact = Schema.Schema.Type<typeof BuildArtifactSchema>;
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
