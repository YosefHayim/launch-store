import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectDefined } from '../testkit/assertions-testkit.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { MigrationArtifact, MigrationNote, MigrationNoteLevel } from '../types/migrate.ts';
import {
  laneLaunchCommands,
  migrateFastlane,
  migrationNotesFor,
  parseAppfile,
  parseFastfile,
  parseMatchfile,
  parseSupplyfile,
  readFastlaneSetup,
  readRubyString,
} from './fastlane.ts';
/** A realistic Appfile carrying both team ids, the Apple ID, and both platform identifiers. */
const SAMPLE_APPFILE = [
  'app_identifier("com.acme.alpha")',
  'apple_id("you@example.com")',
  'team_id "ABCD1234"',
  'itc_team_id "99887766"',
  'package_name("com.acme.alpha")',
].join('\n');
/** A Fastfile exercising both `lane` and `private_lane` plus a spread of recognized actions. */
const SAMPLE_FASTFILE = `
default_platform(:ios)

platform :ios do
  desc "Ship a beta"
  lane :beta do
    match(type: "appstore")
    gym(scheme: "Alpha")
    pilot
  end

  private_lane :prepare do
    capture_screenshots
  end

  lane :release do
    deliver
  end
end

platform :android do
  lane :play do
    supply(track: "internal")
  end
end
`;
const SAMPLE_MATCHFILE = [
  'git_url("https://github.com/acme/certs")',
  'type("appstore")',
  'storage_mode("git")',
].join('\n');
const SAMPLE_SUPPLYFILE = [
  'package_name("com.acme.alpha")',
  'json_key("./play-key.json")',
  'track("production")',
].join('\n');
/** A minimal app descriptor, overridable per field. */
function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'alpha',
    dir: '/tmp',
    configPath: '/tmp/app.json',
    bundleId: 'com.acme.alpha',
    ...overrides,
  };
}
/** The artifact at `path`, asserting it was emitted. */
function artifact(
  migrationArtifacts: readonly MigrationArtifact[],
  artifactPath: string,
): MigrationArtifact {
  function isArtifactAtPath(entry: { readonly path: string; readonly contents: string }) {
    return entry.path == artifactPath;
  }

  const matchingArtifact = migrationArtifacts.find(isArtifactAtPath);

  expect(matchingArtifact, `expected artifact ${artifactPath}`).toBeDefined();

  return expectDefined(matchingArtifact, `artifact ${artifactPath}`);
}
/** Notes at a given level. */
function notesAt(
  migrationNotes: readonly MigrationNote[],
  level: MigrationNoteLevel,
): MigrationNote[] {
  function isNoteAtLevel(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
    return note.level == level;
  }

  return migrationNotes.filter(isNoteAtLevel);
}
function runReadFastlaneSetup(workingDirectory: string) {
  return readFastlaneSetup(workingDirectory);
}
function runMigrateFastlane(workingDirectory: string, apps: AppDescriptor[]) {
  return migrateFastlane(workingDirectory, apps);
}
function describeReadRubyString() {
  function readsBareAndParenthesizedStringDirectives() {
    const rubyString = readRubyString('team_id "ABCD1234"', 'team_id');
    expect(rubyString).toBe('ABCD1234');
    expect(readRubyString('apple_id("you@example.com")', 'apple_id')).toBe('you@example.com');
  }

  it('reads bare and parenthesized string directives', readsBareAndParenthesizedStringDirectives);

  function treatsMissingAndEmptyDirectivesAsAbsent() {
    const rubyString = readRubyString('team_id "ABCD"', 'apple_id');
    expect(rubyString).toBeUndefined();
    expect(readRubyString('team_id ""', 'team_id')).toBeUndefined();
  }

  it('treats missing and empty directives as absent', treatsMissingAndEmptyDirectivesAsAbsent);
}

