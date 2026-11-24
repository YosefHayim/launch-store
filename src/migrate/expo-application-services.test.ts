import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectDefined } from '../testkit/expect-defined.ts';
import type { AppDescriptor } from '../types/app.ts';
import type {
  EasJson,
  MigrationArtifact,
  MigrationNote,
  MigrationNoteLevel,
} from '../types/migrate.ts';
import {
  collectEnvironmentKeys,
  credentialsSummaryFromJson,
  describeRuntimeVersion,
  expoFactsFromResolvedConfig,
  launchProfilesFromEas,
  migrateEas,
  notesFromCredentialsSummary,
  notesFromEasConfiguration,
  notesFromExpoFacts,
  parseEasJson,
} from './expo-application-services.ts';

/** A realistic eas.json covering build profiles, env, submit credentials, and the cli block. */
const SAMPLE_EAS = JSON.stringify({
  cli: { appVersionSource: 'remote' },
  build: {
    development: {
      developmentClient: true,
      distribution: 'internal',
      channel: 'development',
      env: { API_URL: 'https://dev' },
    },
    production: {
      channel: 'production',
      env: { API_URL: 'https://prod', SENTRY_DSN: 'x' },
      autoIncrement: true,
    },
  },
  submit: {
    production: {
      ios: { appleId: 'you@example.com', ascAppId: '123', appleTeamId: 'ABCD' },
      android: { serviceAccountKeyPath: './play-key.json', track: 'internal' },
    },
  },
});

/** A minimal app descriptor, overridable per field. */
function app(over: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'alpha',
    dir: '/tmp',
    configPath: '/tmp/app.json',
    bundleId: 'com.acme.alpha',
    ...over,
  };
}

/** The artifact at `path`, asserting it was emitted. */
function artifact(artifacts: readonly MigrationArtifact[], path: string): MigrationArtifact {
  function isArtifactAtPath(entry: { readonly path: string; readonly contents: string }) {
    return entry.path == path;
  }

  const found = artifacts.find(isArtifactAtPath);

  expect(found, `expected artifact ${path}`).toBeDefined();

  return expectDefined(found, `artifact ${path}`);
}

/** Notes at a given level. */
function notesAt(notes: readonly MigrationNote[], level: MigrationNoteLevel): MigrationNote[] {
  function isNoteAtLevel(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
    return note.level == level;
  }

  return notes.filter(isNoteAtLevel);
}

function sampleEasConfiguration(): EasJson {
  return parseEasJson(SAMPLE_EAS);
}

function describeParseEasPiece() {
  function parsesBuildSubmitAndCliIntoTheNarrowedShape() {
    const eas = parseEasJson(SAMPLE_EAS);

    expect(Object.keys(eas.build).sort()).toEqual(['development', 'production']);
    expect(eas.build['production']?.env).toEqual({ API_URL: 'https://prod', SENTRY_DSN: 'x' });
    expect(eas.build['development']?.distribution).toBe('internal');
    expect(eas.submit['production']?.android?.track).toBe('internal');
    expect(eas.cli?.appVersionSource).toBe('remote');
  }

  it(
    'parses build, submit, and cli into the narrowed shape',
    parsesBuildSubmitAndCliIntoTheNarrowedShape,
  );

  function defaultsMissingSectionsRatherThanFailing() {
    const eas = parseEasJson('{}');
    expect(eas).toEqual({ build: {}, submit: {} });
  }

  it('defaults missing sections rather than failing', defaultsMissingSectionsRatherThanFailing);

  function dropsNonStringPieceValuesAndEmptyHalves() {
    const serialized = JSON.stringify({
      build: { p: { env: { A: '1', B: 2 } } },
      submit: { p: { ios: {} } },
    });
    const eas = parseEasJson(serialized);

    expect(eas.build['p']?.env).toEqual({ A: '1' });
    expect(eas.submit['p']?.ios).toBeUndefined();
  }

  it('drops non-string env values and empty halves', dropsNonStringPieceValuesAndEmptyHalves);

  function returnsATaggedFailureForInvalidJSON() {
    let parsingFailure: unknown = null;

    try {
      parseEasJson('{ not json');
    } catch (error) {
      parsingFailure = error;
    }

    expect(parsingFailure).toMatchObject({ reason: 'InvalidEasJson' });
  }

  it('returns a tagged failure for invalid JSON', returnsATaggedFailureForInvalidJSON);

  function returnsATaggedFailureForANonObjectDocument() {
    let parsingFailure: unknown = null;

    try {
      parseEasJson('"a string"');
    } catch (error) {
      parsingFailure = error;
    }

    expect(parsingFailure).toMatchObject({ reason: 'InvalidEasJson' });
  }

  it(
    'returns a tagged failure for a non-object document',
    returnsATaggedFailureForANonObjectDocument,
  );
}

