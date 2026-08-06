import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect, Schema } from 'effect';
import { loadConfig, type LoadedConfig } from '../config/config.js';
import { getActiveKeyId, listAccounts } from '../credentials/accounts.js';
import { loadCachedKeystore } from '../credentials/androidKeystore.js';
import { loadCachedSigningAssets } from '../credentials/appleSigning.js';
import {
  resolveStorageProvider,
  type StorageResolverRequirements,
} from '../distribution/storage.js';
import { errorMessage } from '../services/errorMessage.js';
import { captureCommandOutput, executeCommand } from '../services/exec.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { isApplePlatform, platformLabel } from '../services/platform.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import type { BuildArtifact } from '../types/artifacts.js';
import type { KeystoreAssets, SigningAssets } from '../types/credentials.js';
import type { StorageProvider } from '../types/providers.js';
import { findBuild } from './buildHistoryCommand.js';

const STORE_PASSWORD_VARIABLE = 'LAUNCH_KS_STOREPASS';
const KEY_PASSWORD_VARIABLE = 'LAUNCH_KS_KEYPASS';

export const ResignCommandInputSchema = Schema.Struct({
  id: Schema.optionalWith(Schema.String, { exact: true }),
  app: Schema.optionalWith(Schema.String, { exact: true }),
  account: Schema.optionalWith(Schema.String, { exact: true }),
  output: Schema.optionalWith(Schema.String, { exact: true }),
  dryRun: Schema.Boolean,
});

export type ResignCommandInput = Schema.Schema.Type<typeof ResignCommandInputSchema>;

export type ResignCommandFailure = Readonly<{
  readonly _tag: 'ResignCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeResignCommandFailure = Data.tagged<ResignCommandFailure>('ResignCommandFailure');

export type AndroidResignSpec = Readonly<{
  readonly command: string;
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}>;

/** Config, apps, and storage for one `build:resign` run. */
type ResignWorkspace = Readonly<{
  readonly workingDirectory: string;
  readonly apps: readonly AppDescriptor[];
  readonly storageProvider: StorageProvider;
}>;

type ResignCommandRequirements =
  | CommandExecutor
  | FileSystem.FileSystem
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | StorageResolverRequirements;

/** Whether a failure already belongs to this command family's public channel. */
const isResignCommandFailure = (cause: unknown): cause is ResignCommandFailure => {
  if (typeof cause !== 'object') return false;
  if (cause === null) return false;
  if (!('_tag' in cause)) return false;
  return cause._tag === 'ResignCommandFailure';
};

/** Map an underlying cause into the resign command error channel. */
const resignFailure = (operation: string, cause: unknown): ResignCommandFailure =>
  makeResignCommandFailure({ operation, message: errorMessage(cause), cause });

/** Reject the macOS package format that this re-signing flow cannot rewrite. */
export const assertResignablePlatform = (
  platform: Platform,
): Effect.Effect<void, ResignCommandFailure> => {
  if (platform !== 'macos') return Effect.void;
  return Effect.fail(
    makeResignCommandFailure({
      operation: 'validate resign platform',
      message: `${platformLabel(platform)} builds are .pkg installers; build:resign supports Apple .ipa and Android .aab/.apk artifacts.`,
    }),
  );
};

/** Name a re-signed artifact from the source build's natural identifiers. */
export const resignOutputPath = (
  artifact: BuildArtifact,
  outputDirectory: string,
  extensionName: string,
): string =>
  `${outputDirectory}/${artifact.appName}-${artifact.version}-${artifact.buildNumber}-resigned${extensionName}`;

/** Choose the stored-build reference, defaulting to the most recent entry. */
export const storedArtifactReference = (commandInput: ResignCommandInput): string => {
  if (commandInput.id !== undefined) return commandInput.id;
  return 'latest';
};

/** Narrow stored artifacts to one app handle when the operator asked for a scope. */
export const filterStoredArtifactsByApp = (
  artifacts: readonly BuildArtifact[],
  appName: string | undefined,
): BuildArtifact[] => {
  if (appName === undefined) return [...artifacts];
  return artifacts.filter((storedArtifact) => storedArtifact.appName === appName);
};

/** Build arguments for unpacking an IPA. */
export const unzipArgs = (ipaPath: string, destination: string): string[] => [
  '-oq',
  ipaPath,
  '-d',
  destination,
];

/** Build arguments for repackaging an IPA from its working directory. */
export const zipArgs = (outputIpa: string): string[] => ['-qr', outputIpa, 'Payload'];

/** Build arguments for decoding an Apple provisioning profile. */
export const securityCmsArgs = (profilePath: string): string[] => ['cms', '-D', '-i', profilePath];

/** Build arguments for extracting entitlements from a decoded profile. */
export const plistBuddyEntitlementsArgs = (profilePlistPath: string): string[] => [
  '-x',
  '-c',
  'Print :Entitlements',
  profilePlistPath,
];

/** Build arguments for re-signing one Apple application bundle. */
export const iosCodesignArgs = (
  appBundlePath: string,
  identity: string,
  entitlementsPath: string,
): string[] => ['-f', '-s', identity, '--entitlements', entitlementsPath, appBundlePath];

/** Describe the Android signing tool invocation without placing passwords in argv. */
export const androidResignSpec = (
  artifactPath: string,
  keystore: KeystoreAssets,
): AndroidResignSpec => {
  const environment: Record<string, string> = {
    [STORE_PASSWORD_VARIABLE]: keystore.storePassword,
    [KEY_PASSWORD_VARIABLE]: keystore.keyPassword,
  };
  if (artifactPath.endsWith('.apk')) {
    return {
      command: 'apksigner',
      arguments: [
        'sign',
        '--ks',
        keystore.path,
        '--ks-pass',
        `env:${STORE_PASSWORD_VARIABLE}`,
        '--ks-key-alias',
        keystore.alias,
        '--key-pass',
        `env:${KEY_PASSWORD_VARIABLE}`,
        artifactPath,
      ],
      environment,
    };
  }
  return {
    command: 'jarsigner',
    arguments: [
      '-keystore',
      keystore.path,
      '-storepass:env',
      STORE_PASSWORD_VARIABLE,
      '-keypass:env',
      KEY_PASSWORD_VARIABLE,
      '-sigalg',
      'SHA256withRSA',
      '-digestalg',
      'SHA-256',
      artifactPath,
      keystore.alias,
    ],
    environment,
  };
};

/** Load config, discovered apps, and the storage provider once per resign run. */
const loadResignWorkspace = (): Effect.Effect<
  ResignWorkspace,
  unknown,
  ResignCommandRequirements
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfig: LoadedConfig = yield* loadConfig(launchPaths.workingDirectory);
    const storageProvider = yield* resolveStorageProvider(
      loadedConfig.config,
      launchPaths.workingDirectory,
    );
    return {
      workingDirectory: launchPaths.workingDirectory,
      apps: loadedConfig.apps,
      storageProvider,
    };
  });

