import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config/config.ts';
import { getActiveKeyId, listAccounts } from '../credentials/accounts.ts';
import { loadCachedKeystore } from '../credentials/android-keystore-assets.ts';
import { loadCachedSigningAssets } from '../credentials/apple-signing-assets.ts';
import { resolveStorageProvider } from '../distribution/storage.ts';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { captureCommandOutput, executeCommand } from '../services/platform/exec.ts';
import { createLogger } from '../services/platform/logger.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { isApplePlatform, platformLabel } from '../services/stores/platform.ts';
import type { AppDescriptor, Platform } from '../types/app.ts';
import type { BuildArtifact } from '../types/artifacts.ts';
import type { KeystoreAssets, SigningAssets } from '../types/credentials.ts';
import type { StorageProvider } from '../types/providers.ts';
import { findBuild } from './build-history-command.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

const STORE_PASSWORD_VARIABLE = 'LAUNCH_KS_STOREPASS';
const KEY_PASSWORD_VARIABLE = 'LAUNCH_KS_KEYPASS';

export type ResignCommandInput = Readonly<{
  id?: string;
  app?: string;
  account?: string;
  output?: string;
  dryRun: boolean;
}>;

export type ResignCommandFailure = Readonly<{
  readonly _tag: 'ResignCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export function makeResignCommandFailure(fields: {
  operation: string;
  message: string;
  cause?: unknown;
}): ResignCommandFailure {
  const hasCause = fields.cause != null;

  if (hasCause) {
    return {
      _tag: 'ResignCommandFailure',
      operation: fields.operation,
      message: fields.message,
      cause: fields.cause,
    };
  }

  return {
    _tag: 'ResignCommandFailure',
    operation: fields.operation,
    message: fields.message,
  };
}

type AndroidResignSpec = Readonly<{
  readonly command: string;
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
}>;

type ResignWorkspace = Readonly<{
  readonly workingDirectory: string;
  readonly apps: readonly AppDescriptor[];
  readonly storageProvider: StorageProvider;
}>;

type OptionalResignKey = 'id' | 'app' | 'account' | 'output';

function resignFailure(operation: string, cause: unknown): ResignCommandFailure {
  const failureMessage = errorMessage(cause);
  return makeResignCommandFailure({ operation, message: failureMessage, cause });
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const hasKey = Object.hasOwn(record, key);

  if (hasKey == false) {
    return null;
  }

  const field = record[key];

  if (field == null) {
    return null;
  }

  const isString = typeof field == 'string';

  if (isString == false) {
    throw new Error(`Resign command ${key} must be a string.`);
  }

  return field;
}

function withOptionalString(
  commandInput: ResignCommandInput,
  key: OptionalResignKey,
  field: string | null,
): ResignCommandInput {
  if (field == null) {
    return commandInput;
  }

  switch (key) {
    case 'id':
      return { ...commandInput, id: field };
    case 'app':
      return { ...commandInput, app: field };
    case 'account':
      return { ...commandInput, account: field };
    case 'output':
      return { ...commandInput, output: field };
  }
}

function decodeResignCommandInput(rawCommandInput: unknown): ResignCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Resign command input must be an object.');
  }

  const dryRun = rawCommandInputObject['dryRun'];
  const dryRunIsBoolean = typeof dryRun == 'boolean';

  if (dryRunIsBoolean == false) {
    throw new Error('Resign dryRun must be a boolean.');
  }

  let commandInput: ResignCommandInput = { dryRun };
  const optionalSetting = readOptionalString(rawCommandInputObject, 'id');
  commandInput = withOptionalString(commandInput, 'id', optionalSetting);
  const optionalString = readOptionalString(rawCommandInputObject, 'app');
  commandInput = withOptionalString(commandInput, 'app', optionalString);
  commandInput = withOptionalString(
    commandInput,
    'account',
    readOptionalString(rawCommandInputObject, 'account'),
  );
  commandInput = withOptionalString(
    commandInput,
    'output',
    readOptionalString(rawCommandInputObject, 'output'),
  );

  return commandInput;
}

/** Reject the macOS package format that this re-signing flow cannot rewrite. */
export function assertResignablePlatform(platform: Platform): void {
  const isMacPackage = platform == 'macos';

  if (isMacPackage == false) {
    return;
  }

  throw makeResignCommandFailure({
    operation: 'validate resign platform',
    message: `${platformLabel(platform)} builds are .pkg installers; build:resign supports Apple .ipa and Android .aab/.apk artifacts.`,
  });
}

