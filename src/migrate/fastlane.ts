import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { configTemplate, detectAppRoot } from '../config/config-scaffold.ts';
import { pathExists } from '../path-exists.ts';
import {
  readAndroidMetadataDir,
  readAppleMetadataDir,
  serializeStoreConfig,
  type StoreConfig,
} from '../store/shared/store-config.ts';
import type { AppDescriptor } from '../types/app.ts';
import type {
  AppfileData,
  FastlaneLane,
  MatchfileData,
  MigrationArtifact,
  MigrationNote,
  MigrationNoteLevel,
  MigrationResult,
  SupplyfileData,
} from '../types/migrate.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.ts';

/**
 * A parsed fastlane setup, narrowed to what Launch reads from the standard files. Lanes and recognized
 * actions drive the report (Launch's pipeline replaces lanes); the per-file blocks are present only when
 * that file existed. Mirrors {@link EasJson} as the file-based input to a migration source.
 */
type FastlaneSetup = Readonly<{
  appfile?: AppfileData;
  matchfile?: MatchfileData;
  supply?: SupplyfileData;
  lanes: readonly FastlaneLane[];
  actions: readonly string[];
  hasDeliverfile: boolean;
  envKeys: readonly string[];
}>;

export type FastlaneMigrationFailure = Readonly<{
  readonly _tag: 'FastlaneMigrationFailure';
  readonly reason: 'MissingFastlaneSetup';
  readonly sourcePath: string;
}>;

function makeFastlaneMigrationFailure(fields: {
  reason: 'MissingFastlaneSetup';
  sourcePath: string;
}): FastlaneMigrationFailure {
  return { _tag: 'FastlaneMigrationFailure', ...fields };
}

/** Read a top-level Fastlane Ruby string directive (`name "value"` / `name("value")`). */
export function readRubyString(rubySource: string, directiveName: string): string | undefined {
  const directiveMatch = new RegExp(`^\\s*${directiveName}\\s*\\(?\\s*["']([^"']*)["']`, 'm').exec(
    rubySource,
  );
  if (directiveMatch == null) return undefined;
  const directiveText = directiveMatch[1];
  if (directiveText == null) return undefined;
  if (directiveText == '') return undefined;
  return directiveText;
}

export function parseAppfile(appfileSource: string): AppfileData {
  const appfile: MutableDeep<AppfileData> = {};
  const appIdentifier = readRubyString(appfileSource, 'app_identifier');
  if (appIdentifier != null) appfile.appIdentifier = appIdentifier;
  const appleId = readRubyString(appfileSource, 'apple_id');
  if (appleId != null) appfile.appleId = appleId;
  const teamId = readRubyString(appfileSource, 'team_id');
  if (teamId != null) appfile.teamId = teamId;
  const itcTeamId = readRubyString(appfileSource, 'itc_team_id');
  if (itcTeamId != null) appfile.itcTeamId = itcTeamId;
  const packageName = readRubyString(appfileSource, 'package_name');
  if (packageName != null) appfile.packageName = packageName;
  return appfile;
}

export function parseMatchfile(matchfileSource: string): MatchfileData {
  const matchfile: MutableDeep<MatchfileData> = {};
  const gitUrl = readRubyString(matchfileSource, 'git_url');
  if (gitUrl != null) matchfile.gitUrl = gitUrl;
  const signingType = readRubyString(matchfileSource, 'type');
  if (signingType != null) matchfile.type = signingType;
  const storageMode = readRubyString(matchfileSource, 'storage_mode');
  if (storageMode != null) matchfile.storageMode = storageMode;
  const appIdentifier = readRubyString(matchfileSource, 'app_identifier');
  if (appIdentifier != null) matchfile.appIdentifier = appIdentifier;
  return matchfile;
}