describe('readRubyString', describeReadRubyString);
function describeParseAppfile() {
  function readsEveryIdentifierAndKeepsTeamIdDistinctFromItcTeamId() {
    const appfile = parseAppfile(SAMPLE_APPFILE);

    expect(appfile.appIdentifier).toBe('com.acme.alpha');
    expect(appfile.appleId).toBe('you@example.com');
    expect(appfile.teamId).toBe('ABCD1234');
    expect(appfile.itcTeamId).toBe('99887766');
    expect(appfile.packageName).toBe('com.acme.alpha');
  }

  it(
    'reads every identifier and keeps team_id distinct from itc_team_id',
    readsEveryIdentifierAndKeepsTeamIdDistinctFromItcTeamId,
  );

  function returnsOnlyTheDirectivesPresent() {
    const appfile = parseAppfile('apple_id("solo@example.com")');
    expect(appfile).toEqual({ appleId: 'solo@example.com' });
  }

  it('returns only the directives present', returnsOnlyTheDirectivesPresent);

  function treatsAnEmptyPieceAsAbsent() {
    const appfile = parseAppfile('team_id ""');
    expect(appfile).toEqual({});
  }

  it('treats an empty value as absent', treatsAnEmptyPieceAsAbsent);
}

describe('parseAppfile', describeParseAppfile);
function describeParseMatchfile() {
  function readsTheSigningStrategy() {
    const matchfile = parseMatchfile(SAMPLE_MATCHFILE);

    expect(matchfile).toEqual({
      gitUrl: 'https://github.com/acme/certs',
      type: 'appstore',
      storageMode: 'git',
    });
  }

  it('reads the signing strategy', readsTheSigningStrategy);
}

describe('parseMatchfile', describeParseMatchfile);
function describeParseSupplyfile() {
  function readsThePlayUploadDefaults() {
    const supplyfile = parseSupplyfile(SAMPLE_SUPPLYFILE);

    expect(supplyfile).toEqual({
      packageName: 'com.acme.alpha',
      jsonKey: './play-key.json',
      track: 'production',
    });
  }

  it('reads the Play upload defaults', readsThePlayUploadDefaults);
}

describe('parseSupplyfile', describeParseSupplyfile);
function describeParseFastfile() {
  function collectsLaneNamesFromBothLaneAndPrivateLane() {
    function readName(lane: {
      readonly name: string;
      readonly platform?: string;
      readonly actions: readonly string[];
    }) {
      return lane.name;
    }

    const names = parseFastfile(SAMPLE_FASTFILE).lanes.map(readName).sort();

    expect(names).toEqual(['beta', 'play', 'prepare', 'release']);
  }

  it(
    'collects lane names from both lane and private_lane',
    collectsLaneNamesFromBothLaneAndPrivateLane,
  );

  function attributesEachLaneToItsPlatformBlockAndScopesActionsToItsPiece() {
    const lanes = parseFastfile(SAMPLE_FASTFILE).lanes;

    function isBetaLane(lane: {
      readonly name: string;
      readonly platform?: string;
      readonly actions: readonly string[];
    }) {
      return lane.name == 'beta';
    }

    const beta = lanes.find(isBetaLane);

    expect(beta).toBeDefined();

    if (beta == null) return;

    expect(beta.platform).toBe('ios');
    expect([...beta.actions].sort()).toEqual(['gym', 'match', 'pilot']);
    expect(laneLaunchCommands(beta)).toEqual([
      'launch-store build',
      'launch-store release --track testing',
    ]);

    function isPlayLane(lane: {
      readonly name: string;
      readonly platform?: string;
      readonly actions: readonly string[];
    }) {
      return lane.name == 'play';
    }

    const play = lanes.find(isPlayLane);

    expect(play).toBeDefined();

    if (play == null) return;

    expect(play.platform).toBe('android');
    expect(play.actions).toEqual(['supply']);

    function isReleaseLane(lane: {
      readonly name: string;
      readonly platform?: string;
      readonly actions: readonly string[];
    }) {
      return lane.name == 'release';
    }

    // gym lives in :beta, not in :release - body scoping keeps them apart.
    const release = lanes.find(isReleaseLane);

    expect(release).toBeDefined();

    if (release == null) return;

    expect(release.actions).toEqual(['deliver']);
  }

  it(
    'attributes each lane to its platform block and scopes actions to its body',
    attributesEachLaneToItsPlatformBlockAndScopesActionsToItsPiece,
  );

  function detectsTheRecognizedActionsUsedAnywhereInTheFile() {
    const { actions } = parseFastfile(SAMPLE_FASTFILE);

    expect(actions).toContain('match');
    expect(actions).toContain('gym');
    expect(actions).toContain('pilot');
    expect(actions).toContain('deliver');
    expect(actions).toContain('supply');
    expect(actions).toContain('capture_screenshots');
    expect(actions).not.toContain('upload_to_play_store');
  }

  it(
    'detects the recognized actions used anywhere in the file',
    detectsTheRecognizedActionsUsedAnywhereInTheFile,
  );
}