describe('parseEasJson', describeParseEasPiece);

function describeLaunchProfilesFromEas() {
  function liftsAValidPlayTrackFromTheMatchingSubmitProfile() {
    const launchProfiles = launchProfilesFromEas(sampleEasConfiguration());
    expect(launchProfiles['production']?.track).toBe('internal');
    expect(launchProfiles['development']?.name).toBe('development');
    expect(launchProfiles['development']?.track).toBeUndefined();
  }

  it(
    'lifts a valid Play track from the matching submit profile',
    liftsAValidPlayTrackFromTheMatchingSubmitProfile,
  );

  function fallsBackToASingleProductionProfileWhenEasPieceDeclaresNone() {
    const launchProfiles = launchProfilesFromEas({ build: {}, submit: {} });
    const ownKeys = Object.keys(launchProfiles);
    expect(ownKeys).toEqual(['production']);
    expect(launchProfiles['production']).toEqual({ name: 'production', sizeBudgetMB: 200 });
  }

  it(
    'falls back to a single production profile when eas.json declares none',
    fallsBackToASingleProductionProfileWhenEasPieceDeclaresNone,
  );

  function ignoresUnrecognizedPlayTracksInsteadOfWritingThemOntoLaunchProfiles() {
    const launchProfiles = launchProfilesFromEas({
      build: { beta: {} },
      submit: { beta: { android: { track: 'alpha-track' } } },
    });

    expect(launchProfiles['beta']?.track).toBeUndefined();
  }

  it(
    'ignores unrecognized Play tracks instead of writing them onto Launch profiles',
    ignoresUnrecognizedPlayTracksInsteadOfWritingThemOntoLaunchProfiles,
  );
}

describe('launchProfilesFromEas', describeLaunchProfilesFromEas);

function describeCollectEnvironmentKeys() {
  function unionsProfilePieceKeysAndSortsThem() {
    const environmentKeys = collectEnvironmentKeys(sampleEasConfiguration());
    expect(environmentKeys).toEqual(['API_URL', 'SENTRY_DSN']);
  }

  it('unions profile env keys and sorts them', unionsProfilePieceKeysAndSortsThem);

  function returnsAnEmptyListWhenNoProfileDeclaresPiece() {
    const environmentKeys = collectEnvironmentKeys({ build: { production: {} }, submit: {} });
    expect(environmentKeys).toEqual([]);
  }

  it(
    'returns an empty list when no profile declares env',
    returnsAnEmptyListWhenNoProfileDeclaresPiece,
  );
}

describe('collectEnvironmentKeys', describeCollectEnvironmentKeys);

