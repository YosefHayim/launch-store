import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Data, Effect } from 'effect';
import { configTemplate, detectAppRoot } from '../config/configScaffold.js';
import {
  readAndroidMetadataDir,
  readAppleMetadataDir,
  serializeStoreConfig,
  type StoreConfig,
} from '../store/storeConfig.js';
import type { AppDescriptor } from '../types/app.js';
import type {
  AppfileData,
  FastlaneLane,
  FastlaneSetup,
  MatchfileData,
  MigrationArtifact,
  MigrationNote,
  MigrationNoteLevel,
  MigrationResult,
  SupplyfileData,
} from '../types/migrate.js';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.js';
import type { MutableDeep } from '../types/mutable.js';

export type FastlaneMigrationFailure = Readonly<{
  readonly _tag: 'FastlaneMigrationFailure';
  readonly reason: 'MissingFastlaneSetup';
  readonly sourcePath: string;
}>;

export const makeFastlaneMigrationFailure = Data.tagged<FastlaneMigrationFailure>(
  'FastlaneMigrationFailure',
);

const readRubyString = (rubySource: string, directiveName: string): string | undefined => {
  const directiveMatch = new RegExp(`^\\s*${directiveName}\\s*\\(?\\s*["']([^"']*)["']`, 'm').exec(
    rubySource,
  );
  const directiveText = directiveMatch?.[1];
  if (directiveText === undefined) return undefined;
  if (directiveText === '') return undefined;
  return directiveText;
};

export const parseAppfile = (appfileSource: string): AppfileData => {
  const appfile: MutableDeep<AppfileData> = {};
  const appIdentifier = readRubyString(appfileSource, 'app_identifier');
  if (appIdentifier !== undefined) appfile.appIdentifier = appIdentifier;
  const appleId = readRubyString(appfileSource, 'apple_id');
  if (appleId !== undefined) appfile.appleId = appleId;
  const teamId = readRubyString(appfileSource, 'team_id');
  if (teamId !== undefined) appfile.teamId = teamId;
  const itcTeamId = readRubyString(appfileSource, 'itc_team_id');
  if (itcTeamId !== undefined) appfile.itcTeamId = itcTeamId;
  const packageName = readRubyString(appfileSource, 'package_name');
  if (packageName !== undefined) appfile.packageName = packageName;
  return appfile;
};

export const parseMatchfile = (matchfileSource: string): MatchfileData => {
  const matchfile: MutableDeep<MatchfileData> = {};
  const gitUrl = readRubyString(matchfileSource, 'git_url');
  if (gitUrl !== undefined) matchfile.gitUrl = gitUrl;
  const signingType = readRubyString(matchfileSource, 'type');
  if (signingType !== undefined) matchfile.type = signingType;
  const storageMode = readRubyString(matchfileSource, 'storage_mode');
  if (storageMode !== undefined) matchfile.storageMode = storageMode;
  const appIdentifier = readRubyString(matchfileSource, 'app_identifier');
  if (appIdentifier !== undefined) matchfile.appIdentifier = appIdentifier;
  return matchfile;
};

export const parseSupplyfile = (supplyfileSource: string): SupplyfileData => {
  const supplyfile: MutableDeep<SupplyfileData> = {};
  const packageName = readRubyString(supplyfileSource, 'package_name');
  if (packageName !== undefined) supplyfile.packageName = packageName;
  const jsonKey = readRubyString(supplyfileSource, 'json_key');
  if (jsonKey !== undefined) supplyfile.jsonKey = jsonKey;
  const trackName = readRubyString(supplyfileSource, 'track');
  if (trackName !== undefined) supplyfile.track = trackName;
  return supplyfile;
};

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

const containsAction = (rubySource: string, actionName: string): boolean =>
  new RegExp(`\\b${actionName}\\b`).test(rubySource);

const findLanePlatform = (fastfileSource: string, laneStartIndex: number): string | undefined => {
  let lanePlatform: string | undefined;
  const platformPattern = /^[ \t]*platform\s+:([A-Za-z_]\w*)\s+do\b/gm;
  for (
    let platformMatch = platformPattern.exec(fastfileSource);
    platformMatch !== null && platformMatch.index < laneStartIndex;
    platformMatch = platformPattern.exec(fastfileSource)
  ) {
    lanePlatform = platformMatch[1];
  }
  return lanePlatform;
};

