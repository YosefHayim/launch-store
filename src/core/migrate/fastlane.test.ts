import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectDefined } from '@testkit/assertions.testkit.js';
import type { AppDescriptor } from '../types/app.js';
import type { MigrationArtifact, MigrationNote, MigrationNoteLevel } from '../types/migrate.js';
import {
  migrateFastlane,
  parseAppfile,
  parseFastfile,
  parseMatchfile,
  parseSupplyfile,
  readFastlaneSetup,
} from './fastlane.js';
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
const app = (overrides: Partial<AppDescriptor> = {}): AppDescriptor => {
  return {
    name: 'alpha',
    dir: '/tmp',
    configPath: '/tmp/app.json',
    bundleId: 'com.acme.alpha',
    ...overrides,
  };
};
/** The artifact at `path`, asserting it was emitted. */
const artifact = (
  migrationArtifacts: MigrationArtifact[],
  artifactPath: string,
): MigrationArtifact => {
  const matchingArtifact = migrationArtifacts.find((entry) => entry.path === artifactPath);
  expect(matchingArtifact, `expected artifact ${artifactPath}`).toBeDefined();
  return expectDefined(matchingArtifact, `artifact ${artifactPath}`);
};
/** Notes at a given level. */
const notesAt = (migrationNotes: MigrationNote[], level: MigrationNoteLevel): MigrationNote[] => {
  return migrationNotes.filter((note) => note.level === level);
};
const runReadFastlaneSetup = (workingDirectory: string) =>
  Effect.runPromise(readFastlaneSetup(workingDirectory).pipe(Effect.provide(NodeContext.layer)));
const runMigrateFastlane = (workingDirectory: string, apps: AppDescriptor[]) =>
  Effect.runPromise(
    migrateFastlane(workingDirectory, apps).pipe(Effect.provide(NodeContext.layer)),
  );
