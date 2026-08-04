import { FileSystem, Path } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Data, Effect, Option, Schema } from 'effect';
import { readResolvedConfig } from '../config/config.js';
import { configTemplate, detectAppRoot } from '../config/configScaffold.js';
import type { AppDescriptor, BuildProfile, PlayTrack } from '../types/app.js';
import type {
  CredentialsSummary,
  EasBuildProfile,
  EasJson,
  EasSubmitProfile,
  MigrationArtifact,
  MigrationNote,
  MigrationResult,
} from '../types/migrate.js';
import { buildEnvExample, scaffoldStoreConfig } from './scaffold.js';
import type { MutableDeep } from '../types/mutable.js';

export type EasMigrationFailure = Readonly<{
  readonly _tag: 'EasMigrationFailure';
  readonly reason: 'InvalidEasJson' | 'MissingEasConfig';
  readonly sourcePath?: string;
  readonly cause?: unknown;
}>;

export const makeEasMigrationFailure = Data.tagged<EasMigrationFailure>('EasMigrationFailure');

const StringEntriesSchema = Schema.transform(
  Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.String })),
  {
    strict: true,
    decode: (unknownEntries) => {
      const stringEntries: Record<string, string> = {};
      for (const [entryName, unknownEntry] of Object.entries(unknownEntries)) {
        if (typeof unknownEntry === 'string') stringEntries[entryName] = unknownEntry;
      }
      return stringEntries;
    },
    encode: (stringEntries) => stringEntries,
  },
);

const EasBuildProfileSchema = Schema.mutable(
  Schema.Struct({
    channel: Schema.optionalWith(Schema.String, { exact: true }),
    distribution: Schema.optionalWith(Schema.String, { exact: true }),
    env: Schema.optionalWith(StringEntriesSchema, { exact: true }),
    autoIncrement: Schema.optionalWith(Schema.Union(Schema.Boolean, Schema.String), {
      exact: true,
    }),
    developmentClient: Schema.optionalWith(Schema.Boolean, { exact: true }),
  }),
);

const EasBuildProfilesSchema = Schema.transform(
  Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  Schema.mutable(Schema.Record({ key: Schema.String, value: EasBuildProfileSchema })),
  {
    strict: true,
    decode: (unknownProfiles) => {
      const buildProfiles: Record<string, EasBuildProfile> = {};
      for (const [profileName, unknownProfile] of Object.entries(unknownProfiles)) {
        const decodedProfile = Schema.decodeUnknownOption(EasBuildProfileSchema)(unknownProfile);
        if (Option.isSome(decodedProfile)) buildProfiles[profileName] = decodedProfile.value;
      }
      return buildProfiles;
    },
    encode: (buildProfiles) => buildProfiles,
  },
);

