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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { configTemplate, detectAppRoot } from '../configScaffold.js';
import {
  readAndroidMetadataDir,
  readAppleMetadataDir,
  serializeStoreConfig,
  type StoreConfig,
} from '../storeConfig.js';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.js';
import type {
  AppDescriptor,
  AppfileData,
  FastlaneLane,
  FastlaneSetup,
  MatchfileData,
  MigrationArtifact,
  MigrationNote,
  MigrationNoteLevel,
  MigrationResult,
  SupplyfileData,
} from '../types.js';

/**
 * Read the first value of a fastlane directive written as `key "value"`, `key 'value'`, or `key("value")`.
 * `key` is always a fixed literal here, so the built regex is safe; an empty value reads as absent.
 */
function rubyString(content: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}\\s*\\(?\\s*["']([^"']*)["']`, 'm').exec(content);
  const value = match?.[1];
  return value === undefined || value === '' ? undefined : value;
}

/** Parse an `Appfile` into the identifiers fastlane shares across actions. */
export function parseAppfile(content: string): AppfileData {
  const data: AppfileData = {};
  const appIdentifier = rubyString(content, 'app_identifier');
  if (appIdentifier) data.appIdentifier = appIdentifier;
  const appleId = rubyString(content, 'apple_id');
  if (appleId) data.appleId = appleId;
  const teamId = rubyString(content, 'team_id');
  if (teamId) data.teamId = teamId;
  const itcTeamId = rubyString(content, 'itc_team_id');
  if (itcTeamId) data.itcTeamId = itcTeamId;
  const packageName = rubyString(content, 'package_name');
  if (packageName) data.packageName = packageName;
  return data;
}

/** Parse a `Matchfile` into `match`'s signing strategy (all of which Launch replaces with its own). */
export function parseMatchfile(content: string): MatchfileData {
  const data: MatchfileData = {};
  const gitUrl = rubyString(content, 'git_url');
  if (gitUrl) data.gitUrl = gitUrl;
  const type = rubyString(content, 'type');
  if (type) data.type = type;
  const storageMode = rubyString(content, 'storage_mode');
  if (storageMode) data.storageMode = storageMode;
  const appIdentifier = rubyString(content, 'app_identifier');
  if (appIdentifier) data.appIdentifier = appIdentifier;
  return data;
}

/** Parse a `Supplyfile` into `supply`'s Play upload defaults. */
export function parseSupplyfile(content: string): SupplyfileData {
  const data: SupplyfileData = {};
  const packageName = rubyString(content, 'package_name');
  if (packageName) data.packageName = packageName;
  const jsonKey = rubyString(content, 'json_key');
  if (jsonKey) data.jsonKey = jsonKey;
  const track = rubyString(content, 'track');
  if (track) data.track = track;
  return data;
}

/** The fastlane actions Launch recognizes, mapped to its own commands in the report (see {@link ACTION_NOTES}). */
const KNOWN_ACTIONS = [
  'build_app',
  'gym',
  'upload_to_testflight',
  'pilot',
  'upload_to_app_store',
  'deliver',
  'supply',
  'upload_to_play_store',
  'match',
  'sync_code_signing',
  'cert',
  'sigh',
  'get_certificates',
  'get_provisioning_profile',
  'capture_screenshots',
  'snapshot',
];

/** Whether a recognized action appears as a whole word in `text`. KNOWN_ACTIONS are `\w`-only, so the pattern is safe. */
function wordInside(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(text);
}

/** The `platform :ios`/`:android` block a lane at `index` sits in: the nearest preceding `platform … do`, if any. */
function platformBefore(content: string, index: number): string | undefined {
  let platform: string | undefined;
  const re = /^[ \t]*platform\s+:([A-Za-z_]\w*)\s+do\b/gm;
  for (let match = re.exec(content); match && match.index < index; match = re.exec(content)) {
    platform = match[1];
  }
  return platform;
}

/**
 * Parse a `Fastfile` into its lanes (each with the recognized actions in its body) and the recognized
 * actions used anywhere in the file. A lane's body is the text from its `do` to the next lane declaration
 * (or EOF) — a deliberately tolerant line-scan, not a Ruby parser, so a nested block never breaks it; the
 * over-capture of the final lane's body is harmless since we only look for known action names.
 */
export function parseFastfile(content: string): { lanes: FastlaneLane[]; actions: string[] } {
  const declarations = [...content.matchAll(/^[ \t]*(?:private_)?lane\s+:([A-Za-z_]\w*)\s+do\b/gm)];
  const lanes: FastlaneLane[] = [];
  for (let i = 0; i < declarations.length; i++) {
    const declaration = declarations[i];
    if (!declaration) continue;
    const name = declaration[1];
    const start = declaration.index;
    if (name === undefined) continue;
    const bodyStart = start + declaration[0].length;
    const bodyEnd = declarations[i + 1]?.index ?? content.length;
    const body = content.slice(bodyStart, bodyEnd);
    const actions = KNOWN_ACTIONS.filter((action) => wordInside(body, action));
    const platform = platformBefore(content, start);
    lanes.push(platform === undefined ? { name, actions } : { name, platform, actions });
  }
  const actions = KNOWN_ACTIONS.filter((action) => wordInside(content, action));
  return { lanes, actions };
}

/**
 * Discover env var KEYS from fastlane dotenv files (`fastlane/.env`, `fastlane/.env.<environment>`).
 * fastlane-dotenv expresses values inline; Launch's `.env.example` carries keys only (values may be
 * secrets), so this returns the sorted unique keys to seed it. `.env.example`/`.env.sample` are skipped
 * to avoid re-reading a scaffold. Empty when the project has no fastlane dotenv setup.
 */
function discoverDotenvKeys(dir: string): string[] {
  const fastlaneDir = join(dir, 'fastlane');
  if (!existsSync(fastlaneDir)) return [];
  const keys = new Set<string>();
  for (const name of readdirSync(fastlaneDir)) {
    if (!name.startsWith('.env') || name === '.env.example' || name === '.env.sample') continue;
    const path = join(fastlaneDir, name);
    if (!statSync(path).isFile()) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(line);
      if (match?.[1]) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

/** Read a fastlane file from `<dir>/fastlane/<name>` (the convention) or `<dir>/<name>`, or undefined. */
function readFastlaneFile(dir: string, name: string): string | undefined {
  for (const candidate of [join(dir, 'fastlane', name), join(dir, name)]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  return undefined;
}

/** Read and parse every fastlane file present under `dir`; null when the project has no fastlane setup. */
export function readFastlaneSetup(dir: string): FastlaneSetup | null {
  const appfileRaw = readFastlaneFile(dir, 'Appfile');
  const fastfileRaw = readFastlaneFile(dir, 'Fastfile');
  const matchfileRaw = readFastlaneFile(dir, 'Matchfile');
  const supplyfileRaw = readFastlaneFile(dir, 'Supplyfile');
  const deliverfileRaw = readFastlaneFile(dir, 'Deliverfile');
  if (!appfileRaw && !fastfileRaw && !matchfileRaw && !supplyfileRaw && !deliverfileRaw)
    return null;

  const fastfile = fastfileRaw ? parseFastfile(fastfileRaw) : { lanes: [], actions: [] };
  const setup: FastlaneSetup = {
    lanes: fastfile.lanes,
    actions: fastfile.actions,
    hasDeliverfile: deliverfileRaw !== undefined,
    envKeys: discoverDotenvKeys(dir),
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
  {
    actions: ['build_app', 'gym'],
    level: 'mapped',
    message: 'fastlane built with gym/build_app → `launch build`.',
  },
  {
    actions: ['upload_to_testflight', 'pilot'],
    level: 'mapped',
    message: 'fastlane uploaded to TestFlight (pilot) → `launch release` on the testing track.',
  },
  {
    actions: ['upload_to_app_store', 'deliver'],
    level: 'mapped',
    message:
      'fastlane released with deliver → `launch release` plus `launch metadata` for the listing.',
  },
  {
    actions: ['supply', 'upload_to_play_store'],
    level: 'mapped',
    message:
      'fastlane uploaded to Play (supply) → `launch release` (Android) plus `launch metadata`.',
  },
  {
    actions: [
      'match',
      'sync_code_signing',
      'cert',
      'sigh',
      'get_certificates',
      'get_provisioning_profile',
    ],
    level: 'manual',
    message:
      "fastlane managed signing (match/cert/sigh) → Launch provisions and stores its own certificates in the OS keychain (see `launch explain code-signing`); you don't carry these over.",
  },
  {
    actions: ['capture_screenshots', 'snapshot'],
    level: 'manual',
    message: 'fastlane captured screenshots — upload them with your listing via `launch metadata`.',
  },
];

/**
 * The Launch command a build/release action maps onto, for per-lane mapping. Only the pipeline actions are
 * here: signing (match/cert/sigh) and screenshots map to keychain/metadata, explained once in
 * {@link ACTION_NOTES} rather than per lane, so they're deliberately absent.
 */
const ACTION_COMMAND: Record<string, string> = {
  build_app: 'launch build',
  gym: 'launch build',
  upload_to_testflight: 'launch release --track testing',
  pilot: 'launch release --track testing',
  upload_to_app_store: 'launch release',
  deliver: 'launch release',
  supply: 'launch release (Android)',
  upload_to_play_store: 'launch release (Android)',
};

/** The distinct Launch commands a lane's actions map to, in first-seen order (empty for a custom/signing-only lane). */
function laneCommands(lane: FastlaneLane): string[] {
  const commands: string[] = [];
  for (const action of lane.actions) {
    const command = ACTION_COMMAND[action];
    if (command && !commands.includes(command)) commands.push(command);
  }
  return commands;
}

/**
 * Per-lane mapping notes: a lane whose body maps to Launch pipeline commands becomes a `mapped` note
 * naming them; a lane with no recognized actions at all is collected into one `manual` note (it's a
 * custom workflow to recreate by hand). Signing/screenshot-only lanes get neither — {@link ACTION_NOTES}
 * already explains those actions globally.
 */
function laneNotes(lanes: FastlaneLane[]): MigrationNote[] {
  const notes: MigrationNote[] = [];
  const custom: string[] = [];
  for (const lane of lanes) {
    const commands = laneCommands(lane);
    if (commands.length > 0) {
      const label = lane.platform ? `lane :${lane.name} (${lane.platform})` : `lane :${lane.name}`;
      notes.push({ level: 'mapped', message: `${label} → ${commands.join(' + ')}.` });
    } else if (lane.actions.length === 0) {
      custom.push(lane.name);
    }
  }
  if (custom.length > 0) {
    notes.push({
      level: 'manual',
      message: `Custom lanes (${custom.join(', ')}) had no recognized actions — Launch replaces lanes with \`launch build\`, \`launch release\`, and \`launch metadata\`; recreate these by hand.`,
    });
  }
  return notes;
}