describe('parseFastfile', describeParseFastfile);
function describeMigrationNotesFor() {
  function mapsLanesAndSurfacesSigningAsManualWithoutFilesystemAccess() {
    const parsedFastfile = parseFastfile(SAMPLE_FASTFILE);
    const appfile = parseAppfile(SAMPLE_APPFILE);
    const matchfile = parseMatchfile(SAMPLE_MATCHFILE);
    const supplyfile = parseSupplyfile(SAMPLE_SUPPLYFILE);
    const migrationNotes = migrationNotesFor(
      {
        appfile: appfile,
        matchfile: matchfile,
        supply: supplyfile,
        lanes: parsedFastfile.lanes,
        actions: parsedFastfile.actions,
        hasDeliverfile: true,
        envKeys: [],
      },
      [app({ packageName: 'com.acme.alpha' })],
      false,
    );

    function readMessage(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const mapped = notesAt(migrationNotes, 'mapped').map(readMessage);

    expect(mapped).toContain(
      'lane :beta (ios) -> launch-store build + launch-store release --track testing.',
    );

    function readMessage2(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt(migrationNotes, 'manual').map(readMessage2);

    function includesSigningLane(message: string) {
      return message.includes('match/cert/sigh');
    }

    expect(manual.some(includesSigningLane)).toBe(true);

    function includesDeliverfileFollowUp(message: string) {
      return message.includes('Deliverfile');
    }

    expect(manual.some(includesDeliverfileFollowUp)).toBe(true);

    function readMessage3(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const informational = notesAt(migrationNotes, 'info').map(readMessage3);

    function includesAppIdentifierKey(message: string) {
      return message.includes('app_identifier');
    }

    expect(informational.some(includesAppIdentifierKey)).toBe(true);
  }

  it(
    'maps lanes and surfaces signing as manual without filesystem access',
    mapsLanesAndSurfacesSigningAsManualWithoutFilesystemAccess,
  );

  function dropsTheDeliverfileFollowUpWhenMetadataWasImported() {
    const migrationNotes = migrationNotesFor(
      {
        lanes: [],
        actions: [],
        hasDeliverfile: true,
        envKeys: [],
      },
      [],
      true,
    );

    function includesDeliverfileNote(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('Deliverfile');
    }

    expect(notesAt(migrationNotes, 'manual').some(includesDeliverfileNote)).toBe(false);
  }

  it(
    'drops the Deliverfile follow-up when metadata was imported',
    dropsTheDeliverfileFollowUpWhenMetadataWasImported,
  );
}

describe('migrationNotesFor', describeMigrationNotesFor);
function describeReadFastlaneSetup() {
  let dir: string;

  function prepareReadFastlaneSetup() {
    const systemTemporaryDirectory = tmpdir();
    const launchFastlanePath = join(systemTemporaryDirectory, 'launch-fastlane-');
    dir = mkdtempSync(launchFastlanePath);
  }

  beforeEach(prepareReadFastlaneSetup);

  function cleanupReadFastlaneSetup() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupReadFastlaneSetup);

  async function returnsNullWhenTheProjectHasNoFastlaneFiles() {
    expect(await runReadFastlaneSetup(dir)).toBeNull();
  }

  it(
    'returns null when the project has no fastlane files',
    returnsNullWhenTheProjectHasNoFastlaneFiles,
  );

  async function readsFilesFromTheConventionalFastlaneSubdirectory() {
    const fastlanePath = join(dir, 'fastlane');

    mkdirSync(fastlanePath);

    const appfilePath = join(dir, 'fastlane', 'Appfile');

    writeFileSync(appfilePath, SAMPLE_APPFILE);

    const fastfilePath = join(dir, 'fastlane', 'Fastfile');

    writeFileSync(fastfilePath, SAMPLE_FASTFILE);

    const fastlaneSetup = await runReadFastlaneSetup(dir);

    expect(fastlaneSetup?.appfile?.appIdentifier).toBe('com.acme.alpha');

    function readName2(lane: {
      readonly name: string;
      readonly platform?: string;
      readonly actions: readonly string[];
    }) {
      return lane.name;
    }

    expect(fastlaneSetup?.lanes.map(readName2)).toContain('beta');
    expect(fastlaneSetup?.hasDeliverfile).toBe(false);
  }

  it(
    'reads files from the conventional fastlane/ subdirectory',
    readsFilesFromTheConventionalFastlaneSubdirectory,
  );

  async function readsFilesPlacedAtTheProjectRoot() {
    const appfilePath = join(dir, 'Appfile');
    writeFileSync(appfilePath, SAMPLE_APPFILE);
    expect((await runReadFastlaneSetup(dir))?.appfile?.teamId).toBe('ABCD1234');
  }

  it('reads files placed at the project root', readsFilesPlacedAtTheProjectRoot);
}

describe('readFastlaneSetup', describeReadFastlaneSetup);
function describeMigrateFastlane() {
  let dir: string;

  function prepareMigrateFastlane() {
    const systemTemporaryDirectory = tmpdir();
    const launchFastlanePath = join(systemTemporaryDirectory, 'launch-fastlane-');

    dir = mkdtempSync(launchFastlanePath);

    const fastlanePath = join(dir, 'fastlane');

    mkdirSync(fastlanePath);

    const appfilePath = join(dir, 'fastlane', 'Appfile');

    writeFileSync(appfilePath, SAMPLE_APPFILE);

    const fastfilePath = join(dir, 'fastlane', 'Fastfile');

    writeFileSync(fastfilePath, SAMPLE_FASTFILE);

    const matchfilePath = join(dir, 'fastlane', 'Matchfile');

    writeFileSync(matchfilePath, SAMPLE_MATCHFILE);

    const supplyfilePath = join(dir, 'fastlane', 'Supplyfile');

    writeFileSync(supplyfilePath, SAMPLE_SUPPLYFILE);

    const deliverfilePath = join(dir, 'fastlane', 'Deliverfile');

    writeFileSync(deliverfilePath, 'app_identifier("com.acme.alpha")');
  }

  beforeEach(prepareMigrateFastlane);

  function cleanupMigrateFastlane() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupMigrateFastlane);

  async function returnsATaggedFailureWhenThereIsNoFastlaneSetup() {
    const fastlanePath = join(dir, 'fastlane');

    rmSync(fastlanePath, { recursive: true, force: true });
    await expect(migrateFastlane(dir, [app()])).rejects.toMatchObject({
      _tag: 'FastlaneMigrationFailure',
      reason: 'MissingFastlaneSetup',
    });
  }

  it(
    'returns a tagged failure when there is no fastlane setup',
    returnsATaggedFailureWhenThereIsNoFastlaneSetup,
  );

  async function emitsTheStarterLaunchPieceTsPieceExampleAndStorePiecePiece() {
    const migration = await runMigrateFastlane(dir, [app()]);

    function readPath(entry: { readonly path: string; readonly contents: string }) {
      return entry.path;
    }

    const artifactPaths = migration.artifacts.map(readPath);

    expect(artifactPaths).toContain('launch.config.ts');
    expect(artifactPaths).toContain('.env.example');
    expect(artifactPaths).toContain('store.config.json');
    expect(artifact(migration.artifacts, 'launch.config.ts').contents).toContain('defineConfig');
  }

  it(
    'emits the starter launch.config.ts, .env.example, and store.config.json',
    emitsTheStarterLaunchPieceTsPieceExampleAndStorePiecePiece,
  );

  async function mapsEachLaneToItsLaunchCommandsAndKeepsSigningAsAManualFollowUp() {
    const migrationNotes = (await runMigrateFastlane(dir, [app()])).notes;

    function readMessage4(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const mapped = notesAt(migrationNotes, 'mapped').map(readMessage4);

    expect(mapped).toContain(
      'lane :beta (ios) -> launch-store build + launch-store release --track testing.',
    );
    expect(mapped).toContain('lane :release (ios) -> launch-store release.');
    expect(mapped).toContain('lane :play (android) -> launch-store release (Android).');

    function readMessage5(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt(migrationNotes, 'manual').map(readMessage5);

    function includesSigningLaneCopy(message: string) {
      return message.includes('match/cert/sigh');
    }

    expect(manual.some(includesSigningLaneCopy)).toBe(true);
  }

  it(
    'maps each lane to its Launch commands and keeps signing as a manual follow-up',
    mapsEachLaneToItsLaunchCommandsAndKeepsSigningAsAManualFollowUp,
  );

  async function reportsACustomLaneWithNoRecognizedActionsAsAManualFollowUp() {
    const fastfilePath = join(dir, 'fastlane', 'Fastfile');

    writeFileSync(fastfilePath, "lane :smoke do\n  sh('echo hi')\nend\n");

    function readMessage6(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'manual').map(
      readMessage6,
    );

    function includesCustomSmokeLanes(message: string) {
      return message.includes('Custom lanes (smoke)');
    }

    expect(manual.some(includesCustomSmokeLanes)).toBe(true);
  }

  it(
    'reports a custom lane with no recognized actions as a manual follow-up',
    reportsACustomLaneWithNoRecognizedActionsAsAManualFollowUp,
  );

  async function mapsGymPilotDeliverSupplyToLaunchCommands() {
    function readMessage7(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const mapped = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'mapped').map(
      readMessage7,
    );

    function includesLaunchBuildCommand(message: string) {
      return message.includes('launch-store build');
    }

    expect(mapped.some(includesLaunchBuildCommand)).toBe(true);

    function includesTestFlightUpload(message: string) {
      return message.includes('TestFlight');
    }

    expect(mapped.some(includesTestFlightUpload)).toBe(true);

    function includesDeliverAction(message: string) {
      return message.includes('deliver');
    }

    expect(mapped.some(includesDeliverAction)).toBe(true);
  }

  it('maps gym/pilot/deliver/supply to Launch commands', mapsGymPilotDeliverSupplyToLaunchCommands);

  async function reportsTheSupplyfileTrackAndADeliverfileAsManual() {
    function readMessage8(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'manual').map(
      readMessage8,
    );

    function includesPlayTrackNote(message: string) {
      return message.includes('Play track');
    }

    expect(manual.some(includesPlayTrackNote)).toBe(true);

    function includesDeliverfileManual(message: string) {
      return message.includes('Deliverfile');
    }

    expect(manual.some(includesDeliverfileManual)).toBe(true);
  }

  it(
    'reports the Supplyfile track and a Deliverfile as manual',
    reportsTheSupplyfileTrackAndADeliverfileAsManual,
  );

  async function reportsTheAppfileAppIdentifierAndDetectedIdsAsPiece() {
    function readMessage9(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const informationalNotes = notesAt(
      (await runMigrateFastlane(dir, [app({ packageName: 'com.acme.alpha' })])).notes,
      'info',
    ).map(readMessage9);

    function includesAppIdentifierField(message: string) {
      return message.includes('app_identifier');
    }

    expect(informationalNotes.some(includesAppIdentifierField)).toBe(true);

    function includesBundleIdField(message: string) {
      return message.includes('bundle id');
    }

    expect(informationalNotes.some(includesBundleIdField)).toBe(true);

    function includesPackageField(message: string) {
      return message.includes('package');
    }

    expect(informationalNotes.some(includesPackageField)).toBe(true);
  }

  it(
    'reports the Appfile app_identifier and detected ids as info',
    reportsTheAppfileAppIdentifierAndDetectedIdsAsPiece,
  );

  async function skipsStorePiecePieceWhenOneAlreadyExists() {
    const storePath = join(dir, 'store.config.json');

    writeFileSync(storePath, '{}');

    const migration = await runMigrateFastlane(dir, [app()]);

    function readPath2(entry: { readonly path: string; readonly contents: string }) {
      return entry.path;
    }

    expect(migration.artifacts.map(readPath2)).not.toContain('store.config.json');

    function includesExistingStoreFile(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('store.config.json');
    }

    expect(notesAt(migration.notes, 'skipped').some(includesExistingStoreFile)).toBe(true);
  }

  it('skips store.config.json when one already exists', skipsStorePiecePieceWhenOneAlreadyExists);

  async function importsTheFastlaneMetadataFolderIntoStorePiecePieceAndDropsTheDeliverfileFollowUp() {
    const appleLocale = join(dir, 'fastlane', 'metadata', 'en-US');

    mkdirSync(appleLocale, { recursive: true });

    const namePath = join(appleLocale, 'name.txt');

    writeFileSync(namePath, 'Alpha');

    const keywordsPath = join(appleLocale, 'keywords.txt');

    writeFileSync(keywordsPath, 'todo, tasks');

    const androidLocale = join(dir, 'fastlane', 'metadata', 'android', 'en-US');

    mkdirSync(androidLocale, { recursive: true });

    const titlePath = join(androidLocale, 'title.txt');

    writeFileSync(titlePath, 'Alpha');

    const fullDescriptionPath = join(androidLocale, 'full_description.txt');

    writeFileSync(fullDescriptionPath, 'The full description.');

    const migration = await runMigrateFastlane(dir, [app()]);
    const store = JSON.parse(artifact(migration.artifacts, 'store.config.json').contents) as {
      apple?: { info: Record<string, { title?: string; keywords?: string[] }> };
      android?: { info: Record<string, { title?: string }> };
    };

    expect(store.apple?.info['en-US']?.title).toBe('Alpha');
    expect(store.apple?.info['en-US']?.keywords).toEqual(['todo', 'tasks']);
    expect(store.android?.info['en-US']?.title).toBe('Alpha');

    function includesImportedListingNote(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('Imported your fastlane metadata');
    }

    expect(notesAt(migration.notes, 'mapped').some(includesImportedListingNote)).toBe(true);

    function includesDeliverfileAbsence(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('Deliverfile');
    }

    expect(notesAt(migration.notes, 'manual').some(includesDeliverfileAbsence)).toBe(false);
  }

  it(
    'imports the fastlane/metadata folder into store.config.json and drops the Deliverfile follow-up',
    importsTheFastlaneMetadataFolderIntoStorePiecePieceAndDropsTheDeliverfileFollowUp,
  );

  async function seedsPieceExampleWithKEYSDiscoveredInFastlaneDotenvFilesValuesDropped() {
    const joinedPath = join(dir, 'fastlane', '.env.default');

    writeFileSync(joinedPath, 'APP_STORE_KEY=secret\nexport SLACK_URL=https://hooks\n');

    const env = artifact(
      (await runMigrateFastlane(dir, [app()])).artifacts,
      '.env.example',
    ).contents;

    expect(env).toContain('APP_STORE_KEY=');
    expect(env).toContain('SLACK_URL=');
    expect(env).not.toContain('APP_STORE_KEY=secret');
    expect(env).not.toContain('https://hooks');
  }

  it(
    'seeds .env.example with KEYS discovered in fastlane dotenv files (values dropped)',
    seedsPieceExampleWithKEYSDiscoveredInFastlaneDotenvFilesValuesDropped,
  );

  async function surfacesANonGitPieceStorageBackendInTheSigningNote() {
    const matchfilePath = join(dir, 'fastlane', 'Matchfile');

    writeFileSync(matchfilePath, ['type("appstore")', 'storage_mode("google_cloud")'].join('\n'));

    function readMessage10(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const informationalNotes = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'info').map(
      readMessage10,
    );

    function includesGoogleCloudKey(message: string) {
      return message.includes('google_cloud');
    }

    expect(informationalNotes.some(includesGoogleCloudKey)).toBe(true);
  }

  it(
    'surfaces a non-git match storage backend in the signing note',
    surfacesANonGitPieceStorageBackendInTheSigningNote,
  );
}

describe('migrateFastlane', describeMigrateFastlane);
