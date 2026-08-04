import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { SizeReportEntry } from '@core/types/artifacts.js';
import type { ResolvedBuildContext } from '@core/types/config.js';
import type { BuildCredentials, KeystoreAssets } from '@core/types/credentials.js';
import { makeProviderInputFailure, type BuildEngine } from '@core/types/providers.js';
import {
  captureCommandOutput,
  executeCommand,
  provideNodeCommandServices,
} from '@core/services/exec.js';
import {
  runWithProgress,
  gradleProgressStep,
  type ProgressRunOptions,
} from '@core/services/progress.js';
import { detectHostOperatingSystem } from '@core/services/os.js';
import {
  estimateFor,
  readBuildState,
  updateEstimate,
  writeBuildState,
} from '@core/services/buildEngineSupport.js';
/**
 * The single ETA baseline key for Android. Unlike iOS there's no clean/incremental split - Gradle tracks
 * its own task inputs/outputs, so every build learns one "default" estimate (see {@link BuildEstimate}).
 */
const ANDROID_ESTIMATE_KIND = 'default';
const gradleFailure = (message: string) =>
  makeProviderInputFailure({ provider: 'gradle', message });
/** Locate the platform-specific Gradle wrapper. */
const gradleWrapper = (androidDirectory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const operatingSystem = yield* detectHostOperatingSystem;
    let wrapperName = 'gradlew';
    if (operatingSystem === 'windows') wrapperName = 'gradlew.bat';
    const wrapperPath = pathService.join(androidDirectory, wrapperName);
    if (yield* fileSystem.exists(wrapperPath)) return wrapperPath;
    return yield* Effect.fail(
      gradleFailure(`No Gradle wrapper at ${wrapperPath} - did prebuild run?`),
    );
  });
/** Find the single release artifact Gradle emitted. */
const findReleaseArtifact = (androidDirectory: string, artifactKind: 'apk' | 'bundle') =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    let extension = '.aab';
    let taskName = 'bundleRelease';
    if (artifactKind === 'apk') {
      extension = '.apk';
      taskName = 'assembleRelease';
    }
    const releaseDirectory = pathService.join(
      androidDirectory,
      'app',
      'build',
      'outputs',
      artifactKind,
      'release',
    );
    const releaseDirectoryExists = yield* fileSystem.exists(releaseDirectory);
    if (!releaseDirectoryExists) {
      return yield* Effect.fail(
        gradleFailure(
          `Gradle produced no ${artifactKind} release directory (${releaseDirectory}).`,
        ),
      );
    }
    const artifactName = (yield* fileSystem.readDirectory(releaseDirectory)).find((entryName) =>
      entryName.endsWith(extension),
    );
    if (artifactName !== undefined) return pathService.join(releaseDirectory, artifactName);
    return yield* Effect.fail(
      gradleFailure(`No ${extension} found in ${releaseDirectory} after ${taskName}.`),
    );
  });
/**
 * Parse `bundletool get-size total --dimensions=ALL` CSV into the min/max download in bytes.
 *
 * The output is a header row (whose last two columns are `MIN`,`MAX`) followed by one row per device
 * configuration. The honest worst-case download is the largest `MAX` across configurations; `MIN` is
 * the smallest. Unrecognized output degrades to zeros rather than throwing, so a bundletool format
 * drift surfaces as a 0-byte estimate (caught by the caller), not a crash.
 */
export const parseBundletoolSize = (
  csv: string,
): {
  minBytes: number;
  maxBytes: number;
} => {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) return { minBytes: 0, maxBytes: 0 };
  const headerLine = lines[0];
  if (headerLine === undefined) return { minBytes: 0, maxBytes: 0 };
  const header = headerLine.split(',').map((cell) => cell.trim().toUpperCase());
  const minCol = header.indexOf('MIN');
  const maxCol = header.indexOf('MAX');
  if (minCol === -1) return { minBytes: 0, maxBytes: 0 };
  if (maxCol === -1) return { minBytes: 0, maxBytes: 0 };
  let minBytes = Number.POSITIVE_INFINITY;
  let maxBytes = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const minimumCell = cells[minCol];
    const maximumCell = cells[maxCol];
    if (minimumCell === undefined) continue;
    if (maximumCell === undefined) continue;
    const parsedMinimum = Number.parseInt(minimumCell, 10);
    const parsedMaximum = Number.parseInt(maximumCell, 10);
    if (!Number.isNaN(parsedMinimum)) minBytes = Math.min(minBytes, parsedMinimum);
    if (!Number.isNaN(parsedMaximum)) maxBytes = Math.max(maxBytes, parsedMaximum);
  }
  if (!Number.isFinite(minBytes)) minBytes = 0;
  return { minBytes, maxBytes };
};
/**
 * Estimate the worst-case store download for an `.aab` with bundletool: build the device APK splits
 * (signed with the same upload keystore, so the estimate is representative), then read the size table.
 * Returns one {@link SizeReportEntry} (`installBytes` 0 - Play exposes no honest install figure), or an
 * empty array if the estimate couldn't be produced, so the build still completes with the `.aab` size.
 */
const estimateDownload = (
  aabPath: string,
  keystore: KeystoreAssets,
): Effect.Effect<SizeReportEntry[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const workingDirectory = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-aab-' });
      const apksPath = pathService.join(workingDirectory, 'app.apks');
      yield* provideNodeCommandServices(
        executeCommand('bundletool', [
          'build-apks',
          `--bundle=${aabPath}`,
          `--output=${apksPath}`,
          '--mode=default',
          `--ks=${keystore.path}`,
          `--ks-pass=pass:${keystore.storePassword}`,
          `--ks-key-alias=${keystore.alias}`,
          `--key-pass=pass:${keystore.keyPassword}`,
        ]),
      );
      const sizeTable = yield* provideNodeCommandServices(
        captureCommandOutput('bundletool', [
          'get-size',
          'total',
          `--apks=${apksPath}`,
          '--dimensions=ALL',
        ]),
      );
      const { maxBytes } = parseBundletoolSize(sizeTable);
      if (maxBytes > 0)
        return [{ device: 'worst-case device', downloadBytes: maxBytes, installBytes: 0 }];
      return [];
    }),
  );