/**
 * Build the report notes from a parsed setup: per-lane mappings, action mappings, signing as manual, app
 * facts as info. When `importedMetadata` is true the listing was imported from `fastlane/metadata`, so the
 * Deliverfile follow-up (which points at `launch metadata pull`) is suppressed as already done.
 */
function buildNotes(
  setup: FastlaneSetup,
  apps: AppDescriptor[],
  importedMetadata: boolean,
): MigrationNote[] {
  const notes: MigrationNote[] = [...laneNotes(setup.lanes)];

  for (const mapping of ACTION_NOTES) {
    if (mapping.actions.some((action) => setup.actions.includes(action))) {
      notes.push({ level: mapping.level, message: mapping.message });
    }
  }

  if (setup.matchfile) {
    const parts: string[] = [];
    if (setup.matchfile.type) parts.push(`type "${setup.matchfile.type}"`);
    if (setup.matchfile.storageMode) parts.push(`storage "${setup.matchfile.storageMode}"`);
    if (setup.matchfile.gitUrl) parts.push(`repo ${setup.matchfile.gitUrl}`);
    if (parts.length > 0) {
      const backend =
        setup.matchfile.storageMode && setup.matchfile.storageMode !== 'git'
          ? ` Your certificates live in ${setup.matchfile.storageMode}, not git — Launch doesn't read them; it provisions fresh.`
          : '';
      notes.push({
        level: 'info',
        message: `Matchfile signing config detected (${parts.join(', ')}) — informational; Launch uses its own signing.${backend}`,
      });
    }
  }

  const appfile = setup.appfile;
  if (appfile?.appleId || appfile?.teamId || appfile?.itcTeamId) {
    notes.push({
      level: 'manual',
      message:
        'Appfile carried Apple account details (apple_id/team_id) — configure your Apple API key with `launch creds set-key`.',
    });
  }
  if (appfile?.appIdentifier) {
    notes.push({
      level: 'info',
      message: `Appfile app_identifier ${appfile.appIdentifier} — Launch reads the bundle id from app.json; nothing to write.`,
    });
  }

  const supply = setup.supply;
  if (supply?.jsonKey) {
    notes.push({
      level: 'manual',
      message: `Supplyfile referenced a Play service-account key (${supply.jsonKey}) — configure it with \`launch creds\`.`,
    });
  }
  if (supply?.track) {
    notes.push({
      level: 'manual',
      message: `Supplyfile default Play track "${supply.track}" — set it as \`track\` on a profile in launch.config.ts.`,
    });
  }

  if (setup.hasDeliverfile && !importedMetadata) {
    notes.push({
      level: 'manual',
      message:
        'Deliverfile configured App Store metadata — import your live listing with `launch metadata pull`.',
    });
  }

  for (const app of apps) {
    if (app.bundleId) {
      notes.push({
        level: 'info',
        message: `Detected iOS bundle id ${app.bundleId} for "${app.name}" — read from app.json; nothing to write.`,
      });
    }
    if (app.packageName) {
      notes.push({
        level: 'info',
        message: `Detected Android package ${app.packageName} for "${app.name}" — read from app.json; nothing to write.`,
      });
    }
  }

  return notes;
}

