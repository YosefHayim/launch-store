import { FileSystem, Path } from '@effect/platform';
import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { Data, Effect } from 'effect';
import { loadConfig } from '../config/config.js';
import { errorMessage } from '../services/errorMessage.js';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { captureCommandOutput, checkCommandExists } from '../services/exec.js';
import { detectHostOperatingSystem } from '../services/os.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { getCredentialsProvider } from '../services/registry.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { AppleStoreClientService } from '../services/appleStoreClient.js';
import type { GoogleStoreClientService } from '../services/googleStoreClient.js';
import { createAscClientResolver, createPlayClientResolver } from '../store/storeClients.js';
import { selectApps } from '../store/syncJobs.js';
import type { DoctorContext, DoctorPlatform } from '../types/doctor.js';

export type DoctorRuntimeRequirements =
  | AppleStoreClientService
  | CommandExecutor
  | FileSystem.FileSystem
  | GoogleStoreClientService
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchSecretStoreService
  | Path.Path;

/** Doctor context construction failed before any inspection section could run. */
export type DoctorContextFailure = Readonly<{
  readonly _tag: 'DoctorContextFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeDoctorContextFailure = Data.tagged<DoctorContextFailure>('DoctorContextFailure');

/** Convert one context dependency failure into the doctor boundary error. */
const contextFailure = (operation: string, cause: unknown): DoctorContextFailure =>
  makeDoctorContextFailure({ operation, message: errorMessage(cause), cause });

export const buildDoctorContext = (
  platform: DoctorPlatform,
  appSelector?: string,
): Effect.Effect<
  DoctorContext<DoctorRuntimeRequirements>,
  DoctorContextFailure,
  FileSystem.FileSystem | LaunchEnvironmentService | LaunchPathsService | Path.Path
> =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    const launchPaths = yield* LaunchPaths;
    const loadedConfig = yield* loadConfig(launchPaths.workingDirectory).pipe(
      Effect.mapError((cause) => contextFailure('load Launch configuration', cause)),
    );
    const operatingSystem = yield* detectHostOperatingSystem;
    const resolveAppleClient = createAscClientResolver();
    const resolveGoogleClient = createPlayClientResolver();
    const selectedApps = yield* selectApps(loadedConfig.apps, appSelector).pipe(
      Effect.mapError((cause) => contextFailure('select doctor apps', cause)),
    );

    let androidSdk = environment.values.androidSdkRoot;
    if (environment.values.androidSdkHome !== undefined)
      androidSdk = environment.values.androidSdkHome;
    if (androidSdk === '') androidSdk = undefined;

    const shellLocale: NonNullable<DoctorContext['shellLocale']> = {};
    const language = environment.rawVariables['LANG'];
    const languageFallback = environment.rawVariables['LANGUAGE'];
    const localeOverride = environment.rawVariables['LC_ALL'];
    if (language !== undefined) shellLocale.LANG = language;
    if (languageFallback !== undefined) shellLocale.LANGUAGE = languageFallback;
    if (localeOverride !== undefined) shellLocale.LC_ALL = localeOverride;

    const doctorContext: DoctorContext<DoctorRuntimeRequirements> = {
      config: loadedConfig.config,
      apps: selectedApps,
      platform,
      os: operatingSystem,
      cwd: launchPaths.workingDirectory,
      exists: (executable) => checkCommandExists(executable),
      gradleWrapperExists: (appDirectory) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const pathService = yield* Path.Path;
          return yield* fileSystem.exists(pathService.join(appDirectory, 'android', 'gradlew'));
        }),
      resolveAsc: () => resolveAppleClient(),
      resolvePlay: () => resolveGoogleClient(),
      credentialsStatus: () =>
        getCredentialsProvider(loadedConfig.config.credentials).pipe(
          Effect.flatMap((credentialsProvider) => credentialsProvider.status()),
        ),
      corepackAvailable: () => checkCommandExists('corepack'),
      codesignIdentities: () =>
        captureCommandOutput('security', ['find-identity', '-v', '-p', 'codesigning']).pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        ),
      shellLocale,
    };
    if (androidSdk === undefined) return doctorContext;
    return { ...doctorContext, androidSdk };
  });
