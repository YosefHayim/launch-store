import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readResolvedConfig } from '../config/config.ts';
import { configTemplate, detectAppRoot } from '../config/configScaffold.ts';
import { pathExists } from '../path-exists.ts';
import type { AppDescriptor, BuildProfile, PlayTrack } from '../types/app.ts';
import type {
  EasBuildProfile,
  EasJson,
  EasSubmitProfile,
  MigrationArtifact,
  MigrationNote,
  MigrationResult,
} from '../types/migrate.ts';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.ts';

type EasSubmitIos = NonNullable<EasSubmitProfile['ios']>;
type EasSubmitAndroid = NonNullable<EasSubmitProfile['android']>;

type CredentialsSummary = Readonly<{
  ios?: Readonly<{
    distributionCertificatePath?: string;
    provisioningProfilePath?: string;
  }>;
  android?: Readonly<{
    keystorePath?: string;
    keyAlias?: string;
  }>;
}>;

type RuntimeVersion = string | { policy?: string };

type ExpoFacts = Readonly<{
  owner?: string;
  runtimeVersion?: RuntimeVersion;
  updates?: unknown;
  extra?: Readonly<{
    eas?: Readonly<{
      projectId?: string;
    }>;
  }>;
}>;

type ExactString = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'present'; text: string };

type ExactFlag = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'present'; flag: boolean };

type ExactFlagOrText =
  | { kind: 'absent' }
  | { kind: 'invalid' }
  | { kind: 'present'; flag: boolean | string };

export type EasMigrationFailure = Readonly<{
  readonly _tag: 'EasMigrationFailure';
  readonly reason: 'InvalidEasJson' | 'MissingEasConfig';
  readonly sourcePath?: string;
  readonly cause?: unknown;
}>;

const PLAY_TRACKS: readonly PlayTrack[] = ['internal', 'closed', 'open', 'production'];
const DEFAULT_PROFILE_SIZE_BUDGET_MB = 200;

function makeEasMigrationFailure(fields: {
  reason: 'InvalidEasJson' | 'MissingEasConfig';
  sourcePath?: string;
  cause?: unknown;
}): EasMigrationFailure {
  return { _tag: 'EasMigrationFailure', ...fields };
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  if (Array.isArray(candidate)) {
    return false;
  }

  return true;
}

function readExactString(record: Record<string, unknown>, fieldName: string): ExactString {
  if (Object.hasOwn(record, fieldName) == false) {
    return { kind: 'absent' };
  }

  const field = record[fieldName];

  if (typeof field != 'string') {
    return { kind: 'invalid' };
  }

  return { kind: 'present', text: field };
}

function readExactFlag(record: Record<string, unknown>, fieldName: string): ExactFlag {
  if (Object.hasOwn(record, fieldName) == false) {
    return { kind: 'absent' };
  }

  const field = record[fieldName];

  if (typeof field != 'boolean') {
    return { kind: 'invalid' };
  }

  return { kind: 'present', flag: field };
}

function readExactFlagOrText(record: Record<string, unknown>, fieldName: string): ExactFlagOrText {
  if (Object.hasOwn(record, fieldName) == false) {
    return { kind: 'absent' };
  }

  const field = record[fieldName];

  if (typeof field == 'boolean') {
    return { kind: 'present', flag: field };
  }

  if (typeof field == 'string') {
    return { kind: 'present', flag: field };
  }

  return { kind: 'invalid' };
}

function keepStringEntry(
  entryName: string,
  unknownEntry: unknown,
  stringEntries: Record<string, string>,
): void {
  if (typeof unknownEntry != 'string') {
    return;
  }

  stringEntries[entryName] = unknownEntry;
}

function decodeStringEntries(rawEntries: unknown): Record<string, string> | null {
  if (isRecord(rawEntries) == false) {
    return null;
  }

  const stringEntries: Record<string, string> = {};

  for (const [entryName, unknownEntry] of Object.entries(rawEntries)) {
    keepStringEntry(entryName, unknownEntry, stringEntries);
  }

  return stringEntries;
}