/** Parse lane names and recognized actions without attempting to interpret arbitrary Ruby. */
export const parseFastfile = (
  fastfileSource: string,
): { lanes: readonly FastlaneLane[]; actions: readonly string[] } => {
  const laneDeclarations = [
    ...fastfileSource.matchAll(/^[ \t]*(?:private_)?lane\s+:([A-Za-z_]\w*)\s+do\b/gm),
  ];
  const fastlaneLanes: FastlaneLane[] = [];
  for (const [declarationIndex, laneDeclaration] of laneDeclarations.entries()) {
    const laneName = laneDeclaration[1];
    if (laneName === undefined) continue;
    const laneStartIndex = laneDeclaration.index;
    const laneSourceStart = laneStartIndex + laneDeclaration[0].length;
    let laneSourceEnd = fastfileSource.length;
    const nextDeclaration = laneDeclarations[declarationIndex + 1];
    if (nextDeclaration !== undefined) laneSourceEnd = nextDeclaration.index;
    const laneSource = fastfileSource.slice(laneSourceStart, laneSourceEnd);
    const laneActions = KNOWN_ACTIONS.filter((actionName) =>
      containsAction(laneSource, actionName),
    );
    const lanePlatform = findLanePlatform(fastfileSource, laneStartIndex);
    if (lanePlatform !== undefined) {
      fastlaneLanes.push({ name: laneName, actions: laneActions, platform: lanePlatform });
      continue;
    }
    fastlaneLanes.push({ name: laneName, actions: laneActions });
  }
  return {
    lanes: fastlaneLanes,
    actions: KNOWN_ACTIONS.filter((actionName) => containsAction(fastfileSource, actionName)),
  };
};

const discoverDotenvKeys = (
  workingDirectory: string,
): Effect.Effect<string[], PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const fastlaneDirectory = pathService.join(workingDirectory, 'fastlane');
    if (!(yield* fileSystem.exists(fastlaneDirectory))) return [];
    const environmentKeys = new Set<string>();
    const entryNames = yield* fileSystem.readDirectory(fastlaneDirectory);
    for (const entryName of entryNames) {
      if (!entryName.startsWith('.env')) continue;
      if (entryName === '.env.example') continue;
      if (entryName === '.env.sample') continue;
      const dotenvPath = pathService.join(fastlaneDirectory, entryName);
      if ((yield* fileSystem.stat(dotenvPath)).type !== 'File') continue;
      const dotenvSource = yield* fileSystem.readFileString(dotenvPath);
      for (const dotenvLine of dotenvSource.split('\n')) {
        const assignmentMatch = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(dotenvLine);
        const environmentKey = assignmentMatch?.[1];
        if (environmentKey !== undefined) environmentKeys.add(environmentKey);
      }
    }
    return [...environmentKeys].sort();
  });

const readFastlaneFile = (
  workingDirectory: string,
  fileName: string,
): Effect.Effect<string | undefined, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const candidatePaths = [
      pathService.join(workingDirectory, 'fastlane', fileName),
      pathService.join(workingDirectory, fileName),
    ];
    for (const candidatePath of candidatePaths) {
      if (yield* fileSystem.exists(candidatePath)) {
        return yield* fileSystem.readFileString(candidatePath);
      }
    }
    return undefined;
  });