export const gradleBuildEngine = {
  name: 'gradle',
  buildArtifact(buildContext: ResolvedBuildContext, buildCredentials: BuildCredentials) {
    return Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      if (buildContext.dryRun) {
        return {
          artifactPath: '(dry-run, not built)',
          sizeReport: { artifactBytes: 0, entries: [] },
          cleanBuilt: false,
        };
      }
      if (buildCredentials.platform !== 'android')
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: 'gradle',
            message: 'The gradle build engine builds Android only.',
          }),
        );
      const keystore = buildCredentials.keystore;
      if (!keystore)
        return yield* Effect.fail(
          makeProviderInputFailure({
            provider: 'gradle',
            message:
              'No upload keystore resolved - run `launch creds setup --platform android` first.',
          }),
        );
      const androidDir = pathService.join(buildContext.app.dir, 'android');
      const wrapper = yield* gradleWrapper(androidDir);
      // Gradle is incrementally correct by default; `--clean` prepends the clean task for a from-scratch build.
      // (iOS-style native fingerprinting isn't needed here - Gradle tracks task inputs/outputs itself.)
      const cleanBuilt = buildContext.forceClean;
      // Internal distribution needs a directly-installable .apk; the store path produces an .aab.
      const internal = buildContext.distribution === 'internal';
      let assembleTask = ':app:bundleRelease';
      if (internal) assembleTask = ':app:assembleRelease';
      const stored = yield* readBuildState(buildContext.app.name, 'android');
      const estimate = estimateFor(stored, ANDROID_ESTIMATE_KIND);
      // Sign the artifact with the resolved upload key via AGP's injected-signing properties (no build.gradle edit).
      const gradleArguments: string[] = [];
      if (cleanBuilt) gradleArguments.push(':app:clean');
      gradleArguments.push(
        assembleTask,
        `-Pandroid.injected.signing.store.file=${keystore.path}`,
        `-Pandroid.injected.signing.store.password=${keystore.storePassword}`,
        `-Pandroid.injected.signing.key.alias=${keystore.alias}`,
        `-Pandroid.injected.signing.key.password=${keystore.keyPassword}`,
      );
      const progressOptions: ProgressRunOptions = {
        label: `Building Android - ${buildContext.app.name}`,
        parseStep: gradleProgressStep,
        cwd: androidDir,
        env: buildContext.env,
      };
      if (estimate !== undefined) progressOptions.estimate = estimate;
      const buildRun = yield* runWithProgress(wrapper, gradleArguments, progressOptions);
      // Learn this build's duration/Gradle-task count into the one "default" baseline so the next ETA improves.
      // Android has no native fingerprint (Gradle owns incrementality), so it's stored empty; stream mode
      // reports 0 steps (output unparsed), so carry the prior step total forward.
      const prior = stored?.estimates?.[ANDROID_ESTIMATE_KIND];
      let priorStepCount = 0;
      if (prior?.steps !== undefined) priorStepCount = prior.steps;
      let recordedStepCount = priorStepCount;
      if (buildRun.steps > 0) recordedStepCount = buildRun.steps;
      const sample = {
        ms: buildRun.elapsedMs,
        steps: recordedStepCount,
      };
      let priorEstimates = {};
      if (stored?.estimates !== undefined) priorEstimates = stored.estimates;
      yield* writeBuildState(buildContext.app.name, 'android', {
        fingerprint: '',
        builtAt: new Date().toISOString(),
        cleanBuilt,
        estimates: {
          ...priorEstimates,
          [ANDROID_ESTIMATE_KIND]: updateEstimate(prior, sample),
        },
      });
      // An .apk's on-disk size is essentially the download (no Play splits), so report it directly;
      // an .aab gets the bundletool worst-case estimate (the .aab file size is NOT the download).
      if (internal) {
        const apkPath = yield* findReleaseArtifact(androidDir, 'apk');
        const apkBytes = Number((yield* fileSystem.stat(apkPath)).size);
        return {
          artifactPath: apkPath,
          sizeReport: {
            artifactBytes: apkBytes,
            entries: [{ device: 'apk', downloadBytes: apkBytes, installBytes: 0 }],
          },
          cleanBuilt,
        };
      }
      const artifactPath = yield* findReleaseArtifact(androidDir, 'bundle');
      const artifactBytes = Number((yield* fileSystem.stat(artifactPath)).size);
      const entries = yield* estimateDownload(artifactPath, keystore);
      return { artifactPath, sizeReport: { artifactBytes, entries }, cleanBuilt };
    });
  },
};

type GradleBuildRequirements = Effect.Effect.Context<
  ReturnType<(typeof gradleBuildEngine)['buildArtifact']>
>;

/** Acquire the build services once and return a requirement-free Gradle engine. */
export const makeGradleBuildEngine = () =>
  Effect.gen(function* () {
    const buildServices = yield* Effect.context<GradleBuildRequirements>();
    return {
      name: gradleBuildEngine.name,
      buildArtifact: (buildContext: ResolvedBuildContext, buildCredentials: BuildCredentials) =>
        gradleBuildEngine
          .buildArtifact(buildContext, buildCredentials)
          .pipe(Effect.provide(buildServices)),
    } satisfies BuildEngine;
  });