function decodeBuildProfile(rawProfile: unknown): EasBuildProfile | null {
  if (isRecord(rawProfile) == false) {
    return null;
  }

  const buildProfile: {
    channel?: string;
    distribution?: string;
    env?: Record<string, string>;
    autoIncrement?: boolean | string;
    developmentClient?: boolean;
  } = {};
  const channel = readExactString(rawProfile, 'channel');

  if (channel.kind == 'invalid') {
    return null;
  }

  if (channel.kind == 'present') {
    buildProfile.channel = channel.text;
  }

  const distribution = readExactString(rawProfile, 'distribution');

  if (distribution.kind == 'invalid') {
    return null;
  }

  if (distribution.kind == 'present') {
    buildProfile.distribution = distribution.text;
  }

  if (Object.hasOwn(rawProfile, 'env')) {
    const environment = decodeStringEntries(rawProfile['env']);

    if (environment == null) {
      return null;
    }

    buildProfile.env = environment;
  }

  const autoIncrement = readExactFlagOrText(rawProfile, 'autoIncrement');

  if (autoIncrement.kind == 'invalid') {
    return null;
  }

  if (autoIncrement.kind == 'present') {
    buildProfile.autoIncrement = autoIncrement.flag;
  }

  const developmentClient = readExactFlag(rawProfile, 'developmentClient');

  if (developmentClient.kind == 'invalid') {
    return null;
  }

  if (developmentClient.kind == 'present') {
    buildProfile.developmentClient = developmentClient.flag;
  }

  return buildProfile;
}

function decodeBuildProfiles(rawProfiles: unknown): Record<string, EasBuildProfile> | null {
  if (isRecord(rawProfiles) == false) {
    return null;
  }

  const buildProfiles: Record<string, EasBuildProfile> = {};

  for (const [profileName, unknownProfile] of Object.entries(rawProfiles)) {
    const decodedProfile = decodeBuildProfile(unknownProfile);

    if (decodedProfile == null) {
      continue;
    }

    buildProfiles[profileName] = decodedProfile;
  }

  return buildProfiles;
}

function decodeSubmitIos(rawIos: unknown): EasSubmitIos | null {
  if (isRecord(rawIos) == false) {
    return null;
  }

  const iosSubmission: {
    appleId?: string;
    ascAppId?: string;
    appleTeamId?: string;
  } = {};
  const appleId = readExactString(rawIos, 'appleId');

  if (appleId.kind == 'invalid') {
    return null;
  }

  if (appleId.kind == 'present') {
    iosSubmission.appleId = appleId.text;
  }

  const ascAppId = readExactString(rawIos, 'ascAppId');

  if (ascAppId.kind == 'invalid') {
    return null;
  }

  if (ascAppId.kind == 'present') {
    iosSubmission.ascAppId = ascAppId.text;
  }

  const appleTeamId = readExactString(rawIos, 'appleTeamId');

  if (appleTeamId.kind == 'invalid') {
    return null;
  }

  if (appleTeamId.kind == 'present') {
    iosSubmission.appleTeamId = appleTeamId.text;
  }

  return iosSubmission;
}

function decodeSubmitAndroid(rawAndroid: unknown): EasSubmitAndroid | null {
  if (isRecord(rawAndroid) == false) {
    return null;
  }

  const androidSubmission: {
    serviceAccountKeyPath?: string;
    track?: string;
  } = {};
  const serviceAccountKeyPath = readExactString(rawAndroid, 'serviceAccountKeyPath');

  if (serviceAccountKeyPath.kind == 'invalid') {
    return null;
  }

  if (serviceAccountKeyPath.kind == 'present') {
    androidSubmission.serviceAccountKeyPath = serviceAccountKeyPath.text;
  }

  const track = readExactString(rawAndroid, 'track');

  if (track.kind == 'invalid') {
    return null;
  }

  if (track.kind == 'present') {
    androidSubmission.track = track.text;
  }

  return androidSubmission;
}

function hasIosSubmitFields(iosSubmission: EasSubmitIos): boolean {
  if (iosSubmission.appleId != null) {
    return true;
  }

  if (iosSubmission.ascAppId != null) {
    return true;
  }

  return iosSubmission.appleTeamId != null;
}

function hasAndroidSubmitFields(androidSubmission: EasSubmitAndroid): boolean {
  if (androidSubmission.serviceAccountKeyPath != null) {
    return true;
  }

  return androidSubmission.track != null;
}

function decodeSubmitProfile(rawProfile: unknown): EasSubmitProfile | null {
  if (isRecord(rawProfile) == false) {
    return null;
  }

  const submitProfile: {
    ios?: EasSubmitIos;
    android?: EasSubmitAndroid;
  } = {};

  if (Object.hasOwn(rawProfile, 'ios')) {
    const iosSubmission = decodeSubmitIos(rawProfile['ios']);

    if (iosSubmission == null) {
      return null;
    }

    if (hasIosSubmitFields(iosSubmission)) {
      submitProfile.ios = iosSubmission;
    }
  }

  if (Object.hasOwn(rawProfile, 'android')) {
    const androidSubmission = decodeSubmitAndroid(rawProfile['android']);

    if (androidSubmission == null) {
      return null;
    }

    if (hasAndroidSubmitFields(androidSubmission)) {
      submitProfile.android = androidSubmission;
    }
  }

  return submitProfile;
}