/**
 * Import a fastlane `deliver`/`supply` metadata folder into a `store.config.json` artifact. fastlane keeps
 * the App Store listing under `fastlane/metadata` and the Play listing under `fastlane/metadata/android`,
 * the exact layouts `storeConfig.ts` already reads — so this reuses those readers rather than re-parsing.
 * Returns null when neither folder holds any localized text (nothing to import).
 */
function importFastlaneMetadata(
  cwd: string,
): { artifact: MigrationArtifact; note: MigrationNote } | null {
  const apple = readAppleMetadataDir(join(cwd, 'fastlane', 'metadata'));
  const android = readAndroidMetadataDir(join(cwd, 'fastlane', 'metadata', 'android'));
  const appleLocales = Object.keys(apple.info).length;
  const androidLocales = Object.keys(android.info).length;
  if (appleLocales === 0 && androidLocales === 0) return null;

  const config: StoreConfig = { configVersion: 0 };
  const imported: string[] = [];
  if (appleLocales > 0) {
    config.apple = apple;
    imported.push(`${appleLocales} App Store locale(s)`);
  }
  if (androidLocales > 0) {
    config.android = android;
    imported.push(`${androidLocales} Play locale(s)`);
  }
  return {
    artifact: { path: 'store.config.json', contents: serializeStoreConfig(config) },
    note: {
      level: 'mapped',
      message: `Imported your fastlane metadata (${imported.join(', ')}) into store.config.json — review it, then push with \`launch metadata push\`.`,
    },
  };
}