/** Name a re-signed artifact from the source build's natural identifiers. */
export function resignOutputPath(
  artifact: BuildArtifact,
  outputDirectory: string,
  extensionName: string,
): string {
  return `${outputDirectory}/${artifact.appName}-${artifact.version}-${artifact.buildNumber}-resigned${extensionName}`;
}

/** Choose the stored-build reference, defaulting to the most recent entry. */
export function storedArtifactReference(commandInput: ResignCommandInput): string {
  if (commandInput.id != null) {
    return commandInput.id;
  }

  return 'latest';
}

function matchesStoredApp(appName: string, storedArtifact: BuildArtifact): boolean {
  return storedArtifact.appName == appName;
}

/** Narrow stored artifacts to one app handle when the operator asked for a scope. */
export function filterStoredArtifactsByApp(
  artifacts: readonly BuildArtifact[],
  appName: string | undefined,
): BuildArtifact[] {
  if (appName == null) {
    return [...artifacts];
  }

  return artifacts.filter(function keepApp(storedArtifact: BuildArtifact): boolean {
    return matchesStoredApp(appName, storedArtifact);
  });
}

/** Build arguments for unpacking an IPA. */
export function unzipArgs(ipaPath: string, destination: string): string[] {
  return ['-oq', ipaPath, '-d', destination];
}

/** Build arguments for repackaging an IPA from its working directory. */
export function zipArgs(outputIpa: string): string[] {
  return ['-qr', outputIpa, 'Payload'];
}

/** Build arguments for decoding an Apple provisioning profile. */
export function securityCmsArgs(profilePath: string): string[] {
  return ['cms', '-D', '-i', profilePath];
}

/** Build arguments for extracting entitlements from a decoded profile. */
export function plistBuddyEntitlementsArgs(profilePlistPath: string): string[] {
  return ['-x', '-c', 'Print :Entitlements', profilePlistPath];
}

/** Build arguments for re-signing one Apple application bundle. */
export function iosCodesignArgs(
  appBundlePath: string,
  identity: string,
  entitlementsPath: string,
): string[] {
  return ['-f', '-s', identity, '--entitlements', entitlementsPath, appBundlePath];
}