function decodeSubmitProfiles(rawProfiles: unknown): Record<string, EasSubmitProfile> | null {
  if (isRecord(rawProfiles) == false) {
    return null;
  }

  const submitProfiles: Record<string, EasSubmitProfile> = {};

  for (const [profileName, unknownProfile] of Object.entries(rawProfiles)) {
    const decodedProfile = decodeSubmitProfile(unknownProfile);

    if (decodedProfile == null) {
      continue;
    }

    submitProfiles[profileName] = decodedProfile;
  }

  return submitProfiles;
}

function decodeCli(rawCli: unknown): { appVersionSource?: string } | null {
  if (isRecord(rawCli) == false) {
    return null;
  }

  const cli: { appVersionSource?: string } = {};
  const appVersionSource = readExactString(rawCli, 'appVersionSource');

  if (appVersionSource.kind == 'invalid') {
    return null;
  }

  if (appVersionSource.kind == 'present') {
    cli.appVersionSource = appVersionSource.text;
  }

  return cli;
}

function readDefaultSection(document: Record<string, unknown>, fieldName: string): unknown {
  if (Object.hasOwn(document, fieldName) == false) {
    return {};
  }

  const field = document[fieldName];

  if (typeof field == 'undefined') {
    return {};
  }

  return field;
}

function decodeEasDocument(rawDocument: unknown): EasJson {
  if (isRecord(rawDocument) == false) {
    throw new Error('eas.json must be a JSON object.');
  }

  const easConfiguration: {
    cli?: { appVersionSource?: string };
    build: Record<string, EasBuildProfile>;
    submit: Record<string, EasSubmitProfile>;
  } = {
    build: {},
    submit: {},
  };

  if (Object.hasOwn(rawDocument, 'cli')) {
    const cli = decodeCli(rawDocument['cli']);

    if (cli == null) {
      throw new Error('cli must be an object.');
    }

    easConfiguration.cli = cli;
  }

  const buildProfiles = decodeBuildProfiles(readDefaultSection(rawDocument, 'build'));

  if (buildProfiles == null) {
    throw new Error('build must be an object.');
  }

  easConfiguration.build = buildProfiles;
  const submitProfiles = decodeSubmitProfiles(readDefaultSection(rawDocument, 'submit'));

  if (submitProfiles == null) {
    throw new Error('submit must be an object.');
  }

  easConfiguration.submit = submitProfiles;

  return easConfiguration;
}

/** Decode the EAS fields that Launch migrates and discard unsupported fields at the boundary. */
export function parseEasJson(easJsonSource: string): EasJson {
  let parsedDocument: unknown;

  try {
    parsedDocument = JSON.parse(easJsonSource);
  } catch (cause) {
    throw makeEasMigrationFailure({ reason: 'InvalidEasJson', cause });
  }

  try {
    return decodeEasDocument(parsedDocument);
  } catch (cause) {
    throw makeEasMigrationFailure({ reason: 'InvalidEasJson', cause });
  }
}

function isPlayTrack(trackName: string): trackName is PlayTrack {
  function sameTrack(playTrack: PlayTrack): boolean {
    return playTrack == trackName;
  }

  return PLAY_TRACKS.some(sameTrack);
}

function trackFromSubmitProfile(submitProfile: EasSubmitProfile | undefined): PlayTrack | null {
  if (submitProfile == null) {
    return null;
  }

  const androidSubmission = submitProfile.android;

  if (androidSubmission == null) {
    return null;
  }

  const trackName = androidSubmission.track;

  if (trackName == null) {
    return null;
  }

  if (isPlayTrack(trackName) == false) {
    return null;
  }

  return trackName;
}

/** Project EAS build profiles into Launch `profiles`, lifting a matching Play submit track when valid. */
export function launchProfilesFromEas(easConfiguration: EasJson): Record<string, BuildProfile> {
  const launchProfiles: Record<string, BuildProfile> = {};

  for (const profileName of Object.keys(easConfiguration.build)) {
    const launchProfile: BuildProfile = {
      name: profileName,
      sizeBudgetMB: DEFAULT_PROFILE_SIZE_BUDGET_MB,
    };
    const playTrack = trackFromSubmitProfile(easConfiguration.submit[profileName]);

    if (playTrack != null) {
      launchProfile.track = playTrack;
    }

    launchProfiles[profileName] = launchProfile;
  }

  if (Object.keys(launchProfiles).length == 0) {
    launchProfiles['production'] = {
      name: 'production',
      sizeBudgetMB: DEFAULT_PROFILE_SIZE_BUDGET_MB,
    };
  }

  return launchProfiles;
}