describe('parseAppfile', () => {
  it('reads every identifier and keeps team_id distinct from itc_team_id', () => {
    const appfile = parseAppfile(SAMPLE_APPFILE);
    expect(appfile.appIdentifier).toBe('com.acme.alpha');
    expect(appfile.appleId).toBe('you@example.com');
    expect(appfile.teamId).toBe('ABCD1234');
    expect(appfile.itcTeamId).toBe('99887766');
    expect(appfile.packageName).toBe('com.acme.alpha');
  });
  it('returns only the directives present', () => {
    expect(parseAppfile('apple_id("solo@example.com")')).toEqual({ appleId: 'solo@example.com' });
  });
  it('treats an empty value as absent', () => {
    expect(parseAppfile('team_id ""')).toEqual({});
  });
});
describe('parseMatchfile', () => {
  it('reads the signing strategy', () => {
    expect(parseMatchfile(SAMPLE_MATCHFILE)).toEqual({
      gitUrl: 'https://github.com/acme/certs',
      type: 'appstore',
      storageMode: 'git',
    });
  });
});
describe('parseSupplyfile', () => {
  it('reads the Play upload defaults', () => {
    expect(parseSupplyfile(SAMPLE_SUPPLYFILE)).toEqual({
      packageName: 'com.acme.alpha',
      jsonKey: './play-key.json',
      track: 'production',
    });
  });
});
describe('parseFastfile', () => {
  it('collects lane names from both lane and private_lane', () => {
    const names = parseFastfile(SAMPLE_FASTFILE)
      .lanes.map((lane) => lane.name)
      .sort();
    expect(names).toEqual(['beta', 'play', 'prepare', 'release']);
  });
  it('attributes each lane to its platform block and scopes actions to its body', () => {
    const lanes = parseFastfile(SAMPLE_FASTFILE).lanes;
    const beta = lanes.find((lane) => lane.name === 'beta');
    expect(beta?.platform).toBe('ios');
    expect(beta?.actions.sort()).toEqual(['gym', 'match', 'pilot']);
    const play = lanes.find((lane) => lane.name === 'play');
    expect(play?.platform).toBe('android');
    expect(play?.actions).toEqual(['supply']);
    // gym lives in :beta, not in :release - body scoping keeps them apart.
    expect(lanes.find((lane) => lane.name === 'release')?.actions).toEqual(['deliver']);
  });
  it('detects the recognized actions used anywhere in the file', () => {
    const { actions } = parseFastfile(SAMPLE_FASTFILE);
    expect(actions).toContain('match');
    expect(actions).toContain('gym');
    expect(actions).toContain('pilot');
    expect(actions).toContain('deliver');
    expect(actions).toContain('supply');
    expect(actions).toContain('capture_screenshots');
    expect(actions).not.toContain('upload_to_play_store');
  });
});
describe('readFastlaneSetup', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-fastlane-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it('returns null when the project has no fastlane files', async () => {
    expect(await runReadFastlaneSetup(dir)).toBeNull();
  });
  it('reads files from the conventional fastlane/ subdirectory', async () => {
    mkdirSync(join(dir, 'fastlane'));
    writeFileSync(join(dir, 'fastlane', 'Appfile'), SAMPLE_APPFILE);
    writeFileSync(join(dir, 'fastlane', 'Fastfile'), SAMPLE_FASTFILE);
    const fastlaneSetup = await runReadFastlaneSetup(dir);
    expect(fastlaneSetup?.appfile?.appIdentifier).toBe('com.acme.alpha');
    expect(fastlaneSetup?.lanes.map((lane) => lane.name)).toContain('beta');
    expect(fastlaneSetup?.hasDeliverfile).toBe(false);
  });
  it('reads files placed at the project root', async () => {
    writeFileSync(join(dir, 'Appfile'), SAMPLE_APPFILE);
    expect((await runReadFastlaneSetup(dir))?.appfile?.teamId).toBe('ABCD1234');
  });
});
describe('migrateFastlane', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'launch-fastlane-'));
    mkdirSync(join(dir, 'fastlane'));
    writeFileSync(join(dir, 'fastlane', 'Appfile'), SAMPLE_APPFILE);
    writeFileSync(join(dir, 'fastlane', 'Fastfile'), SAMPLE_FASTFILE);
    writeFileSync(join(dir, 'fastlane', 'Matchfile'), SAMPLE_MATCHFILE);
    writeFileSync(join(dir, 'fastlane', 'Supplyfile'), SAMPLE_SUPPLYFILE);
    writeFileSync(join(dir, 'fastlane', 'Deliverfile'), 'app_identifier("com.acme.alpha")');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  it('returns a tagged failure when there is no fastlane setup', async () => {
    rmSync(join(dir, 'fastlane'), { recursive: true, force: true });
    const migrationFailure = await Effect.runPromise(
      Effect.flip(migrateFastlane(dir, [app()]).pipe(Effect.provide(NodeContext.layer))),
    );
    expect(migrationFailure).toMatchObject({
      _tag: 'FastlaneMigrationFailure',
      reason: 'MissingFastlaneSetup',
    });
  });
  it('emits the starter launch.config.ts, .env.example, and store.config.json', async () => {
    const migration = await runMigrateFastlane(dir, [app()]);
    const artifactPaths = migration.artifacts.map((entry) => entry.path);
    expect(artifactPaths).toContain('launch.config.ts');
    expect(artifactPaths).toContain('.env.example');
    expect(artifactPaths).toContain('store.config.json');
    expect(artifact(migration.artifacts, 'launch.config.ts').contents).toContain('defineConfig');
  });
  it('maps each lane to its Launch commands and keeps signing as a manual follow-up', async () => {
    const migrationNotes = (await runMigrateFastlane(dir, [app()])).notes;
    const mapped = notesAt(migrationNotes, 'mapped').map((note) => note.message);
    expect(mapped).toContain('lane :beta (ios) -> launch build + launch release --track testing.');
    expect(mapped).toContain('lane :release (ios) -> launch release.');
    expect(mapped).toContain('lane :play (android) -> launch release (Android).');
    const manual = notesAt(migrationNotes, 'manual').map((note) => note.message);
    expect(manual.some((message) => message.includes('match/cert/sigh'))).toBe(true);
  });
  it('reports a custom lane with no recognized actions as a manual follow-up', async () => {
    writeFileSync(join(dir, 'fastlane', 'Fastfile'), "lane :smoke do\n  sh('echo hi')\nend\n");
    const manual = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'manual').map(
      (note) => note.message,
    );
    expect(manual.some((message) => message.includes('Custom lanes (smoke)'))).toBe(true);
  });
  it('maps gym/pilot/deliver/supply to Launch commands', async () => {
    const mapped = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'mapped').map(
      (note) => note.message,
    );
    expect(mapped.some((message) => message.includes('launch build'))).toBe(true);
    expect(mapped.some((message) => message.includes('TestFlight'))).toBe(true);
    expect(mapped.some((message) => message.includes('deliver'))).toBe(true);
  });
  it('reports the Supplyfile track and a Deliverfile as manual', async () => {
    const manual = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'manual').map(
      (note) => note.message,
    );
    expect(manual.some((message) => message.includes('Play track'))).toBe(true);
    expect(manual.some((message) => message.includes('Deliverfile'))).toBe(true);
  });
  it('reports the Appfile app_identifier and detected ids as info', async () => {
    const informationalNotes = notesAt(
      (await runMigrateFastlane(dir, [app({ packageName: 'com.acme.alpha' })])).notes,
      'info',
    ).map((note) => note.message);
    expect(informationalNotes.some((message) => message.includes('app_identifier'))).toBe(true);
    expect(informationalNotes.some((message) => message.includes('bundle id'))).toBe(true);
    expect(informationalNotes.some((message) => message.includes('package'))).toBe(true);
  });
  it('skips store.config.json when one already exists', async () => {
    writeFileSync(join(dir, 'store.config.json'), '{}');
    const migration = await runMigrateFastlane(dir, [app()]);
    expect(migration.artifacts.map((entry) => entry.path)).not.toContain('store.config.json');
    expect(
      notesAt(migration.notes, 'skipped').some((note) =>
        note.message.includes('store.config.json'),
      ),
    ).toBe(true);
  });
  it('imports the fastlane/metadata folder into store.config.json and drops the Deliverfile follow-up', async () => {
    const appleLocale = join(dir, 'fastlane', 'metadata', 'en-US');
    mkdirSync(appleLocale, { recursive: true });
    writeFileSync(join(appleLocale, 'name.txt'), 'Alpha');
    writeFileSync(join(appleLocale, 'keywords.txt'), 'todo, tasks');
    const androidLocale = join(dir, 'fastlane', 'metadata', 'android', 'en-US');
    mkdirSync(androidLocale, { recursive: true });
    writeFileSync(join(androidLocale, 'title.txt'), 'Alpha');
    writeFileSync(join(androidLocale, 'full_description.txt'), 'The full description.');
    const migration = await runMigrateFastlane(dir, [app()]);
    const ImportedStoreSchema = Schema.Struct({
      apple: Schema.optional(
        Schema.Struct({
          info: Schema.Record({
            key: Schema.String,
            value: Schema.Struct({
              title: Schema.optional(Schema.String),
              keywords: Schema.optional(Schema.Array(Schema.String)),
            }),
          }),
        }),
      ),
      android: Schema.optional(
        Schema.Struct({
          info: Schema.Record({
            key: Schema.String,
            value: Schema.Struct({ title: Schema.optional(Schema.String) }),
          }),
        }),
      ),
    });
    const store = Schema.decodeUnknownSync(ImportedStoreSchema)(
      JSON.parse(artifact(migration.artifacts, 'store.config.json').contents),
    );
    expect(store.apple?.info['en-US']?.title).toBe('Alpha');
    expect(store.apple?.info['en-US']?.keywords).toEqual(['todo', 'tasks']);
    expect(store.android?.info['en-US']?.title).toBe('Alpha');
    expect(
      notesAt(migration.notes, 'mapped').some((note) =>
        note.message.includes('Imported your fastlane metadata'),
      ),
    ).toBe(true);
    expect(
      notesAt(migration.notes, 'manual').some((note) => note.message.includes('Deliverfile')),
    ).toBe(false);
  });
  it('seeds .env.example with KEYS discovered in fastlane dotenv files (values dropped)', async () => {
    writeFileSync(
      join(dir, 'fastlane', '.env.default'),
      'APP_STORE_KEY=secret\nexport SLACK_URL=https://hooks\n',
    );
    const env = artifact(
      (await runMigrateFastlane(dir, [app()])).artifacts,
      '.env.example',
    ).contents;
    expect(env).toContain('APP_STORE_KEY=');
    expect(env).toContain('SLACK_URL=');
    expect(env).not.toContain('APP_STORE_KEY=secret');
    expect(env).not.toContain('https://hooks');
  });
  it('surfaces a non-git match storage backend in the signing note', async () => {
    writeFileSync(
      join(dir, 'fastlane', 'Matchfile'),
      ['type("appstore")', 'storage_mode("google_cloud")'].join('\n'),
    );
    const informationalNotes = notesAt((await runMigrateFastlane(dir, [app()])).notes, 'info').map(
      (note) => note.message,
    );
    expect(informationalNotes.some((message) => message.includes('google_cloud'))).toBe(true);
  });
});