/** Describe the Android signing tool invocation without placing passwords in argv. */
export function androidResignSpec(
  artifactPath: string,
  keystore: KeystoreAssets,
): AndroidResignSpec {
  const environment: Record<string, string> = {
    [STORE_PASSWORD_VARIABLE]: keystore.storePassword,
    [KEY_PASSWORD_VARIABLE]: keystore.keyPassword,
  };
  const isApk = artifactPath.endsWith('.apk');

  if (isApk) {
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
}

async function loadResignWorkspace(): Promise<ResignWorkspace> {
  const launchPaths = readLaunchDirectories();
  const loadedLaunch = await loadConfig(launchPaths.workingDirectory);
  const storageProvider = await resolveStorageProvider(
    loadedLaunch.config,
    launchPaths.workingDirectory,
  );

  return {
    workingDirectory: launchPaths.workingDirectory,
    apps: loadedLaunch.apps,
    storageProvider,
  };
}

function matchesAccount(selector: string, account: { keyId: string; label: string }): boolean {
  if (account.keyId == selector) {
    return true;
  }

  return account.label == selector;
}

async function selectAccountKeyId(selector: string | undefined): Promise<string> {
  if (selector == null) {
    const activeKeyId = await getActiveKeyId();

    if (activeKeyId != null) {
      return activeKeyId;
    }

    throw makeResignCommandFailure({
      operation: 'select Apple account',
      message: 'No active Apple account. Run `launch-store creds set-key` or pass --account.',
    });
  }

  const accounts = await listAccounts();
  const matchedAccount = accounts.find(function sameAccount(account): boolean {
    return matchesAccount(selector, account);
  });

  if (matchedAccount != null) {
    return matchedAccount.keyId;
  }

  throw makeResignCommandFailure({
    operation: 'select Apple account',
    message: `No Apple account matching "${selector}".`,
  });
}

function isApplicationBundle(fileName: string): boolean {
  return fileName.endsWith('.app');
}

async function removeTemporaryDirectory(temporaryDirectory: string): Promise<void> {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function resignAppleArtifact(
  artifact: BuildArtifact,
  signingAssets: SigningAssets,
  outputPath: string,
): Promise<void> {
  const systemTemporaryDirectory = tmpdir();
  const launchResignPath = path.join(systemTemporaryDirectory, 'launch-resign-');
  const temporaryDirectory = await mkdtemp(launchResignPath);

  try {
    const unzip = unzipArgs(artifact.path, temporaryDirectory);
    await executeCommand('unzip', unzip);
    const applicationDirectory = path.join(temporaryDirectory, 'Payload');
    const applicationNames = await readdir(applicationDirectory);
    const applicationName = applicationNames.find(isApplicationBundle);

    if (applicationName == null) {
      throw makeResignCommandFailure({
        operation: 'unpack Apple artifact',
        message: `No .app exists inside ${artifact.path}.`,
      });
    }

    const applicationPath = path.join(applicationDirectory, applicationName);
    const embeddedProfile = path.join(applicationPath, 'embedded.mobileprovision');

    await copyFile(signingAssets.profilePath, embeddedProfile);

    const profilePlistPath = path.join(temporaryDirectory, 'profile.plist');
    const securityCms = securityCmsArgs(signingAssets.profilePath);
    const profilePlist = await captureCommandOutput('security', securityCms);

    await writeFile(profilePlistPath, profilePlist);

    const entitlementsPath = path.join(temporaryDirectory, 'entitlements.plist');
    const plistBuddyEntitlements = plistBuddyEntitlementsArgs(profilePlistPath);
    const entitlements = await captureCommandOutput(
      '/usr/libexec/PlistBuddy',
      plistBuddyEntitlements,
    );

    await writeFile(entitlementsPath, entitlements);
    const iosCodesign = iosCodesignArgs(applicationPath, signingAssets.certName, entitlementsPath);
    await executeCommand('codesign', iosCodesign);

    const outputExists = await pathExists(outputPath);

    if (outputExists) {
      await rm(outputPath);
    }

    const zip = zipArgs(outputPath);
    await executeCommand('zip', zip, { workingDirectory: temporaryDirectory });
  } finally {
    await removeTemporaryDirectory(temporaryDirectory);
  }
}

async function resignAndroidArtifact(
  artifact: BuildArtifact,
  keystore: KeystoreAssets,
  outputPath: string,
): Promise<void> {
  await copyFile(artifact.path, outputPath);

  const resignSpec = androidResignSpec(outputPath, keystore);
  const environmentOverrides: Record<string, string> = {
    [STORE_PASSWORD_VARIABLE]: keystore.storePassword,
    [KEY_PASSWORD_VARIABLE]: keystore.keyPassword,
  };

  await executeCommand(resignSpec.command, resignSpec.arguments, { environmentOverrides });
}

function printApplePlan(
  artifact: BuildArtifact,
  signingAssets: SigningAssets,
  outputPath: string,
): void {
  const logger = createLogger(false);

  const fileName = path.basename(artifact.path);
  logger.line(`Would re-sign ${fileName} with Apple signing:`);
  logger.line(`  identity: ${signingAssets.certName} (team ${signingAssets.teamId})`);
  logger.line(`  profile: ${signingAssets.profileName}`);
  logger.line(`  output: ${outputPath}`);
}

function printAndroidPlan(
  artifact: BuildArtifact,
  keystore: KeystoreAssets,
  outputPath: string,
): void {
  const logger = createLogger(false);
  const resignSpec = androidResignSpec(outputPath, keystore);

  const fileName = path.basename(artifact.path);
  logger.line(`Would re-sign ${fileName} with Android signing:`);
  logger.line(`  keystore: ${keystore.path} (alias ${keystore.alias})`);
  logger.line(`  tool: ${resignSpec.command} (passwords supplied through environment)`);
  logger.line(`  output: ${outputPath}`);
}

async function selectStoredArtifact(
  commandInput: ResignCommandInput,
  workspace: ResignWorkspace,
): Promise<BuildArtifact> {
  const storedArtifacts = await workspace.storageProvider.list();
  const scopedHistory = filterStoredArtifactsByApp(storedArtifacts, commandInput.app);
  const reference = storedArtifactReference(commandInput);
  const artifact = findBuild(scopedHistory, reference);

  if (artifact == null) {
    throw makeResignCommandFailure({
      operation: 'select stored artifact',
      message: `No stored build matches "${reference}".`,
    });
  }

  const artifactExists = await pathExists(artifact.path);

  if (artifactExists) {
    return artifact;
  }

  throw makeResignCommandFailure({
    operation: 'select stored artifact',
    message: `The artifact for ${artifact.appName} is gone from ${artifact.path}.`,
  });
}

function explicitOutputFile(enteredOutput: string | undefined): string | null {
  if (enteredOutput == null) {
    return null;
  }

  const extensionName = path.extname(enteredOutput);
  const hasExtension = extensionName.length > 0;

  if (hasExtension == false) {
    return null;
  }

  return enteredOutput;
}

function selectOutputPath(
  artifact: BuildArtifact,
  enteredOutput: string | undefined,
  workingDirectory: string,
): string {
  const explicitFile = explicitOutputFile(enteredOutput);

  if (explicitFile != null) {
    return explicitFile;
  }

  if (enteredOutput == null) {
    return resignOutputPath(artifact, workingDirectory, path.extname(artifact.path));
  }

  return resignOutputPath(artifact, enteredOutput, path.extname(artifact.path));
}

function missingBundleFailure(appName: string): ResignCommandFailure {
  return makeResignCommandFailure({
    operation: 'find Apple bundle identifier',
    message: `No Apple bundle identifier is configured for ${appName}.`,
  });
}

function requireAppleBundleId(apps: readonly AppDescriptor[], appName: string): string {
  const configuredApp = apps.find(function sameName(appDescriptor: AppDescriptor): boolean {
    return appDescriptor.name == appName;
  });

  if (configuredApp == null) {
    throw missingBundleFailure(appName);
  }

  const bundleId = configuredApp.bundleId;

  if (bundleId == null) {
    throw missingBundleFailure(appName);
  }

  return bundleId;
}

async function runAppleResign(
  artifact: BuildArtifact,
  commandInput: ResignCommandInput,
  outputPath: string,
  workspace: ResignWorkspace,
): Promise<void> {
  const bundleId = requireAppleBundleId(workspace.apps, artifact.appName);
  const keyId = await selectAccountKeyId(commandInput.account);
  const signingAssets = await loadCachedSigningAssets(keyId, bundleId);

  if (signingAssets == null) {
    throw makeResignCommandFailure({
      operation: 'load Apple signing assets',
      message: `No cached signing exists for ${bundleId} under account ${keyId}.`,
    });
  }

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    printApplePlan(artifact, signingAssets, outputPath);
    return;
  }

  await resignAppleArtifact(artifact, signingAssets, outputPath);
}

function missingAndroidPackageFailure(): ResignCommandFailure {
  return makeResignCommandFailure({
    operation: 'select Android app',
    message: 'Select an app with android.package before re-signing.',
  });
}

function requireAndroidPackageName(apps: readonly AppDescriptor[], appName: string): string {
  const selectedApp = apps.find(function sameName(app: AppDescriptor): boolean {
    return app.name == appName;
  });

  if (selectedApp == null) {
    throw missingAndroidPackageFailure();
  }

  const packageName = selectedApp.packageName;

  if (packageName == null) {
    throw missingAndroidPackageFailure();
  }

  const isBlankPackage = packageName == '';

  if (isBlankPackage) {
    throw missingAndroidPackageFailure();
  }

  return packageName;
}

async function runAndroidResign(
  artifact: BuildArtifact,
  commandInput: ResignCommandInput,
  outputPath: string,
  apps: readonly AppDescriptor[],
): Promise<void> {
  const packageName = requireAndroidPackageName(apps, artifact.appName);
  const keystore = await loadCachedKeystore(packageName);

  if (keystore == null) {
    throw makeResignCommandFailure({
      operation: 'load Android signing assets',
      message:
        'No cached upload keystore exists. Run `launch-store creds setup --platform android --app <name>`.',
    });
  }

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    printAndroidPlan(artifact, keystore, outputPath);
    return;
  }

  await resignAndroidArtifact(artifact, keystore, outputPath);
}

/** Decode and execute one `launch-store build:resign` request. */
export async function resignCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeResignCommandInput(rawCommandInput);
    const workspace = await loadResignWorkspace();
    const artifact = await selectStoredArtifact(commandInput, workspace);

    assertResignablePlatform(artifact.platform);

    const outputPath = selectOutputPath(artifact, commandInput.output, workspace.workingDirectory);
    const isApple = isApplePlatform(artifact.platform);

    if (isApple) {
      await runAppleResign(artifact, commandInput, outputPath, workspace);
    } else {
      await runAndroidResign(artifact, commandInput, outputPath, workspace.apps);
    }

    const isDryRun = commandInput.dryRun == true;

    if (isDryRun) {
      return;
    }

    const logger = createLogger(false);

    logger.ok(`Re-signed artifact written to ${outputPath}.`);
  } catch (error) {
    if (isFailureTag(error, 'ResignCommandFailure')) {
      throw error;
    }

    throw resignFailure('re-sign stored artifact', error);
  }
}