/** Select an Apple account by label or Key ID, falling back to the active account. */
const selectAccountKeyId = (
  selector: string | undefined,
): Effect.Effect<string, ResignCommandFailure, ResignCommandRequirements> =>
  Effect.gen(function* () {
    if (selector === undefined) {
      const activeKeyId = yield* getActiveKeyId();
      if (activeKeyId !== null) return activeKeyId;
      return yield* Effect.fail(
        makeResignCommandFailure({
          operation: 'select Apple account',
          message: 'No active Apple account. Run `launch creds set-key` or pass --account.',
        }),
      );
    }
    const accounts = yield* listAccounts();
    const matchedAccount = accounts.find((account) => {
      if (account.keyId === selector) return true;
      return account.label === selector;
    });
    if (matchedAccount !== undefined) return matchedAccount.keyId;
    return yield* Effect.fail(
      makeResignCommandFailure({
        operation: 'select Apple account',
        message: `No Apple account matching "${selector}".`,
      }),
    );
  });

/** Re-sign one IPA by replacing its profile, extracting entitlements, and repackaging it. */
const resignAppleArtifact = (
  artifact: BuildArtifact,
  signingAssets: SigningAssets,
  outputPath: string,
): Effect.Effect<void, unknown, ResignCommandRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const temporaryDirectory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: 'launch-resign-',
    });
    yield* executeCommand('unzip', unzipArgs(artifact.path, temporaryDirectory));
    const applicationDirectory = pathService.join(temporaryDirectory, 'Payload');
    const applicationNames = yield* fileSystem.readDirectory(applicationDirectory);
    const applicationName = applicationNames.find((entryName) => entryName.endsWith('.app'));
    if (applicationName === undefined) {
      return yield* Effect.fail(
        makeResignCommandFailure({
          operation: 'unpack Apple artifact',
          message: `No .app exists inside ${artifact.path}.`,
        }),
      );
    }
    const applicationPath = pathService.join(applicationDirectory, applicationName);
    yield* fileSystem.copyFile(
      signingAssets.profilePath,
      pathService.join(applicationPath, 'embedded.mobileprovision'),
    );
    const profilePlistPath = pathService.join(temporaryDirectory, 'profile.plist');
    const profilePlist = yield* captureCommandOutput(
      'security',
      securityCmsArgs(signingAssets.profilePath),
    );
    yield* fileSystem.writeFileString(profilePlistPath, profilePlist);
    const entitlementsPath = pathService.join(temporaryDirectory, 'entitlements.plist');
    const entitlements = yield* captureCommandOutput(
      '/usr/libexec/PlistBuddy',
      plistBuddyEntitlementsArgs(profilePlistPath),
    );
    yield* fileSystem.writeFileString(entitlementsPath, entitlements);
    yield* executeCommand(
      'codesign',
      iosCodesignArgs(applicationPath, signingAssets.certName, entitlementsPath),
    );
    if (yield* fileSystem.exists(outputPath)) yield* fileSystem.remove(outputPath);
    yield* executeCommand('zip', zipArgs(outputPath), { workingDirectory: temporaryDirectory });
  }).pipe(Effect.scoped);