export function parseSupplyfile(supplyfileSource: string): SupplyfileData {
  const supplyfile: MutableDeep<SupplyfileData> = {};
  const packageName = readRubyString(supplyfileSource, 'package_name');
  if (packageName != null) supplyfile.packageName = packageName;
  const jsonKey = readRubyString(supplyfileSource, 'json_key');
  if (jsonKey != null) supplyfile.jsonKey = jsonKey;
  const trackName = readRubyString(supplyfileSource, 'track');
  if (trackName != null) supplyfile.track = trackName;
  return supplyfile;
}

/** One recognized Fastlane action group: detection names, optional Launch command, report note. */
type FastlaneActionGroup = Readonly<{
  actions: readonly string[];
  launchCommand?: string;
  noteLevel: MigrationNoteLevel;
  noteMessage: string;
}>;

const FASTLANE_ACTION_GROUPS: readonly FastlaneActionGroup[] = [
  {
    actions: ['build_app', 'gym'],
    launchCommand: 'launch-store build',
    noteLevel: 'mapped',
    noteMessage: 'fastlane built with gym/build_app -> `launch-store build`.',
  },
  {
    actions: ['upload_to_testflight', 'pilot'],
    launchCommand: 'launch-store release --track testing',
    noteLevel: 'mapped',
    noteMessage:
      'fastlane uploaded to TestFlight (pilot) -> `launch-store release` on the testing track.',
  },
  {
    actions: ['upload_to_app_store', 'deliver'],
    launchCommand: 'launch-store release',
    noteLevel: 'mapped',
    noteMessage:
      'fastlane released with deliver -> `launch-store release` plus `launch-store metadata` for the listing.',
  },
  {
    actions: ['supply', 'upload_to_play_store'],
    launchCommand: 'launch-store release (Android)',
    noteLevel: 'mapped',
    noteMessage:
      'fastlane uploaded to Play (supply) -> `launch-store release` (Android) plus `launch-store metadata`.',
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
    noteLevel: 'manual',
    noteMessage:
      "fastlane managed signing (match/cert/sigh) -> Launch provisions and stores its own certificates in the OS keychain (see `launch-store explain code-signing`); you don't carry these over.",
  },
  {
    actions: ['capture_screenshots', 'snapshot'],
    noteLevel: 'manual',
    noteMessage:
      'fastlane captured screenshots - upload them with your listing via `launch-store metadata`.',
  },
];
function readActions(actionGroup: {
  readonly actions: readonly string[];
  readonly launchCommand?: string;
  readonly noteLevel: MigrationNoteLevel;
  readonly noteMessage: string;
}) {
  return actionGroup.actions;
}

const KNOWN_ACTIONS: readonly string[] = FASTLANE_ACTION_GROUPS.flatMap(readActions);

const ACTION_LAUNCH_COMMAND: Record<string, string> = {};
for (const actionGroup of FASTLANE_ACTION_GROUPS) {
  if (actionGroup.launchCommand == null) continue;
  for (const actionName of actionGroup.actions) {
    ACTION_LAUNCH_COMMAND[actionName] = actionGroup.launchCommand;
  }
}

function containsAction(rubySource: string, actionName: string): boolean {
  return new RegExp(`\\b${actionName}\\b`).test(rubySource);
}

function findLanePlatform(fastfileSource: string, laneStartIndex: number): string | undefined {
  let lanePlatform: string | undefined;
  const platformPattern = /^[ \t]*platform\s+:([A-Za-z_]\w*)\s+do\b/gm;
  for (
    let platformMatch = platformPattern.exec(fastfileSource);
    platformMatch != null && platformMatch.index < laneStartIndex;
    platformMatch = platformPattern.exec(fastfileSource)
  ) {
    lanePlatform = platformMatch[1];
  }
  return lanePlatform;
}

