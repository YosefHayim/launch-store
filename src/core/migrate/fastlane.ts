/**
 * The fastlane half of `launch migrate` — read an existing fastlane setup (Appfile / Fastfile /
 * Matchfile / Supplyfile / Deliverfile) and produce the equivalent Launch artifacts plus a report of
 * what carries over and what doesn't. The sibling of `eas.ts`: it reuses `scaffold.ts`, `report.ts`, and
 * `write.ts` unchanged and adds only this parser + a `fastlane` subcommand. See issue #172.
 *
 * fastlane's config is Ruby DSL, so this line-scans for the directives Launch cares about (regex, not a
 * Ruby interpreter — KISS, and a malformed lane never crashes the migration). fastlane has no build-profile
 * model and Launch *is* built on fastlane under the hood, so the migration is mostly a mapping report:
 * lanes → Launch's pipeline, `match` → Launch's own keychain-backed signing, `deliver`/`supply` →
 * `launch metadata`. The emitted `launch.config.ts` is the standard starter (app facts come from app.json).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configTemplate, detectAppRoot, ENV_EXAMPLE_TEMPLATE } from "../configScaffold.js";
import type { AppDescriptor } from "../types.js";
import { scaffoldStoreConfig } from "./scaffold.js";
import type {
  AppfileData,
  FastlaneSetup,
  MatchfileData,
  MigrationArtifact,
  MigrationNote,
  MigrationNoteLevel,
  MigrationResult,
  SupplyfileData,
} from "./types.js";

/**
 * Read the first value of a fastlane directive written as `key "value"`, `key 'value'`, or `key("value")`.
 * `key` is always a fixed literal here, so the built regex is safe; an empty value reads as absent.
 */