/** Copy and re-sign one Android artifact with the cached upload key. */
const resignAndroidArtifact = (
  artifact: BuildArtifact,
  keystore: KeystoreAssets,
  outputPath: string,
): Effect.Effect<void, unknown, ResignCommandRequirements> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.copyFile(artifact.path, outputPath);
    const resignSpec = androidResignSpec(outputPath, keystore);
    const environmentOverrides: Record<string, string> = {
      [STORE_PASSWORD_VARIABLE]: keystore.storePassword,
      [KEY_PASSWORD_VARIABLE]: keystore.keyPassword,
    };
    yield* executeCommand(resignSpec.command, resignSpec.arguments, {
      environmentOverrides,
    });
  });

/** Print an Apple re-sign plan without touching the artifact. */
const printApplePlan = (
  artifact: BuildArtifact,
  signingAssets: SigningAssets,
  outputPath: string,
): Effect.Effect<void, unknown, Logger | Path.Path> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const pathService = yield* Path.Path;
    yield* logger.line(`Would re-sign ${pathService.basename(artifact.path)} with Apple signing:`);
    yield* logger.line(`  identity: ${signingAssets.certName} (team ${signingAssets.teamId})`);
    yield* logger.line(`  profile: ${signingAssets.profileName}`);
    yield* logger.line(`  output: ${outputPath}`);
  });

/** Print an Android re-sign plan without touching the artifact. */
const printAndroidPlan = (
  artifact: BuildArtifact,
  keystore: KeystoreAssets,
  outputPath: string,
): Effect.Effect<void, unknown, Logger | Path.Path> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const pathService = yield* Path.Path;
    const resignSpec = androidResignSpec(outputPath, keystore);
    yield* logger.line(
      `Would re-sign ${pathService.basename(artifact.path)} with Android signing:`,
    );
    yield* logger.line(`  keystore: ${keystore.path} (alias ${keystore.alias})`);
    yield* logger.line(`  tool: ${resignSpec.command} (passwords supplied through environment)`);
    yield* logger.line(`  output: ${outputPath}`);
  });

/** Find the requested stored build inside an optional application scope. */
const selectStoredArtifact = (
  commandInput: ResignCommandInput,
  workspace: ResignWorkspace,
): Effect.Effect<BuildArtifact, unknown, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const scopedHistory = filterStoredArtifactsByApp(
      yield* workspace.storageProvider.list(),
      commandInput.app,
    );
    const reference = storedArtifactReference(commandInput);
    const artifact = findBuild(scopedHistory, reference);
    if (artifact === undefined) {
      return yield* Effect.fail(
        makeResignCommandFailure({
          operation: 'select stored artifact',
          message: `No stored build matches "${reference}".`,
        }),
      );
    }
    const fileSystem = yield* FileSystem.FileSystem;
    if (yield* fileSystem.exists(artifact.path)) return artifact;
    return yield* Effect.fail(
      makeResignCommandFailure({
        operation: 'select stored artifact',
        message: `The artifact for ${artifact.appName} is gone from ${artifact.path}.`,
      }),
    );
  });