/** Parse lane names and recognized actions without interpreting arbitrary Ruby. */
export function parseFastfile(fastfileSource: string): {
  lanes: FastlaneLane[];
  actions: string[];
} {
  const laneDeclarations = [
    ...fastfileSource.matchAll(/^[ \t]*(?:private_)?lane\s+:([A-Za-z_]\w*)\s+do\b/gm),
  ];
  const fastlaneLanes: FastlaneLane[] = [];
  for (const [declarationIndex, laneDeclaration] of laneDeclarations.entries()) {
    const laneName = laneDeclaration[1];
    if (laneName == null) continue;
    const laneStartIndex = laneDeclaration.index;
    const laneSourceStart = laneStartIndex + laneDeclaration[0].length;
    let laneSourceEnd = fastfileSource.length;
    const nextDeclaration = laneDeclarations[declarationIndex + 1];
    if (nextDeclaration != null) laneSourceEnd = nextDeclaration.index;
    const laneSource = fastfileSource.slice(laneSourceStart, laneSourceEnd);
    function filterActionName(actionName: string) {
      return containsAction(laneSource, actionName);
    }

    const laneActions = KNOWN_ACTIONS.filter(filterActionName);
    const lanePlatform = findLanePlatform(fastfileSource, laneStartIndex);
    const fastlaneLane: MutableDeep<FastlaneLane> = { name: laneName, actions: laneActions };
    if (lanePlatform != null) fastlaneLane.platform = lanePlatform;
    fastlaneLanes.push(fastlaneLane);
  }
  function filterActionName2(actionName: string) {
    return containsAction(fastfileSource, actionName);
  }

  return {
    lanes: fastlaneLanes,
    actions: KNOWN_ACTIONS.filter(filterActionName2),
  };
}

async function discoverDotenvKeys(workingDirectory: string): Promise<string[]> {
  const fastlaneDirectory = join(workingDirectory, 'fastlane');
  const directoryExists = await pathExists(fastlaneDirectory);

  if (directoryExists == false) {
    return [];
  }

  const environmentKeys = new Set<string>();
  const entryNames = await readdir(fastlaneDirectory);

  for (const entryName of entryNames) {
    const isDotenv = entryName.startsWith('.env');

    if (isDotenv == false) {
      continue;
    }

    if (entryName == '.env.example') {
      continue;
    }

    if (entryName == '.env.sample') {
      continue;
    }

    const dotenvPath = join(fastlaneDirectory, entryName);
    const dotenvStat = await stat(dotenvPath);

    if (dotenvStat.isFile() == false) {
      continue;
    }

    const dotenvSource = await readFile(dotenvPath, 'utf8');

    for (const dotenvLine of dotenvSource.split('\n')) {
      // Optional `export`, then a shell name, then `=`.
      const assignmentMatch = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(dotenvLine);

      if (assignmentMatch == null) {
        continue;
      }

      const environmentKey = assignmentMatch[1];

      if (environmentKey != null) {
        environmentKeys.add(environmentKey);
      }
    }
  }

  return [...environmentKeys].sort();
}

async function readFastlaneFile(
  workingDirectory: string,
  fileName: string,
): Promise<string | undefined> {
  const candidatePaths = [
    join(workingDirectory, 'fastlane', fileName),
    join(workingDirectory, fileName),
  ];

  for (const candidatePath of candidatePaths) {
    const candidateExists = await pathExists(candidatePath);

    if (candidateExists) {
      return readFile(candidatePath, 'utf8');
    }
  }

  return undefined;
}

/** Read supported Fastlane files; null when no setup exists. */
export async function readFastlaneSetup(workingDirectory: string): Promise<FastlaneSetup | null> {
  const fastlaneSources = {
    appfile: await readFastlaneFile(workingDirectory, 'Appfile'),
    fastfile: await readFastlaneFile(workingDirectory, 'Fastfile'),
    matchfile: await readFastlaneFile(workingDirectory, 'Matchfile'),
    supplyfile: await readFastlaneFile(workingDirectory, 'Supplyfile'),
    deliverfile: await readFastlaneFile(workingDirectory, 'Deliverfile'),
    environmentKeys: await discoverDotenvKeys(workingDirectory),
  };
  const setup = finishFastlaneSetup(fastlaneSources);

  return setup;
}

