/**
 * The EAS half of `launch migrate` — parse an existing `eas.json` (with the app facts Launch already
 * discovers from `app.json`) and produce the equivalent Launch artifacts plus a report of what still
 * needs a human. Pure and file-based: {@link parseEasJson} is tolerant JSON narrowing (no zod, mirroring
 * `storeConfig.ts`), and {@link migrateEas} reads `eas.json` from disk but only *returns* artifacts —
 * `write.ts` decides what to persist. See issue #171.
 *
 * Mapping at a glance: each EAS build profile → a Launch {@link BuildProfile} (its Play track comes from
 * the matching submit profile); env KEYS across all profiles → `.env.example` (values dropped — they may
 * be secrets); everything EAS expresses that Launch models differently (cloud builds, Update channels,
 * submit credentials) becomes a {@link MigrationNote} rather than silently vanishing.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configTemplate, detectAppRoot } from "../configScaffold.js";
import type { AppDescriptor, BuildProfile, PlayTrack } from "../types.js";
import { buildEnvExample, scaffoldStoreConfig } from "./scaffold.js";
import type {
  EasBuildProfile,
  EasCli,
  EasJson,
  EasSubmitProfile,
  MigrationArtifact,
  MigrationNote,
  MigrationResult,
} from "./types.js";

/** Narrow an unknown value to a plain object, or null. Mirrors `config.ts`/`storeConfig.ts` (no zod). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Read a string field, or undefined when absent/non-string. */
function str(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === "string" ? record[key] : undefined;
}

/** Collect a record's string-valued entries (e.g. EAS `env`), dropping non-string values; undefined when empty. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse one `build.<profile>` block, keeping only the fields Launch maps or reports on. */
function parseBuildProfile(block: Record<string, unknown>): EasBuildProfile {
  const profile: EasBuildProfile = {};
  const channel = str(block, "channel");
  if (channel) profile.channel = channel;
  const distribution = str(block, "distribution");
  if (distribution) profile.distribution = distribution;
  const env = stringRecord(block["env"]);
  if (env) profile.env = env;
  if (typeof block["developmentClient"] === "boolean") profile.developmentClient = block["developmentClient"];
  const autoIncrement = block["autoIncrement"];
  if (typeof autoIncrement === "boolean" || typeof autoIncrement === "string") profile.autoIncrement = autoIncrement;
  return profile;
}

/** Parse one `submit.<profile>` block's iOS + Android halves, dropping empty halves. */
function parseSubmitProfile(block: Record<string, unknown>): EasSubmitProfile {
  const profile: EasSubmitProfile = {};
  const ios = asRecord(block["ios"]);
  if (ios) {
    const appleId = str(ios, "appleId");
    const ascAppId = str(ios, "ascAppId");
    const appleTeamId = str(ios, "appleTeamId");
    if (appleId || ascAppId || appleTeamId) {
      profile.ios = {
        ...(appleId ? { appleId } : {}),
        ...(ascAppId ? { ascAppId } : {}),
        ...(appleTeamId ? { appleTeamId } : {}),
      };
    }
  }
  const android = asRecord(block["android"]);
  if (android) {
    const serviceAccountKeyPath = str(android, "serviceAccountKeyPath");
    const track = str(android, "track");
    if (serviceAccountKeyPath || track) {
      profile.android = { ...(serviceAccountKeyPath ? { serviceAccountKeyPath } : {}), ...(track ? { track } : {}) };
    }
  }
  return profile;
}

/** Parse a map of named profile blocks (`build` or `submit`), skipping non-object entries. */
function parseProfileMap<T>(value: unknown, parse: (block: Record<string, unknown>) => T): Record<string, T> {
  const record = asRecord(value);
  if (!record) return {};
  const profiles: Record<string, T> = {};
  for (const [name, raw] of Object.entries(record)) {
    const block = asRecord(raw);
    if (block) profiles[name] = parse(block);
  }
  return profiles;
}

/** Parse the `cli` block, keeping only `appVersionSource`; undefined when absent. */
function parseCli(value: unknown): EasCli | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const appVersionSource = str(record, "appVersionSource");
  return appVersionSource ? { appVersionSource } : undefined;
}

/**
 * Parse a raw `eas.json` string into the {@link EasJson} subset Launch reads. Tolerant of missing
 * `build`/`submit`/`cli` sections (each defaults sensibly) so a partial file still migrates what it can,
 * but throws on invalid JSON or a non-object document so a malformed file fails loudly.
 */