function indentProfileLine(lineIndex: number, profileLine: string): string {
  if (lineIndex == 0) {
    return profileLine;
  }

  return `  ${profileLine}`;
}

function serializeProfilesSection(launchProfiles: Record<string, BuildProfile>): string {
  const profileLines = JSON.stringify(launchProfiles, null, 2).split('\n');
  const indentedLines: string[] = [];

  for (const [lineIndex, profileLine] of profileLines.entries()) {
    indentedLines.push(indentProfileLine(lineIndex, profileLine));
  }

  return [
    '  // Imported from eas.json by `launch migrate eas` - review, then commit.',
    `  profiles: ${indentedLines.join('\n')},`,
  ].join('\n');
}

/** Sorted union of env keys declared across every EAS build profile. */
export function collectEnvironmentKeys(easConfiguration: EasJson): string[] {
  const environmentKeys = new Set<string>();

  for (const buildProfile of Object.values(easConfiguration.build)) {
    if (buildProfile.env == null) {
      continue;
    }

    for (const environmentKey of Object.keys(buildProfile.env)) {
      environmentKeys.add(environmentKey);
    }
  }

  return [...environmentKeys].sort();
}

function profileEnvironmentArtifactsFromEas(easConfiguration: EasJson): MigrationArtifact[] {
  const environmentArtifacts: MigrationArtifact[] = [];

  for (const [profileName, buildProfile] of Object.entries(easConfiguration.build)) {
    if (buildProfile.env == null) {
      continue;
    }

    environmentArtifacts.push({
      path: `.env.${profileName}`,
      contents: buildEnvExample(Object.keys(buildProfile.env).sort()),
    });
  }

  return environmentArtifacts;
}

function notesFromBuildProfiles(easConfiguration: EasJson): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];

  for (const [profileName, buildProfile] of Object.entries(easConfiguration.build)) {
    migrationNotes.push({
      level: 'mapped',
      message: `Build profile "${profileName}" -> Launch profile "${profileName}".`,
    });

    if (buildProfile.env != null) {
      migrationNotes.push({
        level: 'mapped',
        message: `Profile "${profileName}" env keys -> .env.${profileName} (values left blank - fill them in; they may be secrets).`,
      });
    }

    if (buildProfile.channel != null) {
      migrationNotes.push({
        level: 'manual',
        message: `Profile "${profileName}" published to EAS Update channel "${buildProfile.channel}" - set up OTA with \`launch update --channel ${buildProfile.channel}\` (see \`launch explain ota-update\`).`,
      });
    }

    if (buildProfile.distribution == 'internal') {
      migrationNotes.push({
        level: 'manual',
        message: `Profile "${profileName}" used internal (ad-hoc) distribution - register tester devices with \`launch device add\` (see \`launch explain ad-hoc-distribution\`).`,
      });
    }

    if (buildProfile.developmentClient == true) {
      migrationNotes.push({
        level: 'manual',
        message: `Profile "${profileName}" built a development client - that's a dev tool, not a store build; Launch ships store and TestFlight builds.`,
      });
    }
  }

  return migrationNotes;
}

function isUnrecognizedPlayTrack(trackName: string | undefined): boolean {
  if (trackName == null) {
    return false;
  }

  return isPlayTrack(trackName) == false;
}

function notesFromSubmitProfiles(easConfiguration: EasJson): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];

  for (const [profileName, submitProfile] of Object.entries(easConfiguration.submit)) {
    if (submitProfile.ios != null) {
      migrationNotes.push({
        level: 'manual',
        message: `Submit profile "${profileName}" carried Apple account details (appleId/ascAppId/appleTeamId) - configure your Apple API key with \`launch creds set-key\`.`,
      });
    }

    const androidSubmission = submitProfile.android;

    if (androidSubmission == null) {
      continue;
    }

    if (androidSubmission.serviceAccountKeyPath != null) {
      migrationNotes.push({
        level: 'manual',
        message: `Submit profile "${profileName}" referenced a Play service account key (${androidSubmission.serviceAccountKeyPath}) - configure it with \`launch creds\`.`,
      });
    }

    if (isUnrecognizedPlayTrack(androidSubmission.track)) {
      migrationNotes.push({
        level: 'manual',
        message: `Submit profile "${profileName}" had an unrecognized Play track "${androidSubmission.track}" - set a valid track (internal/closed/open/production) on the profile.`,
      });
    }
  }

  return migrationNotes;
}