/** Read the supported Fastlane files and return null when no setup exists. */
export const readFastlaneSetup = (
  workingDirectory: string,
): Effect.Effect<FastlaneSetup | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fastlaneSources = yield* Effect.all(
      {
        appfile: readFastlaneFile(workingDirectory, 'Appfile'),
        fastfile: readFastlaneFile(workingDirectory, 'Fastfile'),
        matchfile: readFastlaneFile(workingDirectory, 'Matchfile'),
        supplyfile: readFastlaneFile(workingDirectory, 'Supplyfile'),
        deliverfile: readFastlaneFile(workingDirectory, 'Deliverfile'),
        environmentKeys: discoverDotenvKeys(workingDirectory),
      },
      { concurrency: 'unbounded' },
    );
    let hasFastlaneSource = fastlaneSources.appfile !== undefined;
    if (fastlaneSources.fastfile !== undefined) hasFastlaneSource = true;
    if (fastlaneSources.matchfile !== undefined) hasFastlaneSource = true;
    if (fastlaneSources.supplyfile !== undefined) hasFastlaneSource = true;
    if (fastlaneSources.deliverfile !== undefined) hasFastlaneSource = true;
    if (!hasFastlaneSource) return null;
    let parsedFastfile: { lanes: readonly FastlaneLane[]; actions: readonly string[] } = {
      lanes: [],
      actions: [],
    };
    if (fastlaneSources.fastfile !== undefined) {
      parsedFastfile = parseFastfile(fastlaneSources.fastfile);
    }
    let fastlaneSetup: FastlaneSetup = {
      lanes: parsedFastfile.lanes,
      actions: parsedFastfile.actions,
      hasDeliverfile: fastlaneSources.deliverfile !== undefined,
      envKeys: fastlaneSources.environmentKeys,
    };
    if (fastlaneSources.appfile !== undefined) {
      fastlaneSetup = { ...fastlaneSetup, appfile: parseAppfile(fastlaneSources.appfile) };
    }
    if (fastlaneSources.matchfile !== undefined) {
      fastlaneSetup = { ...fastlaneSetup, matchfile: parseMatchfile(fastlaneSources.matchfile) };
    }
    if (fastlaneSources.supplyfile !== undefined) {
      fastlaneSetup = { ...fastlaneSetup, supply: parseSupplyfile(fastlaneSources.supplyfile) };
    }
    return fastlaneSetup;
  });

type ActionNote = Readonly<{
  readonly actions: readonly string[];
  readonly level: MigrationNoteLevel;
  readonly message: string;
}>;

const ACTION_NOTES: readonly ActionNote[] = [
  {
    actions: ['build_app', 'gym'],
    level: 'mapped',
    message: 'fastlane built with gym/build_app -> `launch build`.',
  },
  {
    actions: ['upload_to_testflight', 'pilot'],
    level: 'mapped',
    message: 'fastlane uploaded to TestFlight (pilot) -> `launch release` on the testing track.',
  },
  {
    actions: ['upload_to_app_store', 'deliver'],
    level: 'mapped',
    message:
      'fastlane released with deliver -> `launch release` plus `launch metadata` for the listing.',
  },
  {
    actions: ['supply', 'upload_to_play_store'],
    level: 'mapped',
    message:
      'fastlane uploaded to Play (supply) -> `launch release` (Android) plus `launch metadata`.',
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
      "fastlane managed signing (match/cert/sigh) -> Launch provisions and stores its own certificates in the OS keychain (see `launch explain code-signing`); you don't carry these over.",
  },
  {
    actions: ['capture_screenshots', 'snapshot'],
    level: 'manual',
    message: 'fastlane captured screenshots - upload them with your listing via `launch metadata`.',
  },
];

const ACTION_COMMAND: Readonly<Record<string, string>> = {
  build_app: 'launch build',
  gym: 'launch build',
  upload_to_testflight: 'launch release --track testing',
  pilot: 'launch release --track testing',
  upload_to_app_store: 'launch release',
  deliver: 'launch release',
  supply: 'launch release (Android)',
  upload_to_play_store: 'launch release (Android)',
};

const laneCommands = (fastlaneLane: FastlaneLane): string[] => {
  const launchCommands: string[] = [];
  for (const actionName of fastlaneLane.actions) {
    const launchCommand = ACTION_COMMAND[actionName];
    if (launchCommand === undefined) continue;
    if (!launchCommands.includes(launchCommand)) launchCommands.push(launchCommand);
  }
  return launchCommands;
};