/** Choose the output file from an explicit file, directory, or working directory. */
const selectOutputPath = (
  artifact: BuildArtifact,
  enteredOutput: string | undefined,
  workingDirectory: string,
): Effect.Effect<string, never, Path.Path> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    if (enteredOutput !== undefined && pathService.extname(enteredOutput).length > 0) {
      return enteredOutput;
    }
    let outputDirectory = enteredOutput;
    if (outputDirectory === undefined) outputDirectory = workingDirectory;
    return resignOutputPath(artifact, outputDirectory, pathService.extname(artifact.path));
  });

/** Bundle identifier configured for the artifact's app, or a typed failure. */
const requireAppleBundleId = (
  apps: readonly AppDescriptor[],
  appName: string,
): Effect.Effect<string, ResignCommandFailure> => {
  const configuredApp = apps.find((appDescriptor) => appDescriptor.name === appName);
  if (configuredApp === undefined) {
    return Effect.fail(
      makeResignCommandFailure({
        operation: 'find Apple bundle identifier',
        message: `No Apple bundle identifier is configured for ${appName}.`,
      }),
    );
  }
  if (configuredApp.bundleId === undefined) {
    return Effect.fail(
      makeResignCommandFailure({
        operation: 'find Apple bundle identifier',
        message: `No Apple bundle identifier is configured for ${appName}.`,
      }),
    );
  }
  return Effect.succeed(configuredApp.bundleId);
};

/** Re-sign one Apple build or explain what the dry run would do. */
const runAppleResign = (
  artifact: BuildArtifact,
  commandInput: ResignCommandInput,
  outputPath: string,
  workspace: ResignWorkspace,
): Effect.Effect<void, unknown, ResignCommandRequirements> =>
  Effect.gen(function* () {
    const bundleId = yield* requireAppleBundleId(workspace.apps, artifact.appName);
    const keyId = yield* selectAccountKeyId(commandInput.account);
    const signingAssets = yield* loadCachedSigningAssets(keyId, bundleId);
    if (signingAssets === null) {
      return yield* Effect.fail(
        makeResignCommandFailure({
          operation: 'load Apple signing assets',
          message: `No cached signing exists for ${bundleId} under account ${keyId}.`,
        }),
      );
    }
    if (commandInput.dryRun) return yield* printApplePlan(artifact, signingAssets, outputPath);
    return yield* resignAppleArtifact(artifact, signingAssets, outputPath);
  });

/** Re-sign one Android build or explain what the dry run would do. */
const runAndroidResign = (
  artifact: BuildArtifact,
  commandInput: ResignCommandInput,
  outputPath: string,
): Effect.Effect<void, unknown, ResignCommandRequirements> =>
  Effect.gen(function* () {
    const keystore = yield* loadCachedKeystore();
    if (keystore === null) {
      return yield* Effect.fail(
        makeResignCommandFailure({
          operation: 'load Android signing assets',
          message: 'No cached upload keystore exists. Run `launch creds setup --platform android`.',
        }),
      );
    }
    if (commandInput.dryRun) return yield* printAndroidPlan(artifact, keystore, outputPath);
    return yield* resignAndroidArtifact(artifact, keystore, outputPath);
  });

/** Decode and execute one `launch build:resign` request. */
export const resignCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, ResignCommandFailure, ResignCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(ResignCommandInputSchema)(rawCommandInput);
    const workspace = yield* loadResignWorkspace();
    const artifact = yield* selectStoredArtifact(commandInput, workspace);
    yield* assertResignablePlatform(artifact.platform);
    const outputPath = yield* selectOutputPath(
      artifact,
      commandInput.output,
      workspace.workingDirectory,
    );
    if (isApplePlatform(artifact.platform)) {
      yield* runAppleResign(artifact, commandInput, outputPath, workspace);
    } else {
      yield* runAndroidResign(artifact, commandInput, outputPath);
    }
    if (!commandInput.dryRun) {
      const logger = yield* createLogger(false);
      yield* logger.ok(`Re-signed artifact written to ${outputPath}.`);
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (isResignCommandFailure(cause)) return cause;
      return resignFailure('re-sign stored artifact', cause);
    }),
  );