function rubyString(content: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*\\(?\\s*["']([^"']*)["']`, "m").exec(content);
  const value = match?.[1];
  return value === undefined || value === "" ? undefined : value;
}

/** Parse an `Appfile` into the identifiers fastlane shares across actions. */
export function parseAppfile(content: string): AppfileData {
  const data: AppfileData = {};
  const appIdentifier = rubyString(content, "app_identifier");
  if (appIdentifier) data.appIdentifier = appIdentifier;
  const appleId = rubyString(content, "apple_id");
  if (appleId) data.appleId = appleId;
  const teamId = rubyString(content, "team_id");
  if (teamId) data.teamId = teamId;
  const itcTeamId = rubyString(content, "itc_team_id");
  if (itcTeamId) data.itcTeamId = itcTeamId;
  const packageName = rubyString(content, "package_name");
  if (packageName) data.packageName = packageName;
  return data;
}

/** Parse a `Matchfile` into `match`'s signing strategy (all of which Launch replaces with its own). */
export function parseMatchfile(content: string): MatchfileData {
  const data: MatchfileData = {};
  const gitUrl = rubyString(content, "git_url");
  if (gitUrl) data.gitUrl = gitUrl;
  const type = rubyString(content, "type");
  if (type) data.type = type;
  const storageMode = rubyString(content, "storage_mode");
  if (storageMode) data.storageMode = storageMode;
  const appIdentifier = rubyString(content, "app_identifier");
  if (appIdentifier) data.appIdentifier = appIdentifier;
  return data;
}

/** Parse a `Supplyfile` into `supply`'s Play upload defaults. */
export function parseSupplyfile(content: string): SupplyfileData {
  const data: SupplyfileData = {};
  const packageName = rubyString(content, "package_name");
  if (packageName) data.packageName = packageName;
  const jsonKey = rubyString(content, "json_key");
  if (jsonKey) data.jsonKey = jsonKey;
  const track = rubyString(content, "track");
  if (track) data.track = track;
  return data;
}

/** The fastlane actions Launch recognizes, mapped to its own commands in the report (see {@link ACTION_NOTES}). */
const KNOWN_ACTIONS = [
  "build_app",
  "gym",
  "upload_to_testflight",
  "pilot",
  "upload_to_app_store",
  "deliver",
  "supply",
  "upload_to_play_store",
  "match",
  "sync_code_signing",
  "cert",
  "sigh",
  "get_certificates",
  "get_provisioning_profile",
  "capture_screenshots",
  "snapshot",
];

/** Parse a `Fastfile` into its lane names and the recognized actions used anywhere in it. */
export function parseFastfile(content: string): { lanes: string[]; actions: string[] } {
  const lanes = [...content.matchAll(/^\s*(?:private_)?lane\s+:([A-Za-z_]\w*)/gm)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  const actions = KNOWN_ACTIONS.filter((action) => new RegExp(`\\b${action}\\b`).test(content));
  return { lanes, actions };
}

/** Read a fastlane file from `<dir>/fastlane/<name>` (the convention) or `<dir>/<name>`, or undefined. */
function readFastlaneFile(dir: string, name: string): string | undefined {
  for (const candidate of [join(dir, "fastlane", name), join(dir, name)]) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  return undefined;
}

/** Read and parse every fastlane file present under `dir`; null when the project has no fastlane setup. */
export function readFastlaneSetup(dir: string): FastlaneSetup | null {
  const appfileRaw = readFastlaneFile(dir, "Appfile");
  const fastfileRaw = readFastlaneFile(dir, "Fastfile");
  const matchfileRaw = readFastlaneFile(dir, "Matchfile");
  const supplyfileRaw = readFastlaneFile(dir, "Supplyfile");
  const deliverfileRaw = readFastlaneFile(dir, "Deliverfile");
  if (!appfileRaw && !fastfileRaw && !matchfileRaw && !supplyfileRaw && !deliverfileRaw) return null;

  const fastfile = fastfileRaw ? parseFastfile(fastfileRaw) : { lanes: [], actions: [] };
  const setup: FastlaneSetup = {
    lanes: fastfile.lanes,
    actions: fastfile.actions,
    hasDeliverfile: deliverfileRaw !== undefined,
  };
  if (appfileRaw) setup.appfile = parseAppfile(appfileRaw);
  if (matchfileRaw) setup.matchfile = parseMatchfile(matchfileRaw);
  if (supplyfileRaw) setup.supply = parseSupplyfile(supplyfileRaw);
  return setup;
}

/** A recognized-action → Launch-command note: emitted once when any of its `actions` is present. */
interface ActionNote {
  actions: string[];
  level: MigrationNoteLevel;
  message: string;
}

/** Map recognized fastlane actions to the Launch command that replaces them. */
const ACTION_NOTES: ActionNote[] = [
  { actions: ["build_app", "gym"], level: "mapped", message: "fastlane built with gym/build_app → `launch build`." },
  {
    actions: ["upload_to_testflight", "pilot"],
    level: "mapped",
    message: "fastlane uploaded to TestFlight (pilot) → `launch release` on the testing track.",
  },
  {
    actions: ["upload_to_app_store", "deliver"],
    level: "mapped",
    message: "fastlane released with deliver → `launch release` plus `launch metadata` for the listing.",
  },
  {
    actions: ["supply", "upload_to_play_store"],
    level: "mapped",
    message: "fastlane uploaded to Play (supply) → `launch release` (Android) plus `launch metadata`.",
  },
  {
    actions: ["match", "sync_code_signing", "cert", "sigh", "get_certificates", "get_provisioning_profile"],
    level: "manual",
    message:
      "fastlane managed signing (match/cert/sigh) → Launch provisions and stores its own certificates in the OS keychain (see `launch explain code-signing`); you don't carry these over.",
  },
  {
    actions: ["capture_screenshots", "snapshot"],
    level: "manual",
    message: "fastlane captured screenshots — upload them with your listing via `launch metadata`.",
  },
];

/** Build the report notes from a parsed setup: lanes + signing as manual, action mappings, app facts as info. */
function buildNotes(setup: FastlaneSetup, apps: AppDescriptor[]): MigrationNote[] {
  const notes: MigrationNote[] = [];

  if (setup.lanes.length > 0) {
    notes.push({
      level: "manual",
      message: `Fastfile lanes (${setup.lanes.join(", ")}) have no 1:1 equivalent — Launch replaces lanes with \`launch build\`, \`launch release\`, and \`launch metadata\`.`,
    });
  }

  for (const mapping of ACTION_NOTES) {
    if (mapping.actions.some((action) => setup.actions.includes(action))) {
      notes.push({ level: mapping.level, message: mapping.message });
    }
  }

  if (setup.matchfile) {
    const parts: string[] = [];
    if (setup.matchfile.type) parts.push(`type "${setup.matchfile.type}"`);
    if (setup.matchfile.gitUrl) parts.push(`repo ${setup.matchfile.gitUrl}`);
    if (parts.length > 0) {
      notes.push({
        level: "info",
        message: `Matchfile signing config detected (${parts.join(", ")}) — informational; Launch uses its own signing.`,
      });
    }
  }

  const appfile = setup.appfile;
  if (appfile?.appleId || appfile?.teamId || appfile?.itcTeamId) {
    notes.push({
      level: "manual",
      message:
        "Appfile carried Apple account details (apple_id/team_id) — configure your Apple API key with `launch creds set-key`.",
    });
  }
  if (appfile?.appIdentifier) {
    notes.push({
      level: "info",
      message: `Appfile app_identifier ${appfile.appIdentifier} — Launch reads the bundle id from app.json; nothing to write.`,
    });
  }

  const supply = setup.supply;
  if (supply?.jsonKey) {
    notes.push({
      level: "manual",
      message: `Supplyfile referenced a Play service-account key (${supply.jsonKey}) — configure it with \`launch creds\`.`,
    });
  }
  if (supply?.track) {
    notes.push({
      level: "manual",
      message: `Supplyfile default Play track "${supply.track}" — set it as \`track\` on a profile in launch.config.ts.`,
    });
  }

  if (setup.hasDeliverfile) {
    notes.push({
      level: "manual",
      message: "Deliverfile configured App Store metadata — import your live listing with `launch metadata pull`.",
    });
  }

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
 * Migrate a fastlane project at `cwd` into Launch artifacts. Reads the fastlane files (required — at least
 * one must exist) and uses the already-discovered `apps` for the app facts; returns the artifacts to write
 * and the report notes. Never writes — `write.ts` owns persistence, so this stays trivially testable.
 */
export function migrateFastlane(cwd: string, apps: AppDescriptor[]): MigrationResult {
  const setup = readFastlaneSetup(cwd);
  if (!setup) {
    throw new Error(
      `No fastlane setup in ${cwd}. \`launch migrate fastlane\` reads an existing fastlane project (Appfile/Fastfile/Matchfile…).`,
    );
  }

  const artifacts: MigrationArtifact[] = [
    { path: "launch.config.ts", contents: configTemplate(detectAppRoot(apps, cwd)) },
    { path: ".env.example", contents: ENV_EXAMPLE_TEMPLATE },
  ];

  const notes = buildNotes(setup, apps);
  const store = scaffoldStoreConfig(cwd);
  if (store.artifact) artifacts.push(store.artifact);
  notes.push(store.note);

  return { source: "fastlane", artifacts, notes };
}
