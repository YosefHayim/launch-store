import { join } from 'node:path';
import { loadConfig, type LoadedConfig } from '@/config/config.js';
import type { LaunchEnvironmentValues } from '@/config/environment.js';
import { pathExists } from '@/path-exists.js';
import { errorMessage } from '@/services/platform/errorMessage.js';
import { readLaunchEnvironment } from '@/services/platform/environment.js';
import { captureCommandOutput, checkCommandExists } from '@/services/platform/exec.js';
import { detectHostOperatingSystem } from '@/services/platform/os.js';
import { readLaunchDirectories } from '@/services/platform/paths.js';
import { getCredentialsProvider } from '@/services/providerSupport/registry.js';
import { createAscClientResolver, createPlayClientResolver } from '@/store/shared/storeClients.js';
import { selectApps } from '@/store/shared/syncJobs.js';
import type { AppDescriptor } from '@/types/app.js';
import type { DoctorAscApi, DoctorContext, DoctorPlatform } from '@/types/doctor.js';

type DoctorContextFailure = Readonly<{
  _tag: 'DoctorContextFailure';
  operation: string;
  message: string;
  cause: unknown;
}>;

function contextFailure(operation: string, cause: unknown): DoctorContextFailure {
  return {
    _tag: 'DoctorContextFailure',
    operation,
    message: errorMessage(cause),
    cause,
  };
}

function readAndroidSdk(values: LaunchEnvironmentValues): string | null {
  let androidSdk = values.androidSdkRoot;

  if (values.androidSdkHome != null) {
    androidSdk = values.androidSdkHome;
  }

  if (androidSdk == null) {
    return null;
  }

  if (androidSdk == '') {
    return null;
  }

  return androidSdk;
}

function listedPackageName(app: AppDescriptor): string | null {
  if (app.packageName == null) {
    return null;
  }

  return app.packageName;
}

function isListedPackageName(packageName: string | null): packageName is string {
  return packageName != null;
}

type ShellLocale = NonNullable<DoctorContext['shellLocale']>;

type DoctorPlayClient = {
  assertAppExists(packageName: string): Promise<void>;
};

function assignLocale(
  shellLocale: ShellLocale,
  localeName: 'LANG' | 'LANGUAGE' | 'LC_ALL',
  localeText: string | undefined,
): void {
  if (localeText == null) {
    return;
  }

  shellLocale[localeName] = localeText;
}

function readShellLocale(variables: Readonly<Record<string, string | undefined>>): ShellLocale {
  const shellLocale: ShellLocale = {};
  assignLocale(shellLocale, 'LANG', variables['LANG']);
  assignLocale(shellLocale, 'LANGUAGE', variables['LANGUAGE']);
  assignLocale(shellLocale, 'LC_ALL', variables['LC_ALL']);

  return shellLocale;
}

async function gradleWrapperExists(appDirectory: string): Promise<boolean> {
  const wrapperPath = join(appDirectory, 'android', 'gradlew');

  return pathExists(wrapperPath);
}

function commandExists(executable: string): Promise<boolean> {
  return checkCommandExists(executable);
}

function corepackAvailable(): Promise<boolean> {
  return checkCommandExists('corepack');
}

async function readCodesignIdentities(): Promise<string | null> {
  try {
    return await captureCommandOutput('security', ['find-identity', '-v', '-p', 'codesigning']);
  } catch {
    // A missing security CLI is an advisory skip, not a doctor failure.
    return null;
  }
}

/** Build the injected doctor context for one platform and optional app selector. */
export async function buildDoctorContext(
  platform: DoctorPlatform,
  appSelector?: string,
): Promise<DoctorContext> {
  const environment = readLaunchEnvironment();
  const launchPaths = readLaunchDirectories();
  let loadedConfig: LoadedConfig;

  try {
    loadedConfig = await loadConfig(launchPaths.workingDirectory);
  } catch (error) {
    throw contextFailure('load Launch configuration', error);
  }

  const operatingSystem = detectHostOperatingSystem();
  const resolveAppleClient = createAscClientResolver();
  const resolveGoogleClient = createPlayClientResolver();
  let selectedApps: readonly AppDescriptor[];

  try {
    selectedApps = await selectApps(loadedConfig.apps, appSelector);
  } catch (error) {
    throw contextFailure('select doctor apps', error);
  }

  const androidSdk = readAndroidSdk(environment.values);
  const shellLocale = readShellLocale(environment.rawVariables);

  function resolveAsc(): Promise<DoctorAscApi | null> {
    return resolveAppleClient();
  }

  function resolvePlay(packageName?: string): Promise<DoctorPlayClient | null> {
    return resolveGoogleClient(packageName);
  }

  async function credentialsStatus(): Promise<string> {
    const credentialsProvider = getCredentialsProvider(loadedConfig.config.credentials);
    const packageNames = selectedApps.map(listedPackageName).filter(isListedPackageName);

    return credentialsProvider.status(packageNames);
  }

  const doctorContext: DoctorContext = {
    config: loadedConfig.config,
    apps: selectedApps,
    platform,
    os: operatingSystem,
    cwd: launchPaths.workingDirectory,
    exists: commandExists,
    gradleWrapperExists,
    resolveAsc,
    resolvePlay,
    credentialsStatus,
    codesignIdentities: readCodesignIdentities,
    corepackAvailable,
    shellLocale,
  };

  if (androidSdk == null) {
    return doctorContext;
  }

  return { ...doctorContext, androidSdk };
}