const buildLaneNotes = (fastlaneLanes: readonly FastlaneLane[]): MigrationNote[] => {
  const migrationNotes: MigrationNote[] = [];
  const customLaneNames: string[] = [];
  for (const fastlaneLane of fastlaneLanes) {
    const launchCommands = laneCommands(fastlaneLane);
    if (launchCommands.length > 0) {
      let laneLabel = `lane :${fastlaneLane.name}`;
      if (fastlaneLane.platform !== undefined) {
        laneLabel = `${laneLabel} (${fastlaneLane.platform})`;
      }
      migrationNotes.push({
        level: 'mapped',
        message: `${laneLabel} -> ${launchCommands.join(' + ')}.`,
      });
      continue;
    }
    if (fastlaneLane.actions.length === 0) customLaneNames.push(fastlaneLane.name);
  }
  if (customLaneNames.length > 0) {
    migrationNotes.push({
      level: 'manual',
      message: `Custom lanes (${customLaneNames.join(', ')}) had no recognized actions - Launch replaces lanes with \`launch build\`, \`launch release\`, and \`launch metadata\`; recreate these by hand.`,
    });
  }
  return migrationNotes;
};

const buildMigrationNotes = (
  fastlaneSetup: FastlaneSetup,
  apps: readonly AppDescriptor[],
  importedMetadata: boolean,
): MigrationNote[] => {
  const migrationNotes = buildLaneNotes(fastlaneSetup.lanes);
  for (const actionNote of ACTION_NOTES) {
    if (actionNote.actions.some((actionName) => fastlaneSetup.actions.includes(actionName))) {
      migrationNotes.push({ level: actionNote.level, message: actionNote.message });
    }
  }
  if (fastlaneSetup.matchfile !== undefined) {
    const signingParts: string[] = [];
    if (fastlaneSetup.matchfile.type !== undefined) {
      signingParts.push(`type "${fastlaneSetup.matchfile.type}"`);
    }
    if (fastlaneSetup.matchfile.storageMode !== undefined) {
      signingParts.push(`storage "${fastlaneSetup.matchfile.storageMode}"`);
    }
    if (fastlaneSetup.matchfile.gitUrl !== undefined) {
      signingParts.push(`repo ${fastlaneSetup.matchfile.gitUrl}`);
    }
    if (signingParts.length > 0) {
      let storageExplanation = '';
      const storageMode = fastlaneSetup.matchfile.storageMode;
      if (storageMode !== undefined && storageMode !== 'git') {
        storageExplanation = ` Your certificates live in ${storageMode}, not git - Launch doesn't read them; it provisions fresh.`;
      }
      migrationNotes.push({
        level: 'info',
        message: `Matchfile signing config detected (${signingParts.join(', ')}) - informational; Launch uses its own signing.${storageExplanation}`,
      });
    }
  }
  const appfile = fastlaneSetup.appfile;
  if (appfile !== undefined) {
    let hasAppleAccount = appfile.appleId !== undefined;
    if (appfile.teamId !== undefined) hasAppleAccount = true;
    if (appfile.itcTeamId !== undefined) hasAppleAccount = true;
    if (hasAppleAccount) {
      migrationNotes.push({
        level: 'manual',
        message:
          'Appfile carried Apple account details (apple_id/team_id) - configure your Apple API key with `launch creds set-key`.',
      });
    }
    if (appfile.appIdentifier !== undefined) {
      migrationNotes.push({
        level: 'info',
        message: `Appfile app_identifier ${appfile.appIdentifier} - Launch reads the bundle id from app.json; nothing to write.`,
      });
    }
  }
  const supplyfile = fastlaneSetup.supply;
  if (supplyfile?.jsonKey !== undefined) {
    migrationNotes.push({
      level: 'manual',
      message: `Supplyfile referenced a Play service-account key (${supplyfile.jsonKey}) - configure it with \`launch creds\`.`,
    });
  }
  if (supplyfile?.track !== undefined) {
    migrationNotes.push({
      level: 'manual',
      message: `Supplyfile default Play track "${supplyfile.track}" - set it as \`track\` on a profile in launch.config.ts.`,
    });
  }
  if (fastlaneSetup.hasDeliverfile && !importedMetadata) {
    migrationNotes.push({
      level: 'manual',
      message:
        'Deliverfile configured App Store metadata - import your live listing with `launch metadata pull`.',
    });
  }
  for (const app of apps) {
    if (app.bundleId !== undefined) {
      migrationNotes.push({
        level: 'info',
        message: `Detected iOS bundle id ${app.bundleId} for "${app.name}" - read from app.json; nothing to write.`,
      });
    }
    if (app.packageName !== undefined) {
      migrationNotes.push({
        level: 'info',
        message: `Detected Android package ${app.packageName} for "${app.name}" - read from app.json; nothing to write.`,
      });
    }
  }
  return migrationNotes;
};