function notesFromEasCli(easConfiguration: EasJson): MigrationNote[] {
  const cliBlock = easConfiguration.cli;

  if (cliBlock == null) {
    return [];
  }

  if (cliBlock.appVersionSource != 'remote') {
    return [];
  }

  return [
    {
      level: 'mapped',
      message:
        '`cli.appVersionSource: remote` -> Launch already bumps build numbers from the store, matching remote.',
    },
  ];
}

function notesFromAppIdentifiers(apps: AppDescriptor[]): MigrationNote[] {
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

/** Report notes for build/submit/cli mapping and detected store identifiers. */
export function notesFromEasConfiguration(
  easConfiguration: EasJson,
  apps: AppDescriptor[],
): MigrationNote[] {
  return [
    ...notesFromBuildProfiles(easConfiguration),
    ...notesFromSubmitProfiles(easConfiguration),
    ...notesFromEasCli(easConfiguration),
    {
      level: 'manual',
      message:
        'EAS built in the cloud; Launch builds locally by default (`buildEngine: "xcode"`). No Mac? Set `buildEngine: "eas"` or run `launch build --remote` (see `launch explain eas-handoff`).',
    },
    ...notesFromAppIdentifiers(apps),
  ];
}

type CredentialsIos = {
  provisioningProfilePath?: string;
  distributionCertificate?: { path?: string };
};

type CredentialsAndroid = {
  keystore?: {
    keystorePath?: string;
    keyAlias?: string;
  };
};

function decodeCertificate(rawCertificate: unknown): { path?: string } | null {
  if (isRecord(rawCertificate) == false) {
    return null;
  }

  const certificate: { path?: string } = {};
  const certificatePath = readExactString(rawCertificate, 'path');

  if (certificatePath.kind == 'invalid') {
    return null;
  }

  if (certificatePath.kind == 'present') {
    certificate.path = certificatePath.text;
  }

  return certificate;
}

function decodeCredentialsIos(rawIos: unknown): CredentialsIos | null {
  if (isRecord(rawIos) == false) {
    return null;
  }

  const iosCredentials: CredentialsIos = {};
  const provisioningProfilePath = readExactString(rawIos, 'provisioningProfilePath');

  if (provisioningProfilePath.kind == 'invalid') {
    return null;
  }

  if (provisioningProfilePath.kind == 'present') {
    iosCredentials.provisioningProfilePath = provisioningProfilePath.text;
  }

  if (Object.hasOwn(rawIos, 'distributionCertificate')) {
    const distributionCertificate = decodeCertificate(rawIos['distributionCertificate']);

    if (distributionCertificate == null) {
      return null;
    }

    iosCredentials.distributionCertificate = distributionCertificate;
  }

  return iosCredentials;
}

function decodeKeystore(rawKeystore: unknown): { keystorePath?: string; keyAlias?: string } | null {
  if (isRecord(rawKeystore) == false) {
    return null;
  }

  const keystore: { keystorePath?: string; keyAlias?: string } = {};
  const keystorePath = readExactString(rawKeystore, 'keystorePath');

  if (keystorePath.kind == 'invalid') {
    return null;
  }

  if (keystorePath.kind == 'present') {
    keystore.keystorePath = keystorePath.text;
  }

  const keyAlias = readExactString(rawKeystore, 'keyAlias');

  if (keyAlias.kind == 'invalid') {
    return null;
  }

  if (keyAlias.kind == 'present') {
    keystore.keyAlias = keyAlias.text;
  }

  return keystore;
}

function decodeCredentialsAndroid(rawAndroid: unknown): CredentialsAndroid | null {
  if (isRecord(rawAndroid) == false) {
    return null;
  }

  const androidCredentials: CredentialsAndroid = {};

  if (Object.hasOwn(rawAndroid, 'keystore')) {
    const keystore = decodeKeystore(rawAndroid['keystore']);

    if (keystore == null) {
      return null;
    }

    androidCredentials.keystore = keystore;
  }

  return androidCredentials;
}

function decodeCredentialsDocument(rawDocument: unknown): {
  ios?: CredentialsIos;
  android?: CredentialsAndroid;
} | null {
  if (isRecord(rawDocument) == false) {
    return null;
  }

  const credentialsDocument: { ios?: CredentialsIos; android?: CredentialsAndroid } = {};

  if (Object.hasOwn(rawDocument, 'ios')) {
    const iosCredentials = decodeCredentialsIos(rawDocument['ios']);

    if (iosCredentials == null) {
      return null;
    }

    credentialsDocument.ios = iosCredentials;
  }

  if (Object.hasOwn(rawDocument, 'android')) {
    const androidCredentials = decodeCredentialsAndroid(rawDocument['android']);

    if (androidCredentials == null) {
      return null;
    }

    credentialsDocument.android = androidCredentials;
  }

  return credentialsDocument;
}

function credentialsSummaryFromDocument(credentialsDocument: {
  ios?: CredentialsIos;
  android?: CredentialsAndroid;
}): CredentialsSummary | null {
  const credentialsSummary: {
    ios?: { distributionCertificatePath?: string; provisioningProfilePath?: string };
    android?: { keystorePath?: string; keyAlias?: string };
  } = {};
  const iosCredentials = credentialsDocument.ios;

  if (iosCredentials != null) {
    let distributionCertificatePath: string | undefined;
    const distributionCertificate = iosCredentials.distributionCertificate;

    if (distributionCertificate != null) {
      distributionCertificatePath = distributionCertificate.path;
    }

    const provisioningProfilePath = iosCredentials.provisioningProfilePath;
    let hasIosSigningPath = distributionCertificatePath != null;

    if (provisioningProfilePath != null) {
      hasIosSigningPath = true;
    }

    if (hasIosSigningPath) {
      credentialsSummary.ios = {};

      if (distributionCertificatePath != null) {
        credentialsSummary.ios.distributionCertificatePath = distributionCertificatePath;
      }

      if (provisioningProfilePath != null) {
        credentialsSummary.ios.provisioningProfilePath = provisioningProfilePath;
      }
    }
  }

  const androidCredentials = credentialsDocument.android;

  if (androidCredentials != null) {
    const androidKeystore = androidCredentials.keystore;

    if (androidKeystore != null) {
      let hasAndroidKeystoreField = androidKeystore.keystorePath != null;

      if (androidKeystore.keyAlias != null) {
        hasAndroidKeystoreField = true;
      }

      if (hasAndroidKeystoreField) {
        credentialsSummary.android = {};

        if (androidKeystore.keystorePath != null) {
          credentialsSummary.android.keystorePath = androidKeystore.keystorePath;
        }

        if (androidKeystore.keyAlias != null) {
          credentialsSummary.android.keyAlias = androidKeystore.keyAlias;
        }
      }
    }
  }

  if (credentialsSummary.ios != null) {
    return credentialsSummary;
  }

  if (credentialsSummary.android != null) {
    return credentialsSummary;
  }

  return null;
}

/** Decode credentials.json source and keep only non-secret path/alias facts. */
export function credentialsSummaryFromJson(credentialsSource: string): CredentialsSummary | null {
  let parsedDocument: unknown;

  try {
    parsedDocument = JSON.parse(credentialsSource);
  } catch (error) {
    const isInvalidJson = error != null;

    if (isInvalidJson) {
      return null;
    }

    return null;
  }

  const credentialsDocument = decodeCredentialsDocument(parsedDocument);

  if (credentialsDocument == null) {
    return null;
  }

  return credentialsSummaryFromDocument(credentialsDocument);
}

async function readCredentialsSummary(
  workingDirectory: string,
): Promise<CredentialsSummary | null> {
  const credentialsPath = join(workingDirectory, 'credentials.json');
  const credentialsExist = await pathExists(credentialsPath);

  if (credentialsExist == false) {
    return null;
  }

  try {
    const credentialsSource = await readFile(credentialsPath, 'utf8');

    return credentialsSummaryFromJson(credentialsSource);
  } catch (error) {
    // An unreadable credentials.json is optional and does not stop the migration.
    const isUnreadable = error != null;

    if (isUnreadable) {
      return null;
    }

    return null;
  }
}

/** Manual follow-ups when local EAS credentials.json still holds signing material. */
export function notesFromCredentialsSummary(
  credentialsSummary: CredentialsSummary,
): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];
  const iosCredentials = credentialsSummary.ios;

  if (iosCredentials != null) {
    let certificateLocation = 'your distribution certificate';

    if (iosCredentials.distributionCertificatePath != null) {
      certificateLocation = iosCredentials.distributionCertificatePath;
    }

    migrationNotes.push({
      level: 'manual',
      message: `Local iOS signing material in credentials.json (${certificateLocation}) - import it with \`launch creds\`; Launch keeps certs in the OS keychain and never reads the password from credentials.json.`,
    });
  }

  const androidCredentials = credentialsSummary.android;

  if (androidCredentials != null) {
    let keystoreLocation = 'your release keystore';

    if (androidCredentials.keystorePath != null) {
      keystoreLocation = androidCredentials.keystorePath;
    }

    let keyAliasLabel = '';

    if (androidCredentials.keyAlias != null) {
      keyAliasLabel = `, key alias "${androidCredentials.keyAlias}"`;
    }

    migrationNotes.push({
      level: 'manual',
      message: `Local Android keystore in credentials.json (${keystoreLocation}${keyAliasLabel}) - register it with \`launch creds\`; the keystore/key passwords are never read from credentials.json.`,
    });
  }

  return migrationNotes;
}