function describeNotesFromEasConfiguration() {
  function mapsProfilesAndFlagsChannelsInternalDistributionAndSubmitCredentialsAsManual() {
    const notes = notesFromEasConfiguration(sampleEasConfiguration(), [
      app({ packageName: 'com.acme.alpha' }),
    ]);

    function readMessage(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const mapped = notesAt(notes, 'mapped').map(readMessage);

    function readMessage2(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt(notes, 'manual').map(readMessage2);

    function readMessage3(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const informational = notesAt(notes, 'info').map(readMessage3);

    function includesProductionProfile(message: string) {
      return message.includes('Build profile "production"');
    }

    expect(mapped.some(includesProductionProfile)).toBe(true);

    function includesAppVersionSetting(message: string) {
      return message.includes('appVersionSource');
    }

    expect(mapped.some(includesAppVersionSetting)).toBe(true);

    function includesChannelSetting(message: string) {
      return message.includes('channel');
    }

    expect(manual.some(includesChannelSetting)).toBe(true);

    function includesAdHocDistribution(message: string) {
      return message.includes('internal (ad-hoc) distribution');
    }

    expect(manual.some(includesAdHocDistribution)).toBe(true);

    function includesAppleAccountDetails(message: string) {
      return message.includes('Apple account details');
    }

    expect(manual.some(includesAppleAccountDetails)).toBe(true);

    function includesPlayServiceAccount(message: string) {
      return message.includes('Play service account');
    }

    expect(manual.some(includesPlayServiceAccount)).toBe(true);

    function includesAcmePackageName(message: string) {
      return message.includes('com.acme.alpha') && message.includes('package');
    }

    expect(informational.some(includesAcmePackageName)).toBe(true);
  }

  it(
    'maps profiles and flags channels, internal distribution, and submit credentials as manual',
    mapsProfilesAndFlagsChannelsInternalDistributionAndSubmitCredentialsAsManual,
  );

  function flagsAnUnrecognizedPlayTrackAsManualWithoutMappingIt() {
    const notes = notesFromEasConfiguration(
      {
        build: { beta: {} },
        submit: { beta: { android: { track: 'canary' } } },
      },
      [],
    );

    function includesUnrecognizedPlayTrack(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('unrecognized Play track');
    }

    expect(notesAt(notes, 'manual').some(includesUnrecognizedPlayTrack)).toBe(true);
  }

  it(
    'flags an unrecognized Play track as manual without mapping it',
    flagsAnUnrecognizedPlayTrackAsManualWithoutMappingIt,
  );
}

describe('notesFromEasConfiguration', describeNotesFromEasConfiguration);

function describeCredentialsSummaryFromPieceNotesFromCredentialsSummary() {
  function keepsPathAndAliasFactsWhileDroppingPasswordFields() {
    const serialized = JSON.stringify({
      ios: {
        provisioningProfilePath: 'ios/certs/profile.mobileprovision',
        distributionCertificate: { path: 'ios/certs/dist.p12', password: 'SUPER_SECRET_PW' },
      },
      android: {
        keystore: {
          keystorePath: 'android/release.keystore',
          keyAlias: 'upload',
          keystorePassword: 'KS_SECRET',
          keyPassword: 'KEY_SECRET',
        },
      },
    });
    const credentialsSummary = credentialsSummaryFromJson(serialized);

    expect(credentialsSummary).toEqual({
      ios: {
        distributionCertificatePath: 'ios/certs/dist.p12',
        provisioningProfilePath: 'ios/certs/profile.mobileprovision',
      },
      android: {
        keystorePath: 'android/release.keystore',
        keyAlias: 'upload',
      },
    });

    const summaryJson = JSON.stringify(credentialsSummary);

    expect(summaryJson).not.toContain('SUPER_SECRET_PW');
    expect(summaryJson).not.toContain('KS_SECRET');
    expect(summaryJson).not.toContain('KEY_SECRET');
  }

  it(
    'keeps path and alias facts while dropping password fields',
    keepsPathAndAliasFactsWhileDroppingPasswordFields,
  );

  function returnsNullForEmptyOrUnusableCredentialsDocuments() {
    const credentialsSummaryFrom = credentialsSummaryFromJson('{}');

    expect(credentialsSummaryFrom).toBeNull();
    expect(credentialsSummaryFromJson('{ not json')).toBeNull();

    const serialized = JSON.stringify({ ios: {} });

    expect(credentialsSummaryFromJson(serialized)).toBeNull();
  }

  it(
    'returns null for empty or unusable credentials documents',
    returnsNullForEmptyOrUnusableCredentialsDocuments,
  );

  function emitsManualCredsFollowUpsThatPointAtLaunchStoreCredsForPathFactsOnly() {
    const notes = notesFromCredentialsSummary({
      ios: { distributionCertificatePath: 'ios/certs/dist.p12' },
      android: { keystorePath: 'android/release.keystore', keyAlias: 'upload' },
    });

    function readMessage4(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const messages = notes.map(readMessage4);

    function includesDistCertificatePath(message: string) {
      return message.includes('ios/certs/dist.p12');
    }

    expect(messages.some(includesDistCertificatePath)).toBe(true);

    function includesReleaseKeystorePath(message: string) {
      return message.includes('android/release.keystore');
    }

    expect(messages.some(includesReleaseKeystorePath)).toBe(true);

    function includesUploadKeyAlias(message: string) {
      return message.includes('"upload"');
    }

    expect(messages.some(includesUploadKeyAlias)).toBe(true);

    const serialized = JSON.stringify(notes);

    expect(serialized).not.toContain('SUPER_SECRET');
  }

  it(
    'emits manual creds follow-ups that point at launch-store creds for path facts only',
    emitsManualCredsFollowUpsThatPointAtLaunchStoreCredsForPathFactsOnly,
  );
}

describe(
  'credentialsSummaryFromJson / notesFromCredentialsSummary',
  describeCredentialsSummaryFromPieceNotesFromCredentialsSummary,
);

function describeExpoFactsFromResolvedPieceNotesFromExpoFacts() {
  function readsWrappedExpoFactsAndDescribesPolicyRuntimeVersions() {
    const expoFacts = expoFactsFromResolvedConfig({
      expo: {
        owner: 'acme-org',
        runtimeVersion: { policy: 'sdkVersion' },
        updates: { url: 'https://u.expo.dev/abc' },
        extra: { eas: { projectId: '11111111-2222-3333-4444-555555555555' } },
      },
    });

    expect(expoFacts).not.toBeNull();

    if (expoFacts == null) return;

    expect(expoFacts.runtimeVersion).toEqual({ policy: 'sdkVersion' });

    if (expoFacts.runtimeVersion == null) return;

    expect(describeRuntimeVersion(expoFacts.runtimeVersion)).toBe('policy "sdkVersion"');

    function readMessage5(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const informational = notesFromExpoFacts('alpha', expoFacts).map(readMessage5);

    function includesEasProjectUuid(message: string) {
      return message.includes('11111111-2222-3333-4444-555555555555');
    }

    expect(informational.some(includesEasProjectUuid)).toBe(true);

    function includesAcmeOrganization(message: string) {
      return message.includes('acme-org');
    }

    expect(informational.some(includesAcmeOrganization)).toBe(true);

    function includesSdkVersionField(message: string) {
      return message.includes('sdkVersion');
    }

    expect(informational.some(includesSdkVersionField)).toBe(true);

    function includesExpoUpdatesBlock(message: string) {
      return message.includes('expo.updates');
    }

    expect(informational.some(includesExpoUpdatesBlock)).toBe(true);
  }

  it(
    'reads wrapped expo facts and describes policy runtime versions',
    readsWrappedExpoFactsAndDescribesPolicyRuntimeVersions,
  );

  function acceptsABareExpoDocumentAndAStringRuntimeVersion() {
    const expoFacts = expoFactsFromResolvedConfig({
      owner: 'solo',
      runtimeVersion: '1.2.3',
    });

    expect(expoFacts).not.toBeNull();

    if (expoFacts == null) return;

    expect(expoFacts.runtimeVersion).toBe('1.2.3');

    if (expoFacts.runtimeVersion == null) return;

    expect(describeRuntimeVersion(expoFacts.runtimeVersion)).toBe('1.2.3');
  }

  it(
    'accepts a bare expo document and a string runtimeVersion',
    acceptsABareExpoDocumentAndAStringRuntimeVersion,
  );
}

describe(
  'expoFactsFromResolvedConfig / notesFromExpoFacts',
  describeExpoFactsFromResolvedPieceNotesFromExpoFacts,
);

function describeMigrateEas() {
  let dir: string;

  function prepareMigrateEas() {
    const systemTemporaryDirectory = tmpdir();
    const launchMigratePath = join(systemTemporaryDirectory, 'launch-migrate-');

    dir = mkdtempSync(launchMigratePath);

    const easPath = join(dir, 'eas.json');

    writeFileSync(easPath, SAMPLE_EAS);
  }

  beforeEach(prepareMigrateEas);

  function cleanupMigrateEas() {
    rmSync(dir, { recursive: true, force: true });
  }

  afterEach(cleanupMigrateEas);

  function runMigrateEas(workingDirectory: string, apps: AppDescriptor[]) {
    return migrateEas(workingDirectory, apps);
  }

  async function returnsATaggedFailureWhenThereIsNoEasPiece() {
    const easPath = join(dir, 'eas.json');

    rmSync(easPath);
    await expect(migrateEas(dir, [app()])).rejects.toMatchObject({
      _tag: 'EasMigrationFailure',
      reason: 'MissingEasConfig',
    });
  }

  it(
    'returns a tagged failure when there is no eas.json',
    returnsATaggedFailureWhenThereIsNoEasPiece,
  );

  async function emitsLaunchPieceTsCarryingEveryEASBuildProfile() {
    const migration = await runMigrateEas(dir, [app()]);
    const config = artifact(migration.artifacts, 'launch.config.ts').contents;

    expect(config).toContain('"development"');
    expect(config).toContain('"production"');
    expect(config).toContain('defineConfig');
  }

  it(
    'emits launch.config.ts carrying every EAS build profile',
    emitsLaunchPieceTsCarryingEveryEASBuildProfile,
  );

  async function liftsThePlayTrackFromTheMatchingSubmitProfileOntoTheBuildProfile() {
    const config = artifact(
      (await runMigrateEas(dir, [app()])).artifacts,
      'launch.config.ts',
    ).contents;

    expect(config).toContain('"track": "internal"');
  }

  it(
    'lifts the Play track from the matching submit profile onto the build profile',
    liftsThePlayTrackFromTheMatchingSubmitProfileOntoTheBuildProfile,
  );

  async function collectsPieceKeysSortedValuesBlankedIntoPieceExample() {
    const env = artifact((await runMigrateEas(dir, [app()])).artifacts, '.env.example').contents;
    expect(env).toContain('API_URL=');
    expect(env).toContain('SENTRY_DSN=');
    expect(env).not.toContain('https://prod');
  }

  it(
    'collects env keys (sorted, values blanked) into .env.example',
    collectsPieceKeysSortedValuesBlankedIntoPieceExample,
  );

  async function emitsAPieceProfileFileKeysOnlyForEachProfileThatCarriesItsOwnPiece() {
    const migration = await runMigrateEas(dir, [app()]);
    const dev = artifact(migration.artifacts, '.env.development').contents;
    const prod = artifact(migration.artifacts, '.env.production').contents;

    expect(dev).toContain('API_URL=');
    expect(dev).not.toContain('https://dev');
    expect(prod).toContain('API_URL=');
    expect(prod).toContain('SENTRY_DSN=');
    expect(prod).not.toContain('https://prod');

    function includesProductionProfileFile(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('.env.production');
    }

    expect(notesAt(migration.notes, 'mapped').some(includesProductionProfileFile)).toBe(true);
  }

  it(
    'emits a .env.<profile> file (keys only) for each profile that carries its own env',
    emitsAPieceProfileFileKeysOnlyForEachProfileThatCarriesItsOwnPiece,
  );

  async function scaffoldsStorePiecePieceWhenAbsentAndNotesItAsManual() {
    const migration = await runMigrateEas(dir, [app()]);

    function readPath(migrationArtifact: { readonly path: string; readonly contents: string }) {
      return migrationArtifact.path;
    }

    expect(migration.artifacts.map(readPath)).not.toContain('store.config.json');

    function readMessage6(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt(migration.notes, 'manual').map(readMessage6);

    function includesListingNote(message: string) {
      return message.includes('launch.config.ts');
    }

    expect(manual.some(includesListingNote)).toBe(true);
  }

  it(
    'notes that the listing belongs in launch.config.ts when no store file exists',
    scaffoldsStorePiecePieceWhenAbsentAndNotesItAsManual,
  );

  async function skipsStorePiecePieceWhenOneAlreadyExists() {
    const storePath = join(dir, 'store.config.json');

    writeFileSync(storePath, '{}');

    const migration = await runMigrateEas(dir, [app()]);

    function readPath2(migrationArtifact: { readonly path: string; readonly contents: string }) {
      return migrationArtifact.path;
    }

    expect(migration.artifacts.map(readPath2)).not.toContain('store.config.json');

    function includesSkippedStoreFile(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('store.config.json');
    }

    expect(notesAt(migration.notes, 'skipped').some(includesSkippedStoreFile)).toBe(true);
  }

  it('skips store.config.json when one already exists', skipsStorePiecePieceWhenOneAlreadyExists);

  async function reportsEASUpdateChannelsInternalDistributionAndSubmitCredentialsAsManual() {
    function readMessage7(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt((await runMigrateEas(dir, [app()])).notes, 'manual').map(readMessage7);

    function includesChannelFollowUp(message: string) {
      return message.includes('channel');
    }

    expect(manual.some(includesChannelFollowUp)).toBe(true);

    function includesAdHocFollowUp(message: string) {
      return message.includes('internal (ad-hoc) distribution');
    }

    expect(manual.some(includesAdHocFollowUp)).toBe(true);

    function includesAppleAccountFollowUp(message: string) {
      return message.includes('Apple account details');
    }

    expect(manual.some(includesAppleAccountFollowUp)).toBe(true);

    function includesPlayAccountFollowUp(message: string) {
      return message.includes('Play service account');
    }

    expect(manual.some(includesPlayAccountFollowUp)).toBe(true);
  }

  it(
    'reports EAS Update channels, internal distribution, and submit credentials as manual',
    reportsEASUpdateChannelsInternalDistributionAndSubmitCredentialsAsManual,
  );

  async function importsLocalCredentialsPieceAsManualNotesWithoutEverSurfacingAPassword() {
    const credentialsPath = join(dir, 'credentials.json');
    const serialized = JSON.stringify({
      ios: {
        provisioningProfilePath: 'ios/certs/profile.mobileprovision',
        distributionCertificate: { path: 'ios/certs/dist.p12', password: 'SUPER_SECRET_PW' },
      },
      android: {
        keystore: {
          keystorePath: 'android/release.keystore',
          keyAlias: 'upload',
          keystorePassword: 'KS_SECRET',
          keyPassword: 'KEY_SECRET',
        },
      },
    });

    writeFileSync(credentialsPath, serialized);

    const migration = await runMigrateEas(dir, [app()]);

    function readMessage8(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const manual = notesAt(migration.notes, 'manual').map(readMessage8);

    function includesCertificateAndCreds(message: string) {
      return message.includes('ios/certs/dist.p12') && message.includes('launch-store creds');
    }

    expect(manual.some(includesCertificateAndCreds)).toBe(true);

    function includesKeystoreAndUpload(message: string) {
      return message.includes('android/release.keystore') && message.includes('"upload"');
    }

    expect(manual.some(includesKeystoreAndUpload)).toBe(true);

    const migrationJson = JSON.stringify(migration);

    expect(migrationJson).not.toContain('SUPER_SECRET_PW');
    expect(migrationJson).not.toContain('KS_SECRET');
    expect(migrationJson).not.toContain('KEY_SECRET');
  }

  it(
    'imports local credentials.json as manual notes without ever surfacing a password',
    importsLocalCredentialsPieceAsManualNotesWithoutEverSurfacingAPassword,
  );

  async function reportsRemoteAppVersionPieceAndDetectedIdsAsNonManual() {
    const migration = await runMigrateEas(dir, [app({ packageName: 'com.acme.alpha' })]);

    function includesMappedVersionSetting(note: {
      readonly level: MigrationNoteLevel;
      readonly message: string;
    }) {
      return note.message.includes('appVersionSource');
    }

    expect(notesAt(migration.notes, 'mapped').some(includesMappedVersionSetting)).toBe(true);

    function readMessage9(note: { readonly level: MigrationNoteLevel; readonly message: string }) {
      return note.message;
    }

    const informationalNotes = notesAt(migration.notes, 'info').map(readMessage9);

    function includesAcmeBundleId(message: string) {
      return message.includes('com.acme.alpha') && message.includes('bundle id');
    }

    expect(informationalNotes.some(includesAcmeBundleId)).toBe(true);

    function includesAcmeAndroidPackage(message: string) {
      return message.includes('com.acme.alpha') && message.includes('package');
    }

    expect(informationalNotes.some(includesAcmeAndroidPackage)).toBe(true);
  }

  it(
    'reports remote appVersionSource and detected ids as non-manual',
    reportsRemoteAppVersionPieceAndDetectedIdsAsNonManual,
  );

  async function surfacesEASAppFactsProjectIdOwnerRuntimeVersionUpdatesFromAppPieceAsPieceNotes() {
    const systemTemporaryDirectory = tmpdir();
    const launchMigrateAppPath = join(systemTemporaryDirectory, 'launch-migrate-app-');
    const appDir = mkdtempSync(launchMigrateAppPath);
    const easPath = join(appDir, 'eas.json');

    writeFileSync(easPath, SAMPLE_EAS);

    const appPath = join(appDir, 'app.json');
    const serialized = JSON.stringify({
      expo: {
        name: 'alpha',
        slug: 'alpha',
        owner: 'acme-org',
        runtimeVersion: { policy: 'sdkVersion' },
        updates: { url: 'https://u.expo.dev/abc' },
        extra: { eas: { projectId: '11111111-2222-3333-4444-555555555555' } },
      },
    });

    writeFileSync(appPath, serialized);

    try {
      const appPath = join(appDir, 'app.json');
      const migration = await runMigrateEas(appDir, [app({ dir: appDir, configPath: appPath })]);

      function readMessage10(note: {
        readonly level: MigrationNoteLevel;
        readonly message: string;
      }) {
        return note.message;
      }

      const informationalNotes = notesAt(migration.notes, 'info').map(readMessage10);

      function includesRepeatedProjectUuid(message: string) {
        return message.includes('11111111-2222-3333-4444-555555555555');
      }

      expect(informationalNotes.some(includesRepeatedProjectUuid)).toBe(true);

      function includesRepeatedAcmeOrg(message: string) {
        return message.includes('acme-org');
      }

      expect(informationalNotes.some(includesRepeatedAcmeOrg)).toBe(true);

      function includesRepeatedSdkVersion(message: string) {
        return message.includes('sdkVersion');
      }

      expect(informationalNotes.some(includesRepeatedSdkVersion)).toBe(true);

      function includesRepeatedExpoUpdates(message: string) {
        return message.includes('expo.updates');
      }

      expect(informationalNotes.some(includesRepeatedExpoUpdates)).toBe(true);
    } finally {
      rmSync(appDir, { recursive: true, force: true });
    }
  }

  it(
    'surfaces EAS app facts (projectId, owner, runtimeVersion, updates) from app.json as info notes',
    surfacesEASAppFactsProjectIdOwnerRuntimeVersionUpdatesFromAppPieceAsPieceNotes,
  );

  async function fallsBackToASingleProductionProfileWhenEasPieceDeclaresNone2() {
    const easPath = join(dir, 'eas.json');
    const serialized = JSON.stringify({ submit: {} });

    writeFileSync(easPath, serialized);

    const config = artifact(
      (await runMigrateEas(dir, [app()])).artifacts,
      'launch.config.ts',
    ).contents;

    expect(config).toContain('"production"');
  }

  it(
    'falls back to a single production profile when eas.json declares none',
    fallsBackToASingleProductionProfileWhenEasPieceDeclaresNone2,
  );
}

describe('migrateEas', describeMigrateEas);
