/**
 * Shared vocabulary for `launch migrate` — the file-based onboarding path that reads an existing
 * Expo/EAS (and later fastlane) setup and emits the equivalent Launch config plus a report of what
 * mapped and what still needs a human (see issue #171).
 *
 * Where `launch adopt` imports from a *live* App Store Connect account (network), `migrate` is purely
 * file-based and read-only against the project: it parses `eas.json` / `app.json` and produces a set of
 * {@link MigrationArtifact}s the caller writes, never touching either store. These types describe the
 * migration *mechanism* — its inputs, its emitted artifacts, and its per-item report — so, like
 * `core/plan/types.ts`, they live here beside the feature rather than in `core/types.ts`.
 *
 * There is deliberately no migrator registry: there are only two sources (eas, fastlane) with different
 * inputs and overlapping outputs, so #172 (fastlane) reuses {@link MigrationResult} + `report.ts` +
 * `write.ts` and adds only its own parser + subcommand — extending the nearest sibling, not a new layer.
 */

/** Which existing toolchain a migration read from — drives the report header and the artifact comment. */
export type MigrationSource = "eas" | "fastlane";

/**
 * How faithfully one piece of the source setup carried over, shown as the report's leading glyph:
 * - `mapped` — Launch translated it automatically into an emitted artifact (✓).
 * - `manual` — Launch can't translate it; the developer must act (the note says how) (~).
 * - `skipped` — intentionally left as-is (e.g. an existing `store.config.json` Launch reuses verbatim) (•).
 * - `info` — purely informational; nothing to write and no action needed (read from `app.json`, etc.) (ⓘ).
 */
export type MigrationNoteLevel = "mapped" | "manual" | "skipped" | "info";

/** One line in the migration report: what happened to a piece of the source setup, and (when `manual`) how to finish it. */
export interface MigrationNote {
  level: MigrationNoteLevel;
  message: string;
}

/**
 * A file the migration would write, as a path relative to the output directory plus its full contents.
 * Existence/overwrite is decided at write time against the output dir (see `write.ts`), so an artifact
 * carries no `exists` flag — the same artifact can be previewed (`--dry-run`) or written unchanged.
 */
export interface MigrationArtifact {
  /** Path relative to the output directory, e.g. `launch.config.ts`. */
  path: string;
  /** The complete file contents to write. */
  contents: string;
}

/**
 * The outcome of one migration run: which toolchain it read, the artifacts to write, and the per-item
 * report. Returned by a source's migrate function (e.g. {@link import("./eas.js").migrateEas}) and
 * consumed by `report.ts` (render) and `write.ts` (persist) — both shared across every source.
 */
export interface MigrationResult {
  source: MigrationSource;
  artifacts: MigrationArtifact[];
  notes: MigrationNote[];
}

/* -------------------------------------------------------------------------- */
/*  EAS input shapes — the subset of eas.json Launch reads. Tolerantly parsed  */
/*  (see eas.ts `parseEasJson`), so every field is optional: a partial or hand- */
/*  trimmed eas.json still migrates what it can rather than failing outright.   */
/* -------------------------------------------------------------------------- */

/**
 * One `build.<profile>` block in `eas.json`. Only the fields Launch maps or reports on are modeled:
 * `channel`/`distribution`/`developmentClient` become report notes, `env` keys seed `.env.example`.
 */
export interface EasBuildProfile {
  /** EAS Update channel this profile published to — no Launch profile field, so it becomes a `manual` note. */
  channel?: string;
  /** `store` | `internal`; `internal` (ad-hoc) distribution becomes a `manual` note. */
  distribution?: string;
  /** Inline env for this profile — its KEYS seed `.env.example`; the VALUES are dropped (may be secrets). */
  env?: Record<string, string>;
  /** Whether EAS auto-incremented the build number — Launch always bumps from the store, so informational. */
  autoIncrement?: boolean | string;
  /** A development-client build (dev menu) — not a store artifact, so it becomes a `manual` note. */
  developmentClient?: boolean;
}