function decodeRuntimeVersion(rawVersion: unknown): RuntimeVersion | null {
  if (typeof rawVersion == 'string') {
    return rawVersion;
  }

  if (isRecord(rawVersion) == false) {
    return null;
  }

  const runtimeVersion: { policy?: string } = {};
  const policy = readExactString(rawVersion, 'policy');

  if (policy.kind == 'invalid') {
    return null;
  }

  if (policy.kind == 'present') {
    runtimeVersion.policy = policy.text;
  }

  return runtimeVersion;
}

function decodeEasProject(rawProject: unknown): { projectId?: string } | null {
  if (isRecord(rawProject) == false) {
    return null;
  }

  const easProject: { projectId?: string } = {};
  const projectId = readExactString(rawProject, 'projectId');

  if (projectId.kind == 'invalid') {
    return null;
  }

  if (projectId.kind == 'present') {
    easProject.projectId = projectId.text;
  }

  return easProject;
}

function decodeExtra(rawExtra: unknown): { eas?: { projectId?: string } } | null {
  if (isRecord(rawExtra) == false) {
    return null;
  }

  const extra: { eas?: { projectId?: string } } = {};

  if (Object.hasOwn(rawExtra, 'eas')) {
    const easProject = decodeEasProject(rawExtra['eas']);

    if (easProject == null) {
      return null;
    }

    extra.eas = easProject;
  }

  return extra;
}