const importFastlaneMetadata = (
  workingDirectory: string,
): Effect.Effect<
  { artifact: MigrationArtifact; note: MigrationNote } | null,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const appleMetadataDirectory = pathService.join(workingDirectory, 'fastlane', 'metadata');
    const androidMetadataDirectory = pathService.join(appleMetadataDirectory, 'android');
    const importedListings = yield* Effect.all(
      {
        apple: readAppleMetadataDir(appleMetadataDirectory),
        android: readAndroidMetadataDir(androidMetadataDirectory),
      },
      { concurrency: 'unbounded' },
    );
    const appleLocaleCount = Object.keys(importedListings.apple.info).length;
    const androidLocaleCount = Object.keys(importedListings.android.info).length;
    if (appleLocaleCount === 0 && androidLocaleCount === 0) return null;
    const storeConfiguration: StoreConfig = { configVersion: 0 };
    const importedListingLabels: string[] = [];
    if (appleLocaleCount > 0) {
      storeConfiguration.apple = importedListings.apple;
      importedListingLabels.push(`${appleLocaleCount} App Store locale(s)`);
    }
    if (androidLocaleCount > 0) {
      storeConfiguration.android = importedListings.android;
      importedListingLabels.push(`${androidLocaleCount} Play locale(s)`);
    }
    return {
      artifact: {
        path: 'store.config.json',
        contents: serializeStoreConfig(storeConfiguration),
      },
      note: {
        level: 'mapped',
        message: `Imported your fastlane metadata (${importedListingLabels.join(', ')}) into store.config.json - review it, then push with \`launch metadata push\`.`,
      },
    };
  });

/** Read a Fastlane project and return Launch artifacts without writing them. */
export const migrateFastlane = (
  workingDirectory: string,
  apps: readonly AppDescriptor[],
): Effect.Effect<
  MigrationResult,
  FastlaneMigrationFailure | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const fastlaneSetup = yield* readFastlaneSetup(workingDirectory);
    if (fastlaneSetup === null) {
      return yield* Effect.fail(
        makeFastlaneMigrationFailure({
          reason: 'MissingFastlaneSetup',
          sourcePath: workingDirectory,
        }),
      );
    }
    const migrationArtifacts: MigrationArtifact[] = [
      {
        path: 'launch.config.ts',
        contents: configTemplate(yield* detectAppRoot(apps, workingDirectory)),
      },
      {
        path: '.env.example',
        contents: buildEnvExample(fastlaneSetup.envKeys),
      },
    ];
    let importedMetadata = false;
    let storeScaffold: { artifact: MigrationArtifact | null; note: MigrationNote };
    const storeConfigPath = pathService.join(workingDirectory, 'store.config.json');
    if (yield* fileSystem.exists(storeConfigPath)) {
      storeScaffold = yield* scaffoldStoreConfig(workingDirectory);
    } else {
      const importedStoreConfig = yield* importFastlaneMetadata(workingDirectory);
      if (importedStoreConfig === null) {
        storeScaffold = yield* scaffoldStoreConfig(workingDirectory);
      } else {
        importedMetadata = true;
        storeScaffold = importedStoreConfig;
      }
    }
    const migrationNotes = buildMigrationNotes(fastlaneSetup, apps, importedMetadata);
    if (storeScaffold.artifact !== null) {
      migrationArtifacts.push(storeScaffold.artifact);
    }
    migrationNotes.push(storeScaffold.note);
    return { source: 'fastlane', artifacts: migrationArtifacts, notes: migrationNotes };
  });