/**
 * Migrate a fastlane project at `cwd` into Launch artifacts. Reads the fastlane files (required — at least
 * one must exist) and uses the already-discovered `apps` for the app facts; returns the artifacts to write
 * and the report notes. Never writes — `write.ts` owns persistence, so this stays trivially testable.
 *
 * The listing comes from the project's own `store.config.json` (kept verbatim), else its `fastlane/metadata`
 * folder (imported), else an empty skeleton — most-faithful source first.
 */
export function migrateFastlane(cwd: string, apps: AppDescriptor[]): MigrationResult {
  const setup = readFastlaneSetup(cwd);
  if (!setup) {
    throw new Error(
      `No fastlane setup in ${cwd}. \`launch migrate fastlane\` reads an existing fastlane project (Appfile/Fastfile/Matchfile…).`,
    );
  }

  const artifacts: MigrationArtifact[] = [
    { path: 'launch.config.ts', contents: configTemplate(detectAppRoot(apps, cwd)) },
    { path: '.env.example', contents: buildEnvExample(setup.envKeys) },
  ];

  const imported = existsSync(join(cwd, 'store.config.json')) ? null : importFastlaneMetadata(cwd);
  const store = imported ?? scaffoldStoreConfig(cwd);
  const notes = buildNotes(setup, apps, imported !== null);
  if (store.artifact) artifacts.push(store.artifact);
  notes.push(store.note);

  return { source: 'fastlane', artifacts, notes };
}