/** The iOS half of a `submit.<profile>` block — Apple account details that map to `launch creds`, not config. */
export interface EasSubmitIos {
  appleId?: string;
  ascAppId?: string;
  appleTeamId?: string;
}

/** The Android half of a `submit.<profile>` block — the Play track maps to a profile; the key path to `launch creds`. */
export interface EasSubmitAndroid {
  serviceAccountKeyPath?: string;
  track?: string;
}

/** One `submit.<profile>` block in `eas.json`. */
export interface EasSubmitProfile {
  ios?: EasSubmitIos;
  android?: EasSubmitAndroid;
}

/** The `cli` block in `eas.json` — only `appVersionSource` informs the report (it matches Launch's store-driven bumping). */
export interface EasCli {
  appVersionSource?: string;
}

/**
 * The parsed `eas.json`, narrowed to what Launch reads. `build`/`submit` default to `{}` so a file with
 * only one of them (or neither) still migrates cleanly; `cli` is optional.
 */
export interface EasJson {
  cli?: EasCli;
  build: Record<string, EasBuildProfile>;
  submit: Record<string, EasSubmitProfile>;
}

/* -------------------------------------------------------------------------- */
/*  fastlane input shapes — the subset of a fastlane setup Launch reads. Parsed */
/*  by line-scanning the Ruby DSL (regex, not a Ruby interpreter — see          */
/*  fastlane.ts), so every field is optional: a project with only some of the    */
/*  files (or only some directives) still migrates what it can.                  */
/* -------------------------------------------------------------------------- */

/** The `Appfile` — the app/account identifiers fastlane shares across actions. */
export interface AppfileData {
  /** iOS bundle id (`app_identifier`) — Launch reads this from app.json, so it's informational. */
  appIdentifier?: string;
  /** Apple ID email (`apple_id`) — maps to `launch creds`, not config. */
  appleId?: string;
  /** Developer Portal team id (`team_id`). */
  teamId?: string;
  /** App Store Connect team id (`itc_team_id`), when distinct from the portal team. */
  itcTeamId?: string;
  /** Android application id (`package_name`) — Launch reads this from app.json, so it's informational. */
  packageName?: string;
}

/**
 * The `Matchfile` — fastlane `match`'s signing strategy. Launch manages its own certificates in the OS
 * keychain, so every field here becomes a `manual` note (you don't carry match over), not config.
 */
export interface MatchfileData {
  /** The git repo storing the encrypted certificates (`git_url`). */
  gitUrl?: string;
  /** Certificate type (`type`): `development` | `appstore` | `adhoc` | `enterprise`. */
  type?: string;
  /** Storage backend (`storage_mode`): `git` | `google_cloud` | `s3`. */
  storageMode?: string;
  /** The app id(s) the profiles cover (`app_identifier`) — the first one when several are listed. */
  appIdentifier?: string;
}

/** The `Supplyfile` — fastlane `supply`'s Play upload defaults. */
export interface SupplyfileData {
  /** Android application id (`package_name`). */
  packageName?: string;
  /** Path to the Play service-account JSON key (`json_key`) — maps to `launch creds`. */
  jsonKey?: string;
  /** Default Play track (`track`) — maps onto a profile's `track`. */
  track?: string;
}

/**
 * A parsed fastlane setup, narrowed to what Launch reads from the standard files. Lanes and recognized
 * actions drive the report (Launch's pipeline replaces lanes); the per-file blocks are present only when
 * that file existed. Mirrors {@link EasJson} as the file-based input to a migration source.
 */
export interface FastlaneSetup {
  appfile?: AppfileData;
  matchfile?: MatchfileData;
  supply?: SupplyfileData;
  /** Lane names found in the `Fastfile` — workflows with no 1:1 Launch equivalent (Launch replaces lanes). */
  lanes: string[];
  /** Recognized fastlane actions present anywhere in the `Fastfile` (e.g. `gym`, `pilot`, `deliver`). */
  actions: string[];
  /** Whether a `Deliverfile` (App Store metadata config) is present — points the report at `launch metadata`. */
  hasDeliverfile: boolean;
}
