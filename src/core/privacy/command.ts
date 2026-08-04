import { FileSystem, Path } from '@effect/platform';
import { Context, Data, Effect, Layer, Option } from 'effect';
import { loadConfig, readResolvedConfig, type LoadedConfig } from '../config/config.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPaths } from '../services/paths.js';
import { selectApps } from '../store/syncJobs.js';
import { completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AppDescriptor } from '../types/app.js';
import type { PrivacySurface } from '../types/privacy.js';
import { surfaceFromExpoConfig, surfaceFromNative } from './parse.js';
import { buildPrivacyReport, reconcilePrivacy, renderPrivacyReport } from './reconcile.js';

/** Options accepted by the privacy scan command program. */
export type PrivacyCommandOptions = {
  app?: string;
  json?: boolean;
};

/** Loading the app configuration or its resolved Expo surface failed. */
export type PrivacyCommandFailure = Readonly<{
  readonly _tag: 'PrivacyCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makePrivacyCommandFailure =
  Data.tagged<PrivacyCommandFailure>('PrivacyCommandFailure');

/** Runtime dependencies for privacy discovery, output, and exit status. */
export type PrivacyCommandDependencies = {
  readonly loadConfiguration: Effect.Effect<LoadedConfig, PrivacyCommandFailure>;
  readonly inspectPrivacySurface: (
    appDescriptor: AppDescriptor,
  ) => Effect.Effect<PrivacySurface, PrivacyCommandFailure>;
  readonly logger: Logger;
};

/** Injectable command boundary for privacy discovery and reporting. */
export const PrivacyCommandService =
  Context.GenericTag<PrivacyCommandDependencies>('PrivacyCommandService');
export type PrivacyCommandService = PrivacyCommandDependencies;

/** Directories excluded from bounded privacy manifest discovery. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'Pods', 'build', 'DerivedData', 'dist']);

/** Map a failed command dependency to the privacy command's tagged failure. */
const commandFailure = (operation: string, cause: unknown): PrivacyCommandFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  return makePrivacyCommandFailure({ operation, message, cause });
};

/** Find matching source files to a bounded depth while ignoring generated directories. */
const findFiles = (
  rootDirectory: string,
  matchesFileName: (fileName: string) => boolean,
  maximumDepth = 6,
): Effect.Effect<string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    if (!(yield* fileSystem.exists(rootDirectory).pipe(Effect.orElseSucceed(() => false)))) {
      return [];
    }
    const visitDirectory = (directoryPath: string, depth: number): Effect.Effect<string[]> =>
      Effect.gen(function* () {
        if (depth > maximumDepth) return [];
        const directoryEntries = yield* fileSystem
          .readDirectory(directoryPath)
          .pipe(Effect.orElseSucceed(() => []));
        const matchingPaths: string[] = [];
        for (const directoryEntry of directoryEntries) {
          if (SKIPPED_DIRECTORIES.has(directoryEntry)) continue;
          if (directoryEntry.startsWith('.')) continue;
          const entryPath = pathService.join(directoryPath, directoryEntry);
          const entryMetadata = yield* fileSystem.stat(entryPath).pipe(Effect.option);
          if (Option.isNone(entryMetadata)) continue;
          if (entryMetadata.value.type === 'Directory') {
            matchingPaths.push(...(yield* visitDirectory(entryPath, depth + 1)));
            continue;
          }
          if (matchesFileName(directoryEntry)) matchingPaths.push(entryPath);
        }
        return matchingPaths;
      });
    return yield* visitDirectory(rootDirectory, 0);
  });

/** Read every accessible path, retaining a partial surface when one file is unreadable. */
const readFiles = (
  filePaths: readonly string[],
): Effect.Effect<string[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const fileContents: string[] = [];
    for (const filePath of filePaths) {
      const fileSource = yield* fileSystem.readFileString(filePath).pipe(Effect.option);
      if (Option.isSome(fileSource)) fileContents.push(fileSource.value);
    }
    return fileContents;
  });