function finishFastlaneSetup(fastlaneSources: {
  appfile: string | undefined;
  fastfile: string | undefined;
  matchfile: string | undefined;
  supplyfile: string | undefined;
  deliverfile: string | undefined;
  environmentKeys: string[];
}): FastlaneSetup | null {
  let hasFastlaneSource = fastlaneSources.appfile != null;

  if (fastlaneSources.fastfile != null) {
    hasFastlaneSource = true;
  }

  if (fastlaneSources.matchfile != null) {
    hasFastlaneSource = true;
  }

  if (fastlaneSources.supplyfile != null) {
    hasFastlaneSource = true;
  }

  if (fastlaneSources.deliverfile != null) {
    hasFastlaneSource = true;
  }

  if (hasFastlaneSource == false) {
    return null;
  }

  let parsedFastfile: { lanes: FastlaneLane[]; actions: string[] } = {
    lanes: [],
    actions: [],
  };

  if (fastlaneSources.fastfile != null) {
    parsedFastfile = parseFastfile(fastlaneSources.fastfile);
  }

  let appfile: AppfileData | undefined;

  if (fastlaneSources.appfile != null) {
    appfile = parseAppfile(fastlaneSources.appfile);
  }

  let matchfile: MatchfileData | undefined;

  if (fastlaneSources.matchfile != null) {
    matchfile = parseMatchfile(fastlaneSources.matchfile);
  }

  let supply: SupplyfileData | undefined;

  if (fastlaneSources.supplyfile != null) {
    supply = parseSupplyfile(fastlaneSources.supplyfile);
  }

  const fastlaneSetup: {
    appfile?: AppfileData;
    matchfile?: MatchfileData;
    supply?: SupplyfileData;
    lanes: readonly FastlaneLane[];
    actions: readonly string[];
    hasDeliverfile: boolean;
    envKeys: readonly string[];
  } = {
    lanes: parsedFastfile.lanes,
    actions: parsedFastfile.actions,
    hasDeliverfile: fastlaneSources.deliverfile != null,
    envKeys: fastlaneSources.environmentKeys,
  };

  if (appfile != null) {
    fastlaneSetup.appfile = appfile;
  }

  if (matchfile != null) {
    fastlaneSetup.matchfile = matchfile;
  }

  if (supply != null) {
    fastlaneSetup.supply = supply;
  }

  return fastlaneSetup;
}
/** Distinct Launch commands mapped from recognized actions on one lane. */
export function laneLaunchCommands(fastlaneLane: FastlaneLane): string[] {
  const launchCommands: string[] = [];
  for (const actionName of fastlaneLane.actions) {
    const launchCommand = ACTION_LAUNCH_COMMAND[actionName];
    if (launchCommand == null) continue;
    if (!launchCommands.includes(launchCommand)) launchCommands.push(launchCommand);
  }
  return launchCommands;
}

function laneNotes(fastlaneLanes: readonly FastlaneLane[]): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];
  const customLaneNames: string[] = [];
  for (const fastlaneLane of fastlaneLanes) {
    const launchCommands = laneLaunchCommands(fastlaneLane);
    if (launchCommands.length > 0) {
      let laneLabel = `lane :${fastlaneLane.name}`;
      if (fastlaneLane.platform != null) {
        laneLabel = `${laneLabel} (${fastlaneLane.platform})`;
      }
      migrationNotes.push({
        level: 'mapped',
        message: `${laneLabel} -> ${launchCommands.join(' + ')}.`,
      });
      continue;
    }
    if (fastlaneLane.actions.length == 0) customLaneNames.push(fastlaneLane.name);
  }
  if (customLaneNames.length > 0) {
    migrationNotes.push({
      level: 'manual',
      message: `Custom lanes (${customLaneNames.join(', ')}) had no recognized actions - Launch replaces lanes with \`launch-store build\`, \`launch-store release\`, and \`launch-store metadata\`; recreate these by hand.`,
    });
  }
  return migrationNotes;
}