export function parseEasJson(raw: string): EasJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`eas.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const record = asRecord(parsed);
  if (!record) throw new Error("eas.json must be a JSON object.");

  const eas: EasJson = {
    build: parseProfileMap(record["build"], parseBuildProfile),
    submit: parseProfileMap(record["submit"], parseSubmitProfile),
  };
  const cli = parseCli(record["cli"]);
  if (cli) eas.cli = cli;
  return eas;
}

/** Google Play's four release tracks — anything else in a submit profile is reported as needing a fix. */
const PLAY_TRACKS: readonly PlayTrack[] = ["internal", "closed", "open", "production"];

/** Whether a raw EAS track string is one Launch can carry onto a profile verbatim. */
function isPlayTrack(value: string): value is PlayTrack {
  return (PLAY_TRACKS as readonly string[]).includes(value);
}

/**
 * Map every EAS build profile to a Launch {@link BuildProfile}, lifting the Play track from the
 * matching submit profile. Falls back to a single `production` profile when `eas.json` declares none,
 * so the emitted config is always valid.
 */
function mapProfiles(eas: EasJson): Record<string, BuildProfile> {
  const profiles: Record<string, BuildProfile> = {};
  for (const name of Object.keys(eas.build)) {
    const profile: BuildProfile = { name, sizeBudgetMB: 200 };
    const track = eas.submit[name]?.android?.track;
    if (track && isPlayTrack(track)) profile.track = track;
    profiles[name] = profile;
  }
  if (Object.keys(profiles).length === 0) profiles["production"] = { name: "production", sizeBudgetMB: 200 };
  return profiles;
}

/**
 * Serialize a mapped profiles record as the full `profiles: { … },` block `configTemplate` splices in
 * (replacing its default single-`production` block). JSON keys are valid TypeScript object literals, so
 * this is plain `JSON.stringify` + a two-space re-indent — the same emitter `adopt`'s configWriter uses.
 */
function serializeProfilesSection(profiles: Record<string, BuildProfile>): string {
  const indented = JSON.stringify(profiles, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");
  return [
    "  // Imported from eas.json by `launch migrate eas` — review, then commit.",
    `  profiles: ${indented},`,
  ].join("\n");
}

/** The union of env KEYS declared across all EAS build profiles, sorted; values are dropped (may be secrets). */
function collectEnvKeys(eas: EasJson): string[] {
  const keys = new Set<string>();
  for (const profile of Object.values(eas.build)) {
    if (profile.env) for (const key of Object.keys(profile.env)) keys.add(key);
  }
  return [...keys].sort();
}

/** Build the report notes: what mapped automatically, what needs manual follow-up, and pure FYI. */
function buildNotes(eas: EasJson, apps: AppDescriptor[]): MigrationNote[] {
  const notes: MigrationNote[] = [];

  for (const [name, profile] of Object.entries(eas.build)) {
    notes.push({ level: "mapped", message: `Build profile "${name}" → Launch profile "${name}".` });
    if (profile.channel) {
      notes.push({
        level: "manual",
        message: `Profile "${name}" published to EAS Update channel "${profile.channel}" — set up OTA with \`launch update --channel ${profile.channel}\` (see \`launch explain ota-update\`).`,
      });
    }
    if (profile.distribution === "internal") {
      notes.push({
        level: "manual",
        message: `Profile "${name}" used internal (ad-hoc) distribution — register tester devices with \`launch device add\` (see \`launch explain ad-hoc-distribution\`).`,
      });
    }
    if (profile.developmentClient === true) {
      notes.push({
        level: "manual",
        message: `Profile "${name}" built a development client — that's a dev tool, not a store build; Launch ships store and TestFlight builds.`,
      });
    }
  }

  for (const [name, submit] of Object.entries(eas.submit)) {
    if (submit.ios) {
      notes.push({
        level: "manual",
        message: `Submit profile "${name}" carried Apple account details (appleId/ascAppId/appleTeamId) — configure your Apple API key with \`launch creds set-key\`.`,
      });
    }
    if (submit.android?.serviceAccountKeyPath) {
      notes.push({
        level: "manual",
        message: `Submit profile "${name}" referenced a Play service account key (${submit.android.serviceAccountKeyPath}) — configure it with \`launch creds\`.`,
      });
    }
    const track = submit.android?.track;
    if (track && !isPlayTrack(track)) {
      notes.push({
        level: "manual",
        message: `Submit profile "${name}" had an unrecognized Play track "${track}" — set a valid track (internal/closed/open/production) on the profile.`,
      });
    }
  }

  if (eas.cli?.appVersionSource === "remote") {
    notes.push({
      level: "mapped",
      message: "`cli.appVersionSource: remote` → Launch already bumps build numbers from the store, matching remote.",
    });
  }

  notes.push({
    level: "manual",
    message:
      'EAS built in the cloud; Launch builds locally by default (`buildEngine: "fastlane"`). No Mac? Set `buildEngine: "eas"` or run `launch build --remote` (see `launch explain eas-handoff`).',
  });

  for (const app of apps) {
    if (app.bundleId) {
      notes.push({
        level: "info",
        message: `Detected iOS bundle id ${app.bundleId} for "${app.name}" — read from app.json; nothing to write.`,
      });
    }
    if (app.packageName) {
      notes.push({
        level: "info",
        message: `Detected Android package ${app.packageName} for "${app.name}" — read from app.json; nothing to write.`,
      });
    }
  }

  return notes;
}

/**
 * Migrate an Expo/EAS project at `cwd` into Launch artifacts. Reads `cwd/eas.json` (required) and uses
 * the already-discovered `apps` for the app facts; returns the artifacts to write and the migration
 * report notes. Never writes — `write.ts` owns persistence, so this stays trivially testable.
 */
export function migrateEas(cwd: string, apps: AppDescriptor[]): MigrationResult {
  const easPath = join(cwd, "eas.json");
  if (!existsSync(easPath)) {
    throw new Error(`No eas.json in ${cwd}. \`launch migrate eas\` reads an existing Expo/EAS project.`);
  }
  const eas = parseEasJson(readFileSync(easPath, "utf8"));

  const profilesSection = serializeProfilesSection(mapProfiles(eas));
  const artifacts: MigrationArtifact[] = [
    { path: "launch.config.ts", contents: configTemplate(detectAppRoot(apps, cwd), undefined, profilesSection) },
    { path: ".env.example", contents: buildEnvExample(collectEnvKeys(eas)) },
  ];

  const notes = buildNotes(eas, apps);
  const store = scaffoldStoreConfig(cwd);
  if (store.artifact) artifacts.push(store.artifact);
  notes.push(store.note);

  return { source: "eas", artifacts, notes };
}