function decodeExpoFacts(rawFacts: unknown): ExpoFacts | null {
  if (isRecord(rawFacts) == false) {
    return null;
  }

  const expoFacts: {
    owner?: string;
    runtimeVersion?: RuntimeVersion;
    updates?: unknown;
    extra?: { eas?: { projectId?: string } };
  } = {};
  const owner = readExactString(rawFacts, 'owner');

  if (owner.kind == 'invalid') {
    return null;
  }

  if (owner.kind == 'present') {
    expoFacts.owner = owner.text;
  }

  if (Object.hasOwn(rawFacts, 'runtimeVersion')) {
    const runtimeVersion = decodeRuntimeVersion(rawFacts['runtimeVersion']);

    if (runtimeVersion == null) {
      return null;
    }

    expoFacts.runtimeVersion = runtimeVersion;
  }

  if (Object.hasOwn(rawFacts, 'updates')) {
    const updates = rawFacts['updates'];

    if (typeof updates == 'undefined') {
      return null;
    }

    expoFacts.updates = updates;
  }

  if (Object.hasOwn(rawFacts, 'extra')) {
    const extra = decodeExtra(rawFacts['extra']);

    if (extra == null) {
      return null;
    }

    expoFacts.extra = extra;
  }

  return expoFacts;
}

function decodeExpoWrapper(rawDocument: unknown): { expo?: ExpoFacts } | null {
  if (isRecord(rawDocument) == false) {
    return null;
  }

  if (Object.hasOwn(rawDocument, 'expo') == false) {
    return {};
  }

  const expoFacts = decodeExpoFacts(rawDocument['expo']);

  if (expoFacts == null) {
    return null;
  }

  return { expo: expoFacts };
}

function wrappedExpoFacts(resolvedConfiguration: Record<string, unknown>): ExpoFacts | null {
  const decodedWrapper = decodeExpoWrapper(resolvedConfiguration);

  if (decodedWrapper == null) {
    return null;
  }

  if (decodedWrapper.expo == null) {
    return null;
  }

  return decodedWrapper.expo;
}

/** Read Expo/EAS project facts from either a wrapped or bare app config document. */
export function expoFactsFromResolvedConfig(
  resolvedConfiguration: Record<string, unknown>,
): ExpoFacts | null {
  const wrappedFacts = wrappedExpoFacts(resolvedConfiguration);

  if (wrappedFacts != null) {
    return wrappedFacts;
  }

  return decodeExpoFacts(resolvedConfiguration);
}

/** Human-readable runtimeVersion label for info notes. */
export function describeRuntimeVersion(runtimeVersion: RuntimeVersion): string | undefined {
  if (typeof runtimeVersion == 'string') {
    return runtimeVersion;
  }

  if (runtimeVersion.policy != null) {
    return `policy "${runtimeVersion.policy}"`;
  }

  return undefined;
}