function matchfileNotes(matchfile: MatchfileData): MigrationNote[] {
  const signingParts: string[] = [];
  if (matchfile.type != null) signingParts.push(`type "${matchfile.type}"`);
  if (matchfile.storageMode != null) {
    signingParts.push(`storage "${matchfile.storageMode}"`);
  }
  if (matchfile.gitUrl != null) signingParts.push(`repo ${matchfile.gitUrl}`);
  if (signingParts.length == 0) return [];
  let storageExplanation = '';
  const storageMode = matchfile.storageMode;
  if (storageMode != null && storageMode != 'git') {
    storageExplanation = ` Your certificates live in ${storageMode}, not git - Launch doesn't read them; it provisions fresh.`;
  }
  return [
    {
      level: 'info',
      message: `Matchfile signing config detected (${signingParts.join(', ')}) - informational; Launch uses its own signing.${storageExplanation}`,
    },
  ];
}

function appfileNotes(appfile: AppfileData): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];
  let hasAppleAccount = appfile.appleId != null;
  if (appfile.teamId != null) hasAppleAccount = true;
  if (appfile.itcTeamId != null) hasAppleAccount = true;
  if (hasAppleAccount) {
    migrationNotes.push({
      level: 'manual',
      message:
        'Appfile carried Apple account details (apple_id/team_id) - configure your Apple API key with `launch-store creds set-key`.',
    });
  }
  if (appfile.appIdentifier != null) {
    migrationNotes.push({
      level: 'info',
      message: `Appfile app_identifier ${appfile.appIdentifier} - Launch reads the bundle id from app.json; nothing to write.`,
    });
  }
  return migrationNotes;
}

function supplyNotes(supplyfile: SupplyfileData): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];
  if (supplyfile.jsonKey != null) {
    migrationNotes.push({
      level: 'manual',
      message: `Supplyfile referenced a Play service-account key (${supplyfile.jsonKey}) - configure it with \`launch-store creds\`.`,
    });
  }
  if (supplyfile.track != null) {
    migrationNotes.push({
      level: 'manual',
      message: `Supplyfile default Play track "${supplyfile.track}" - set it as \`track\` on a profile in launch.config.ts.`,
    });
  }
  return migrationNotes;
}

function appDescriptorNotes(apps: AppDescriptor[]): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];
  for (const app of apps) {
    if (app.bundleId != null) {
      migrationNotes.push({
        level: 'info',
        message: `Detected iOS bundle id ${app.bundleId} for "${app.name}" - read from app.json; nothing to write.`,
      });
    }
    if (app.packageName != null) {
      migrationNotes.push({
        level: 'info',
        message: `Detected Android package ${app.packageName} for "${app.name}" - read from app.json; nothing to write.`,
      });
    }
  }
  return migrationNotes;
}

/** Pure report notes for a parsed Fastlane setup (no filesystem). */
export function migrationNotesFor(
  fastlaneSetup: FastlaneSetup,
  apps: AppDescriptor[],
  importedMetadata: boolean,
): MigrationNote[] {
  const migrationNotes = laneNotes(fastlaneSetup.lanes);
  for (const actionGroup of FASTLANE_ACTION_GROUPS) {
    function someActionName(actionName: string) {
      return fastlaneSetup.actions.includes(actionName);
    }

    const groupPresent = actionGroup.actions.some(someActionName);
    if (!groupPresent) continue;
    migrationNotes.push({ level: actionGroup.noteLevel, message: actionGroup.noteMessage });
  }
  if (fastlaneSetup.matchfile != null) {
    migrationNotes.push(...matchfileNotes(fastlaneSetup.matchfile));
  }
  if (fastlaneSetup.appfile != null) {
    migrationNotes.push(...appfileNotes(fastlaneSetup.appfile));
  }
  if (fastlaneSetup.supply != null) {
    migrationNotes.push(...supplyNotes(fastlaneSetup.supply));
  }
  if (fastlaneSetup.hasDeliverfile && !importedMetadata) {
    migrationNotes.push({
      level: 'manual',
      message:
        'Deliverfile configured App Store metadata - import your live listing with `launch-store metadata pull`.',
    });
  }
  migrationNotes.push(...appDescriptorNotes(apps));
  return migrationNotes;
}

type StoreScaffoldOutcome = Readonly<{
  artifact: MigrationArtifact | null;
  note: MigrationNote;
}>;

