export type MigrationSource = 'eas' | 'fastlane';
/**
 * How faithfully one piece of the source setup carried over, shown as the report's leading glyph:
 * - `mapped` - Launch translated it automatically into an emitted artifact (OK).
 * - `manual` - Launch can't translate it; the developer must act (the note says how) (~).
 * - `skipped` - intentionally left as-is (e.g. an existing `store.config.json` Launch reuses verbatim) (-).
 * - `info` - informational only; nothing to write and no action needed.
 */
export type MigrationNoteLevel = 'mapped' | 'manual' | 'skipped' | 'info';
/** One line in the migration report: what happened to a piece of the source setup, and (when `manual`) how to finish it. */
export type MigrationNote = {
  level: MigrationNoteLevel;
  message: string;
};
/**
 * A file the migration would write, as a path relative to the output directory plus its full contents.
 * Existence/overwrite is decided at write time against the output dir (see `write.ts`), so an artifact
 * carries no `exists` flag - the same artifact can be previewed (`--dry-run`) or written unchanged.
 */
export type MigrationArtifact = {
  path: string;
  contents: string;
};
/**
 * The outcome of one migration run: which toolchain it read, the artifacts to write, and the per-item
 * report. Returned by a source's migrate function (e.g. {@link import("./eas.js").migrateEas}) and
 * consumed by `report.ts` (render) and `write.ts` (persist) - both shared across every source.
 */
export type MigrationResult = {
  source: MigrationSource;
  artifacts: MigrationArtifact[];
  notes: MigrationNote[];
};
/**
 * One `build.<profile>` block in `eas.json`. Only the fields Launch maps or reports on are modeled:
 * `channel`/`distribution`/`developmentClient` become report notes, `env` keys seed `.env.example`.
 */
export type EasBuildProfile = {
  channel?: string;
  distribution?: string;
  env?: Record<string, string>;
  autoIncrement?: boolean | string;
  developmentClient?: boolean;
};
/** The iOS half of a `submit.<profile>` block - Apple account details that map to `launch creds`, not config. */
export type EasSubmitIos = {
  appleId?: string;
  ascAppId?: string;
  appleTeamId?: string;
};
/** The Android half of a `submit.<profile>` block - the Play track maps to a profile; the key path to `launch creds`. */
export type EasSubmitAndroid = {
  serviceAccountKeyPath?: string;
  track?: string;
};
/** One `submit.<profile>` block in `eas.json`. */
export type EasSubmitProfile = {
  ios?: EasSubmitIos;
  android?: EasSubmitAndroid;
};
/** The `cli` block in `eas.json` - only `appVersionSource` informs the report (it matches Launch's store-driven bumping). */
export type EasCli = {
  appVersionSource?: string;
};
/**
 * The parsed `eas.json`, narrowed to what Launch reads. `build`/`submit` default to `{}` so a file with
 * only one of them (or neither) still migrates cleanly; `cli` is optional.
 */
export type EasJson = {
  cli?: EasCli;
  build: Record<string, EasBuildProfile>;
  submit: Record<string, EasSubmitProfile>;
};
/**
 * A non-secret summary of an EAS `credentials.json` (present when `eas.json` sets
 * `credentialsSource: "local"`). Only paths and the keystore alias are surfaced; the certificate/keystore
 * Password fields are discarded by the boundary schema and never enter this shape.
 */
export type CredentialsSummary = {
  ios?: {
    distributionCertificatePath?: string;
    provisioningProfilePath?: string;
  };
  android?: {
    keystorePath?: string;
    keyAlias?: string;
  };
};
/** The `Appfile` - the app/account identifiers fastlane shares across actions. */
export type AppfileData = {
  appIdentifier?: string;
  appleId?: string;
  teamId?: string;
  itcTeamId?: string;
  packageName?: string;
};
/**
 * The `Matchfile` - fastlane `match`'s signing strategy. Launch manages its own certificates in the OS
 * keychain, so every field here becomes a `manual` note (you don't carry match over), not config.
 */
export type MatchfileData = {
  gitUrl?: string;
  type?: string;
  storageMode?: string;
  appIdentifier?: string;
};
/** The `Supplyfile` - fastlane `supply`'s Play upload defaults. */
export type SupplyfileData = {
  packageName?: string;
  jsonKey?: string;
  track?: string;
};
/**
 * One lane parsed from a `Fastfile`: its name, the `platform` block it sits in (when any), and the
 * recognized fastlane actions found in its body. The body is captured by line-scan (see fastlane.ts
 * `parseFastfile`) - tolerant, not a Ruby parser - so `actions` is best-effort, and a lane with no
 * recognized actions still appears (with an empty `actions`) so the report can flag it as custom.
 */
export type FastlaneLane = {
  name: string;
  platform?: string;
  actions: string[];
};
/**
 * A parsed fastlane setup, narrowed to what Launch reads from the standard files. Lanes and recognized
 * actions drive the report (Launch's pipeline replaces lanes); the per-file blocks are present only when
 * that file existed. Mirrors {@link EasJson} as the file-based input to a migration source.
 */
export type FastlaneSetup = {
  appfile?: AppfileData;
  matchfile?: MatchfileData;
  supply?: SupplyfileData;
  lanes: FastlaneLane[];
  actions: string[];
  hasDeliverfile: boolean;
  envKeys: string[];
};