function projectIdFromExpoFacts(expoFacts: ExpoFacts): string | undefined {
  const extraBlock = expoFacts.extra;

  if (extraBlock == null) {
    return undefined;
  }

  const easBlock = extraBlock.eas;

  if (easBlock == null) {
    return undefined;
  }

  return easBlock.projectId;
}

/** Info notes from Expo app.json facts (project id, owner, runtimeVersion, updates). */
export function notesFromExpoFacts(appName: string, expoFacts: ExpoFacts): MigrationNote[] {
  const migrationNotes: MigrationNote[] = [];
  const projectId = projectIdFromExpoFacts(expoFacts);

  if (projectId != null) {
    migrationNotes.push({
      level: 'info',
      message: `"${appName}" is EAS project ${projectId} (app.json extra.eas.projectId) - Launch doesn't use an EAS project id; drop it once you've cut over.`,
    });
  }

  if (expoFacts.owner != null) {
    migrationNotes.push({
      level: 'info',
      message: `"${appName}" is owned by the Expo account "${expoFacts.owner}" - Launch publishes under your Apple/Play accounts, not an Expo owner.`,
    });
  }

  if (expoFacts.runtimeVersion != null) {
    const runtimeVersionLabel = describeRuntimeVersion(expoFacts.runtimeVersion);

    if (runtimeVersionLabel != null) {
      migrationNotes.push({
        level: 'info',
        message: `"${appName}" set runtimeVersion ${runtimeVersionLabel} - relevant only for EAS Update; Launch ships store builds (see \`launch explain ota-update\`).`,
      });
    }
  }

  const hasUpdates = typeof expoFacts.updates != 'undefined';

  if (hasUpdates) {
    migrationNotes.push({
      level: 'info',
      message: `"${appName}" configures expo.updates (EAS Update) - Launch ships store builds and doesn't run OTA by default (see \`launch explain ota-update\`).`,
    });
  }

  return migrationNotes;
}

async function notesFromAppExpoFacts(apps: AppDescriptor[]): Promise<MigrationNote[]> {
  const migrationNotes: MigrationNote[] = [];

  for (const app of apps) {
    const resolvedConfiguration = await readResolvedConfig(app.dir);

    if (resolvedConfiguration == null) {
      continue;
    }

    const expoFacts = expoFactsFromResolvedConfig(resolvedConfiguration);

    if (expoFacts == null) {
      continue;
    }

    migrationNotes.push(...notesFromExpoFacts(app.name, expoFacts));
  }

  return migrationNotes;
}

/** Read an EAS project and return the Launch artifacts and follow-up notes without writing them. */
export async function migrateEas(
  workingDirectory: string,
  apps: AppDescriptor[],
): Promise<MigrationResult> {
  const easPath = join(workingDirectory, 'eas.json');
  const easExists = await pathExists(easPath);

  if (easExists == false) {
    throw makeEasMigrationFailure({ reason: 'MissingEasConfig', sourcePath: easPath });
  }

  let easJsonSource = '';

  try {
    easJsonSource = await readFile(easPath, 'utf8');
  } catch (cause) {
    throw makeEasMigrationFailure({ reason: 'InvalidEasJson', sourcePath: easPath, cause });
  }

  const easConfiguration = parseEasJson(easJsonSource);
  const profileSection = serializeProfilesSection(launchProfilesFromEas(easConfiguration));
  const appRoot = detectAppRoot(apps, workingDirectory);
  const migrationArtifacts: MigrationArtifact[] = [
    {
      path: 'launch.config.ts',
      contents: configTemplate(appRoot, undefined, profileSection),
    },
    {
      path: '.env.example',
      contents: buildEnvExample(collectEnvironmentKeys(easConfiguration)),
    },
    ...profileEnvironmentArtifactsFromEas(easConfiguration),
  ];
  const migrationNotes = notesFromEasConfiguration(easConfiguration, apps);
  const credentialsSummary = await readCredentialsSummary(workingDirectory);

  if (credentialsSummary != null) {
    migrationNotes.push(...notesFromCredentialsSummary(credentialsSummary));
  }

  const expoNotes = await notesFromAppExpoFacts(apps);
  migrationNotes.push(...expoNotes);
  const storeScaffold = await scaffoldStoreConfig(workingDirectory);

  if (storeScaffold.artifact != null) {
    migrationArtifacts.push(storeScaffold.artifact);
  }

  migrationNotes.push(storeScaffold.note);

  return { source: 'eas', artifacts: migrationArtifacts, notes: migrationNotes };
}