function isZeroCount(localeCount: number): boolean {
  return localeCount == 0;
}

async function importFastlaneMetadata(
  workingDirectory: string,
): Promise<StoreScaffoldOutcome | null> {
  const appleMetadataDirectory = join(workingDirectory, 'fastlane', 'metadata');
  const androidMetadataDirectory = join(appleMetadataDirectory, 'android');
  const appleListingPromise = readAppleMetadataDir(appleMetadataDirectory);
  const androidListingPromise = readAndroidMetadataDir(androidMetadataDirectory);
  const appleListing = await appleListingPromise;
  const androidListing = await androidListingPromise;
  const appleLocaleCount = Object.keys(appleListing.info).length;
  const androidLocaleCount = Object.keys(androidListing.info).length;
  const hasNoImportedLocales = [appleLocaleCount, androidLocaleCount].every(isZeroCount);

  if (hasNoImportedLocales) {
    return null;
  }

  const storeConfiguration: StoreConfig = { configVersion: 0 };
  const importedListingLabels: string[] = [];

  if (appleLocaleCount > 0) {
    storeConfiguration.apple = appleListing;
    importedListingLabels.push(`${appleLocaleCount} App Store locale(s)`);
  }

  if (androidLocaleCount > 0) {
    storeConfiguration.android = androidListing;
    importedListingLabels.push(`${androidLocaleCount} Play locale(s)`);
  }

  return {
    artifact: {
      path: 'store.config.json',
      contents: serializeStoreConfig(storeConfiguration),
    },
    note: {
      level: 'mapped',
      message: `Imported your fastlane metadata (${importedListingLabels.join(', ')}) into store.config.json - review it, then push with \`launch-store metadata push\`.`,
    },
  };
}

/** Resolve store.config.json: reuse existing, import metadata, or scaffold. */
async function storeScaffoldFor(workingDirectory: string): Promise<{
  storeScaffold: StoreScaffoldOutcome;
  importedMetadata: boolean;
}> {
  const storeConfigPath = join(workingDirectory, 'store.config.json');
  const storeConfigExists = await pathExists(storeConfigPath);

  if (storeConfigExists) {
    const existingScaffold = await scaffoldStoreConfig(workingDirectory);

    return { storeScaffold: existingScaffold, importedMetadata: false };
  }

  const importedStoreConfig = await importFastlaneMetadata(workingDirectory);

  if (importedStoreConfig == null) {
    const scaffoldedStoreConfig = await scaffoldStoreConfig(workingDirectory);

    return { storeScaffold: scaffoldedStoreConfig, importedMetadata: false };
  }

  return { storeScaffold: importedStoreConfig, importedMetadata: true };
}

/** Read a Fastlane project and return Launch artifacts without writing them. */
export async function migrateFastlane(
  workingDirectory: string,
  apps: AppDescriptor[],
): Promise<MigrationResult> {
  const fastlaneSetup = await readFastlaneSetup(workingDirectory);

  if (fastlaneSetup == null) {
    throw makeFastlaneMigrationFailure({
      reason: 'MissingFastlaneSetup',
      sourcePath: workingDirectory,
    });
  }

  const appRoot = detectAppRoot(apps, workingDirectory);
  const migrationArtifacts: MigrationArtifact[] = [
    {
      path: 'launch.config.ts',
      contents: configTemplate(appRoot),
    },
    {
      path: '.env.example',
      contents: buildEnvExample(fastlaneSetup.envKeys),
    },
  ];
  const storeScaffoldPlan = await storeScaffoldFor(workingDirectory);
  const migrationNotes = migrationNotesFor(fastlaneSetup, apps, storeScaffoldPlan.importedMetadata);

  if (storeScaffoldPlan.storeScaffold.artifact != null) {
    migrationArtifacts.push(storeScaffoldPlan.storeScaffold.artifact);
  }

  migrationNotes.push(storeScaffoldPlan.storeScaffold.note);

  return { source: 'fastlane', artifacts: migrationArtifacts, notes: migrationNotes };
}