const EasSubmitIosSchema = Schema.mutable(
  Schema.Struct({
    appleId: Schema.optionalWith(Schema.String, { exact: true }),
    ascAppId: Schema.optionalWith(Schema.String, { exact: true }),
    appleTeamId: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const EasSubmitAndroidSchema = Schema.mutable(
  Schema.Struct({
    serviceAccountKeyPath: Schema.optionalWith(Schema.String, { exact: true }),
    track: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const EasSubmitProfileSchema = Schema.mutable(
  Schema.Struct({
    ios: Schema.optionalWith(EasSubmitIosSchema, { exact: true }),
    android: Schema.optionalWith(EasSubmitAndroidSchema, { exact: true }),
  }),
);

const hasIosSubmitFields = (
  iosSubmission: Schema.Schema.Type<typeof EasSubmitIosSchema>,
): boolean => {
  if (iosSubmission.appleId !== undefined) return true;
  if (iosSubmission.ascAppId !== undefined) return true;
  return iosSubmission.appleTeamId !== undefined;
};

const hasAndroidSubmitFields = (
  androidSubmission: Schema.Schema.Type<typeof EasSubmitAndroidSchema>,
): boolean => {
  if (androidSubmission.serviceAccountKeyPath !== undefined) return true;
  return androidSubmission.track !== undefined;
};

const EasSubmitProfilesSchema = Schema.transform(
  Schema.mutable(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  Schema.mutable(Schema.Record({ key: Schema.String, value: EasSubmitProfileSchema })),
  {
    strict: true,
    decode: (unknownProfiles) => {
      const submitProfiles: Record<string, EasSubmitProfile> = {};
      for (const [profileName, unknownProfile] of Object.entries(unknownProfiles)) {
        const decodedProfile = Schema.decodeUnknownOption(EasSubmitProfileSchema)(unknownProfile);
        if (Option.isNone(decodedProfile)) continue;
        const submitProfile: MutableDeep<EasSubmitProfile> = {};
        const iosSubmission = decodedProfile.value.ios;
        if (iosSubmission !== undefined && hasIosSubmitFields(iosSubmission)) {
          submitProfile.ios = iosSubmission;
        }
        const androidSubmission = decodedProfile.value.android;
        if (androidSubmission !== undefined && hasAndroidSubmitFields(androidSubmission)) {
          submitProfile.android = androidSubmission;
        }
        submitProfiles[profileName] = submitProfile;
      }
      return submitProfiles;
    },
    encode: (submitProfiles) => submitProfiles,
  },
);

const EasCliSchema = Schema.mutable(
  Schema.Struct({
    appVersionSource: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);

const EasJsonSchema = Schema.mutable(
  Schema.Struct({
    cli: Schema.optionalWith(EasCliSchema, { exact: true }),
    build: Schema.optionalWith(EasBuildProfilesSchema, { default: () => ({}) }),
    submit: Schema.optionalWith(EasSubmitProfilesSchema, { default: () => ({}) }),
  }),
);

/** Decode the EAS fields that Launch migrates and discard unsupported fields at the boundary. */
export const parseEasJson = (easJsonSource: string): Effect.Effect<EasJson, EasMigrationFailure> =>
  Schema.decodeUnknown(Schema.parseJson(EasJsonSchema))(easJsonSource).pipe(
    Effect.mapError((cause) => makeEasMigrationFailure({ reason: 'InvalidEasJson', cause })),
  );

const PLAY_TRACKS: readonly PlayTrack[] = ['internal', 'closed', 'open', 'production'];

const isPlayTrack = (trackName: string): trackName is PlayTrack =>
  PLAY_TRACKS.some((playTrack) => playTrack === trackName);

const mapProfiles = (easConfiguration: EasJson): Record<string, BuildProfile> => {
  const launchProfiles: Record<string, BuildProfile> = {};
  for (const profileName of Object.keys(easConfiguration.build)) {
    const launchProfile: MutableDeep<BuildProfile> = { name: profileName, sizeBudgetMB: 200 };
    const submitProfile = easConfiguration.submit[profileName];
    const androidSubmission = submitProfile?.android;
    const trackName = androidSubmission?.track;
    if (trackName !== undefined && isPlayTrack(trackName)) launchProfile.track = trackName;
    launchProfiles[profileName] = launchProfile;
  }
  if (Object.keys(launchProfiles).length === 0) {
    launchProfiles['production'] = { name: 'production', sizeBudgetMB: 200 };
  }
  return launchProfiles;
};

const serializeProfilesSection = (launchProfiles: Record<string, BuildProfile>): string => {
  const profileLines = JSON.stringify(launchProfiles, null, 2).split('\n');
  const indentedLines: string[] = [];
  for (const [lineIndex, profileLine] of profileLines.entries()) {
    if (lineIndex === 0) indentedLines.push(profileLine);
    else indentedLines.push(`  ${profileLine}`);
  }
  return [
    '  // Imported from eas.json by `launch migrate eas` - review, then commit.',
    `  profiles: ${indentedLines.join('\n')},`,
  ].join('\n');
};

const collectEnvironmentKeys = (easConfiguration: EasJson): string[] => {
  const environmentKeys = new Set<string>();
  for (const buildProfile of Object.values(easConfiguration.build)) {
    if (buildProfile.env === undefined) continue;
    for (const environmentKey of Object.keys(buildProfile.env)) {
      environmentKeys.add(environmentKey);
    }
  }
  return [...environmentKeys].sort();
};

const makeProfileEnvironmentArtifacts = (easConfiguration: EasJson): MigrationArtifact[] => {
  const environmentArtifacts: MigrationArtifact[] = [];
  for (const [profileName, buildProfile] of Object.entries(easConfiguration.build)) {
    if (buildProfile.env === undefined) continue;
    environmentArtifacts.push({
      path: `.env.${profileName}`,
      contents: buildEnvExample(Object.keys(buildProfile.env).sort()),
    });
  }
  return environmentArtifacts;
};

const buildMigrationNotes = (
  easConfiguration: EasJson,
  apps: readonly AppDescriptor[],
): MigrationNote[] => {
  const migrationNotes: MigrationNote[] = [];
  for (const [profileName, buildProfile] of Object.entries(easConfiguration.build)) {
    migrationNotes.push({
      level: 'mapped',
      message: `Build profile "${profileName}" -> Launch profile "${profileName}".`,
    });
    if (buildProfile.env !== undefined) {
      migrationNotes.push({
        level: 'mapped',
        message: `Profile "${profileName}" env keys -> .env.${profileName} (values left blank - fill them in; they may be secrets).`,
      });
    }
    if (buildProfile.channel !== undefined) {
      migrationNotes.push({
        level: 'manual',
        message: `Profile "${profileName}" published to EAS Update channel "${buildProfile.channel}" - set up OTA with \`launch update --channel ${buildProfile.channel}\` (see \`launch explain ota-update\`).`,
      });
    }
    if (buildProfile.distribution === 'internal') {
      migrationNotes.push({
        level: 'manual',
        message: `Profile "${profileName}" used internal (ad-hoc) distribution - register tester devices with \`launch device add\` (see \`launch explain ad-hoc-distribution\`).`,
      });
    }
    if (buildProfile.developmentClient === true) {
      migrationNotes.push({
        level: 'manual',
        message: `Profile "${profileName}" built a development client - that's a dev tool, not a store build; Launch ships store and TestFlight builds.`,
      });
    }
  }
  for (const [profileName, submitProfile] of Object.entries(easConfiguration.submit)) {
    if (submitProfile.ios !== undefined) {
      migrationNotes.push({
        level: 'manual',
        message: `Submit profile "${profileName}" carried Apple account details (appleId/ascAppId/appleTeamId) - configure your Apple API key with \`launch creds set-key\`.`,
      });
    }
    if (submitProfile.android?.serviceAccountKeyPath !== undefined) {
      migrationNotes.push({
        level: 'manual',
        message: `Submit profile "${profileName}" referenced a Play service account key (${submitProfile.android.serviceAccountKeyPath}) - configure it with \`launch creds\`.`,
      });
    }
    const trackName = submitProfile.android?.track;
    if (trackName !== undefined && !isPlayTrack(trackName)) {
      migrationNotes.push({
        level: 'manual',
        message: `Submit profile "${profileName}" had an unrecognized Play track "${trackName}" - set a valid track (internal/closed/open/production) on the profile.`,
      });
    }
  }
  if (easConfiguration.cli?.appVersionSource === 'remote') {
    migrationNotes.push({
      level: 'mapped',
      message:
        '`cli.appVersionSource: remote` -> Launch already bumps build numbers from the store, matching remote.',
    });
  }
  migrationNotes.push({
    level: 'manual',
    message:
      'EAS built in the cloud; Launch builds locally by default (`buildEngine: "fastlane"`). No Mac? Set `buildEngine: "eas"` or run `launch build --remote` (see `launch explain eas-handoff`).',
  });
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

const CredentialsDocumentSchema = Schema.mutable(
  Schema.Struct({
    ios: Schema.optionalWith(
      Schema.mutable(
        Schema.Struct({
          provisioningProfilePath: Schema.optionalWith(Schema.String, { exact: true }),
          distributionCertificate: Schema.optionalWith(
            Schema.mutable(
              Schema.Struct({
                path: Schema.optionalWith(Schema.String, { exact: true }),
              }),
            ),
            { exact: true },
          ),
        }),
      ),
      { exact: true },
    ),
    android: Schema.optionalWith(
      Schema.mutable(
        Schema.Struct({
          keystore: Schema.optionalWith(
            Schema.mutable(
              Schema.Struct({
                keystorePath: Schema.optionalWith(Schema.String, { exact: true }),
                keyAlias: Schema.optionalWith(Schema.String, { exact: true }),
              }),
            ),
            { exact: true },
          ),
        }),
      ),
      { exact: true },
    ),
  }),
);

const summarizeCredentialsDocument = (
  credentialsDocument: Schema.Schema.Type<typeof CredentialsDocumentSchema>,
): CredentialsSummary | null => {
  const credentialsSummary: MutableDeep<CredentialsSummary> = {};
  const iosCredentials = credentialsDocument.ios;
  if (iosCredentials !== undefined) {
    const distributionCertificatePath = iosCredentials.distributionCertificate?.path;
    const provisioningProfilePath = iosCredentials.provisioningProfilePath;
    let hasIosSigningPath = distributionCertificatePath !== undefined;
    if (provisioningProfilePath !== undefined) hasIosSigningPath = true;
    if (hasIosSigningPath) {
      credentialsSummary.ios = {};
      if (distributionCertificatePath !== undefined) {
        credentialsSummary.ios.distributionCertificatePath = distributionCertificatePath;
      }
      if (provisioningProfilePath !== undefined) {
        credentialsSummary.ios.provisioningProfilePath = provisioningProfilePath;
      }
    }
  }
  const androidKeystore = credentialsDocument.android?.keystore;
  if (androidKeystore !== undefined) {
    let hasAndroidKeystoreField = androidKeystore.keystorePath !== undefined;
    if (androidKeystore.keyAlias !== undefined) hasAndroidKeystoreField = true;
    if (hasAndroidKeystoreField) {
      credentialsSummary.android = {};
      if (androidKeystore.keystorePath !== undefined) {
        credentialsSummary.android.keystorePath = androidKeystore.keystorePath;
      }
      if (androidKeystore.keyAlias !== undefined) {
        credentialsSummary.android.keyAlias = androidKeystore.keyAlias;
      }
    }
  }
  if (credentialsSummary.ios !== undefined) return credentialsSummary;
  if (credentialsSummary.android !== undefined) return credentialsSummary;
  return null;
};

const readCredentialsSummary = (
  workingDirectory: string,
): Effect.Effect<CredentialsSummary | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const credentialsPath = pathService.join(workingDirectory, 'credentials.json');
    if (!(yield* fileSystem.exists(credentialsPath))) return null;
    const credentialsSource = yield* fileSystem.readFileString(credentialsPath).pipe(Effect.option);
    if (Option.isNone(credentialsSource)) return null;
    const credentialsDocument = yield* Schema.decodeUnknown(
      Schema.parseJson(CredentialsDocumentSchema),
    )(credentialsSource.value).pipe(Effect.option);
    if (Option.isNone(credentialsDocument)) return null;
    return summarizeCredentialsDocument(credentialsDocument.value);
  });

const makeCredentialsNotes = (credentialsSummary: CredentialsSummary): MigrationNote[] => {
  const migrationNotes: MigrationNote[] = [];
  if (credentialsSummary.ios !== undefined) {
    let certificateLocation = 'your distribution certificate';
    if (credentialsSummary.ios.distributionCertificatePath !== undefined) {
      certificateLocation = credentialsSummary.ios.distributionCertificatePath;
    }
    migrationNotes.push({
      level: 'manual',
      message: `Local iOS signing material in credentials.json (${certificateLocation}) - import it with \`launch creds\`; Launch keeps certs in the OS keychain and never reads the password from credentials.json.`,
    });
  }
  if (credentialsSummary.android !== undefined) {
    let keystoreLocation = 'your release keystore';
    if (credentialsSummary.android.keystorePath !== undefined) {
      keystoreLocation = credentialsSummary.android.keystorePath;
    }
    let keyAliasLabel = '';
    if (credentialsSummary.android.keyAlias !== undefined) {
      keyAliasLabel = `, key alias "${credentialsSummary.android.keyAlias}"`;
    }
    migrationNotes.push({
      level: 'manual',
      message: `Local Android keystore in credentials.json (${keystoreLocation}${keyAliasLabel}) - register it with \`launch creds\`; the keystore/key passwords are never read from credentials.json.`,
    });
  }
  return migrationNotes;
};

const RuntimeVersionSchema = Schema.Union(
  Schema.String,
  Schema.mutable(
    Schema.Struct({
      policy: Schema.optionalWith(Schema.String, { exact: true }),
    }),
  ),
);

const ExpoFactsSchema = Schema.mutable(
  Schema.Struct({
    owner: Schema.optionalWith(Schema.String, { exact: true }),
    runtimeVersion: Schema.optionalWith(RuntimeVersionSchema, { exact: true }),
    updates: Schema.optionalWith(Schema.Unknown, { exact: true }),
    extra: Schema.optionalWith(
      Schema.mutable(
        Schema.Struct({
          eas: Schema.optionalWith(
            Schema.mutable(
              Schema.Struct({
                projectId: Schema.optionalWith(Schema.String, { exact: true }),
              }),
            ),
            { exact: true },
          ),
        }),
      ),
      { exact: true },
    ),
  }),
);

const ExpoWrapperSchema = Schema.mutable(
  Schema.Struct({
    expo: Schema.optionalWith(ExpoFactsSchema, { exact: true }),
  }),
);

const decodeExpoFacts = (resolvedConfiguration: Record<string, unknown>) => {
  const decodedWrapper = Schema.decodeUnknownOption(ExpoWrapperSchema)(resolvedConfiguration);
  if (Option.isSome(decodedWrapper) && decodedWrapper.value.expo !== undefined) {
    return decodedWrapper.value.expo;
  }
  return Option.getOrNull(Schema.decodeUnknownOption(ExpoFactsSchema)(resolvedConfiguration));
};

const describeRuntimeVersion = (
  runtimeVersion: Schema.Schema.Type<typeof RuntimeVersionSchema>,
): string | undefined => {
  if (typeof runtimeVersion === 'string') return runtimeVersion;
  if (runtimeVersion.policy !== undefined) return `policy "${runtimeVersion.policy}"`;
  return undefined;
};

const buildAppFactNotes = (apps: readonly AppDescriptor[]) =>
  Effect.gen(function* () {
    const migrationNotes: MigrationNote[] = [];
    for (const app of apps) {
      const resolvedConfiguration = yield* readResolvedConfig(app.dir);
      if (resolvedConfiguration === null) continue;
      const expoFacts = decodeExpoFacts(resolvedConfiguration);
      if (expoFacts === null) continue;
      const projectId = expoFacts.extra?.eas?.projectId;
      if (projectId !== undefined) {
        migrationNotes.push({
          level: 'info',
          message: `"${app.name}" is EAS project ${projectId} (app.json extra.eas.projectId) - Launch doesn't use an EAS project id; drop it once you've cut over.`,
        });
      }
      if (expoFacts.owner !== undefined) {
        migrationNotes.push({
          level: 'info',
          message: `"${app.name}" is owned by the Expo account "${expoFacts.owner}" - Launch publishes under your Apple/Play accounts, not an Expo owner.`,
        });
      }
      if (expoFacts.runtimeVersion !== undefined) {
        const runtimeVersionLabel = describeRuntimeVersion(expoFacts.runtimeVersion);
        if (runtimeVersionLabel !== undefined) {
          migrationNotes.push({
            level: 'info',
            message: `"${app.name}" set runtimeVersion ${runtimeVersionLabel} - relevant only for EAS Update; Launch ships store builds (see \`launch explain ota-update\`).`,
          });
        }
      }
      if (expoFacts.updates !== undefined) {
        migrationNotes.push({
          level: 'info',
          message: `"${app.name}" configures expo.updates (EAS Update) - Launch ships store builds and doesn't run OTA by default (see \`launch explain ota-update\`).`,
        });
      }
    }
    return migrationNotes;
  });

/** Read an EAS project and return the Launch artifacts and follow-up notes without writing them. */
export const migrateEas = (
  workingDirectory: string,
  apps: readonly AppDescriptor[],
): Effect.Effect<
  MigrationResult,
  EasMigrationFailure | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const easPath = pathService.join(workingDirectory, 'eas.json');
    if (!(yield* fileSystem.exists(easPath))) {
      return yield* Effect.fail(
        makeEasMigrationFailure({ reason: 'MissingEasConfig', sourcePath: easPath }),
      );
    }
    const easJsonSource = yield* fileSystem
      .readFileString(easPath)
      .pipe(
        Effect.mapError((cause) =>
          makeEasMigrationFailure({ reason: 'InvalidEasJson', sourcePath: easPath, cause }),
        ),
      );
    const easConfiguration = yield* parseEasJson(easJsonSource);
    const profileSection = serializeProfilesSection(mapProfiles(easConfiguration));
    const migrationArtifacts: MigrationArtifact[] = [
      {
        path: 'launch.config.ts',
        contents: configTemplate(
          yield* detectAppRoot(apps, workingDirectory),
          undefined,
          profileSection,
        ),
      },
      {
        path: '.env.example',
        contents: buildEnvExample(collectEnvironmentKeys(easConfiguration)),
      },
      ...makeProfileEnvironmentArtifacts(easConfiguration),
    ];
    const migrationNotes = buildMigrationNotes(easConfiguration, apps);
    const credentialsSummary = yield* readCredentialsSummary(workingDirectory);
    if (credentialsSummary !== null) {
      migrationNotes.push(...makeCredentialsNotes(credentialsSummary));
    }
    migrationNotes.push(...(yield* buildAppFactNotes(apps)));
    const storeScaffold = yield* scaffoldStoreConfig(workingDirectory);
    if (storeScaffold.artifact !== null) migrationArtifacts.push(storeScaffold.artifact);
    migrationNotes.push(storeScaffold.note);
    return { source: 'eas', artifacts: migrationArtifacts, notes: migrationNotes };
  });
