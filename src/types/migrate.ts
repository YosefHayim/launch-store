export type MigrationSource = 'eas' | 'fastlane';
/** How faithfully one piece of the source setup carried over */
export type MigrationNoteLevel = 'mapped' | 'manual' | 'skipped' | 'info';
/** One line in the migration report: what happened to a piece of the source setup, and (when `manual`) how to finish it. */
export type MigrationNote = Readonly<{
  level: MigrationNoteLevel;
  message: string;
}>;
/** A file the migration would write */
export type MigrationArtifact = Readonly<{
  path: string;
  contents: string;
}>;
/** The outcome of one migration run */
export type MigrationResult = Readonly<{
  source: MigrationSource;
  artifacts: readonly MigrationArtifact[];
  notes: readonly MigrationNote[];
}>;
/** One `build.<profile>` block in `eas.json`. */
export type EasBuildProfile = Readonly<{
  channel?: string;
  distribution?: string;
  env?: Record<string, string>;
  autoIncrement?: boolean | string;
  developmentClient?: boolean;
}>;
/** The iOS half of a `submit.<profile>` block - Apple account details that map to `launch-store creds`, not config. */
type EasSubmitIos = Readonly<{
  appleId?: string;
  ascAppId?: string;
  appleTeamId?: string;
}>;
/** The Android half of a `submit.<profile>` block - the Play track maps to a profile; the key path to `launch-store creds`. */
type EasSubmitAndroid = Readonly<{
  serviceAccountKeyPath?: string;
  track?: string;
}>;
/** One `submit.<profile>` block in `eas.json`. */
export type EasSubmitProfile = Readonly<{
  ios?: EasSubmitIos;
  android?: EasSubmitAndroid;
}>;
/** The `cli` block in `eas.json` - only `appVersionSource` informs the report (it matches Launch's store-driven bumping). */
type EasCli = Readonly<{
  appVersionSource?: string;
}>;
/** The parsed `eas.json`, narrowed to what Launch reads. */
export type EasJson = Readonly<{
  cli?: EasCli;
  build: Record<string, EasBuildProfile>;
  submit: Record<string, EasSubmitProfile>;
}>;

/** The `Appfile` - the app/account identifiers fastlane shares across actions. */
export type AppfileData = Readonly<{
  appIdentifier?: string;
  appleId?: string;
  teamId?: string;
  itcTeamId?: string;
  packageName?: string;
}>;
/** The `Matchfile` - fastlane `match`'s signing strategy. */
export type MatchfileData = Readonly<{
  gitUrl?: string;
  type?: string;
  storageMode?: string;
  appIdentifier?: string;
}>;
/** The `Supplyfile` - fastlane `supply`'s Play upload defaults. */
export type SupplyfileData = Readonly<{
  packageName?: string;
  jsonKey?: string;
  track?: string;
}>;
/** One lane parsed from a `Fastfile` */
export type FastlaneLane = Readonly<{
  name: string;
  platform?: string;
  actions: readonly string[];
}>;