/** Build a privacy surface from native manifests when a prebuilt project exists. */
const readNativePrivacySurface = (
  appDescriptor: AppDescriptor,
): Effect.Effect<
  { readonly foundNativeFiles: boolean; readonly privacySurface: PrivacySurface },
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const pathService = yield* Path.Path;
    const iosDirectory = pathService.join(appDescriptor.dir, 'ios');
    const androidDirectory = pathService.join(appDescriptor.dir, 'android');
    const infoPlists = yield* readFiles(
      yield* findFiles(iosDirectory, (fileName) => fileName === 'Info.plist'),
    );
    const privacyManifests = yield* readFiles(
      yield* findFiles(iosDirectory, (fileName) => fileName.endsWith('.xcprivacy')),
    );
    const androidManifests = yield* readFiles(
      yield* findFiles(androidDirectory, (fileName) => fileName === 'AndroidManifest.xml'),
    );
    let foundNativeFiles = infoPlists.length > 0;
    if (!foundNativeFiles && privacyManifests.length > 0) foundNativeFiles = true;
    if (!foundNativeFiles && androidManifests.length > 0) foundNativeFiles = true;
    return {
      foundNativeFiles,
      privacySurface: surfaceFromNative({ infoPlists, privacyManifests, androidManifests }),
    };
  });

/** Inspect native manifests first, falling back to the resolved Expo configuration. */
const inspectPrivacySurface = (
  appDescriptor: AppDescriptor,
): Effect.Effect<PrivacySurface, PrivacyCommandFailure, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const nativeSurface = yield* readNativePrivacySurface(appDescriptor);
    if (nativeSurface.foundNativeFiles) return nativeSurface.privacySurface;
    const resolvedExpoConfiguration = yield* readResolvedConfig(appDescriptor.dir);
    if (resolvedExpoConfiguration === null) return surfaceFromExpoConfig({});
    return surfaceFromExpoConfig(resolvedExpoConfiguration);
  });

/** Live privacy dependencies backed by Effect Platform services. */
export const PrivacyCommandServiceLive = Layer.effect(
  PrivacyCommandService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const launchPaths = yield* LaunchPaths;
    const logger = yield* createLogger(false);
    return {
      loadConfiguration: loadConfig().pipe(
        Effect.mapError((cause) => commandFailure('load Launch configuration', cause)),
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, pathService),
        Effect.provideService(LaunchPaths, launchPaths),
      ),
      inspectPrivacySurface: (appDescriptor) =>
        inspectPrivacySurface(appDescriptor).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, pathService),
        ),
      logger,
    } satisfies PrivacyCommandDependencies;
  }),
);

/** Scan selected apps, reconcile their privacy surfaces, and emit the report. */
export const privacyCommandProgram = (
  commandOptions: PrivacyCommandOptions,
): Effect.Effect<void, PrivacyCommandFailure | CommandExit, PrivacyCommandService> =>
  Effect.gen(function* () {
    const commandService = yield* PrivacyCommandService;
    const loadedConfiguration = yield* commandService.loadConfiguration;
    const selectedApps = yield* selectApps(loadedConfiguration.apps, commandOptions.app).pipe(
      Effect.mapError((cause) => commandFailure('select privacy apps', cause)),
    );
    const appFindings = yield* Effect.forEach(
      selectedApps,
      (appDescriptor) =>
        commandService.inspectPrivacySurface(appDescriptor).pipe(
          Effect.map((privacySurface) => ({
            appName: appDescriptor.name,
            findings: reconcilePrivacy(appDescriptor.name, privacySurface),
          })),
        ),
      { concurrency: 1 },
    );
    const privacyReport = buildPrivacyReport(
      appFindings.flatMap((appFindingSet) => appFindingSet.findings),
      appFindings.map((appFindingSet) => appFindingSet.appName),
    );
    let reportText = renderPrivacyReport(privacyReport);
    if (commandOptions.json === true) reportText = JSON.stringify(privacyReport, null, 2);
    yield* commandService.logger
      .line(reportText)
      .pipe(Effect.mapError((cause) => commandFailure('write privacy report', cause)));
    yield* completeCommand(privacyReport.exitCode);
  });
