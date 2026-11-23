import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SizeReportEntry } from '../../types/artifacts.ts';
import type { KeystoreAssets } from '../../types/credentials.ts';
import { makeProviderInputFailure, type BuildEngine } from '../../types/providers.ts';
import { captureCommandOutput, executeCommand } from '../../services/platform/exec.ts';
import {
  runWithProgress,
  gradleProgressStep,
  type ProgressRunOptions,
} from '../../services/platform/progress.ts';
import { detectHostOperatingSystem } from '../../services/platform/os.ts';
import { pathExists } from '../../path-exists.ts';
import {
  estimateFor,
  readBuildState,
  updateEstimate,
  writeBuildState,
} from '../../services/provider-support/build-engine-support.ts';

const ANDROID_ESTIMATE_KIND = 'default';

function makeGradleFailure(message: string) {
  return makeProviderInputFailure({ provider: 'gradle', message });
}

export function gradleBuildArguments(
  assembleTask: string,
  cleanBuilt: boolean,
  keystore: KeystoreAssets,
): string[] {
  const gradleArguments: string[] = [];

  if (cleanBuilt) {
    gradleArguments.push(':app:clean');
  }

  gradleArguments.push(
    assembleTask,
    '--build-cache',
    `-Pandroid.injected.signing.store.file=${keystore.path}`,
    `-Pandroid.injected.signing.key.alias=${keystore.alias}`,
  );

  return gradleArguments;
}

async function gradleWrapper(androidDirectory: string): Promise<string> {
  const operatingSystem = detectHostOperatingSystem();
  let wrapperName = 'gradlew';

  const isWindows = operatingSystem == 'windows';

  if (isWindows) {
    wrapperName = 'gradlew.bat';
  }

  const wrapperPath = join(androidDirectory, wrapperName);

  const wrapperExists = await pathExists(wrapperPath);

  if (wrapperExists) {
    return wrapperPath;
  }

  throw makeGradleFailure(`No Gradle wrapper at ${wrapperPath} - did prebuild run?`);
}

function endsWithExtension(extension: string): (fileName: string) => boolean {
  function hasExtension(fileName: string): boolean {
    return fileName.endsWith(extension);
  }

  return hasExtension;
}

async function findReleaseArtifact(
  androidDirectory: string,
  artifactKind: 'apk' | 'bundle',
): Promise<string> {
  let extension = '.aab';
  let taskName = 'bundleRelease';

  const isApk = artifactKind == 'apk';

  if (isApk) {
    extension = '.apk';
    taskName = 'assembleRelease';
  }

  const releaseDirectory = join(
    androidDirectory,
    'app',
    'build',
    'outputs',
    artifactKind,
    'release',
  );
  const releaseDirectoryExists = await pathExists(releaseDirectory);

  if (releaseDirectoryExists == false) {
    throw makeGradleFailure(
      `Gradle produced no ${artifactKind} release directory (${releaseDirectory}).`,
    );
  }

  const releaseNames = await readdir(releaseDirectory);
  const artifactName = releaseNames.find(endsWithExtension(extension));

  if (artifactName != null) {
    return join(releaseDirectory, artifactName);
  }

  throw makeGradleFailure(`No ${extension} found in ${releaseDirectory} after ${taskName}.`);
}

function isFilledLine(line: string): boolean {
  return line.trim().length > 0;
}

function trimCell(cell: string): string {
  return cell.trim().toUpperCase();
}

export function parseBundletoolSize(csv: string): { minBytes: number; maxBytes: number } {
  const lines = csv.trim().split(/\r?\n/).filter(isFilledLine);
  const hasSizeRows = lines.length >= 2;

  if (hasSizeRows == false) {
    return { minBytes: 0, maxBytes: 0 };
  }

  const headerLine = lines[0];

  if (headerLine == null) {
    return { minBytes: 0, maxBytes: 0 };
  }

  const header = headerLine.split(',').map(trimCell);
  const minColumn = header.indexOf('MIN');
  const maxColumn = header.indexOf('MAX');

  const isMinMissing = minColumn == -1;

  if (isMinMissing) {
    return { minBytes: 0, maxBytes: 0 };
  }

  const isMaxMissing = maxColumn == -1;

  if (isMaxMissing) {
    return { minBytes: 0, maxBytes: 0 };
  }

  let minBytes = Number.POSITIVE_INFINITY;
  let maxBytes = 0;

  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const minimumCell = cells[minColumn];
    const maximumCell = cells[maxColumn];

    if (minimumCell == null) {
      continue;
    }

    if (maximumCell == null) {
      continue;
    }

    const parsedMinimum = Number.parseInt(minimumCell, 10);
    const parsedMaximum = Number.parseInt(maximumCell, 10);

    const minimumIsNumber = Number.isNaN(parsedMinimum) == false;

    if (minimumIsNumber) {
      minBytes = Math.min(minBytes, parsedMinimum);
    }

    const maximumIsNumber = Number.isNaN(parsedMaximum) == false;

    if (maximumIsNumber) {
      maxBytes = Math.max(maxBytes, parsedMaximum);
    }
  }

  const minimumIsFinite = Number.isFinite(minBytes);

  if (minimumIsFinite == false) {
    minBytes = 0;
  }

  return { minBytes, maxBytes };
}

async function estimateDownload(
  aabPath: string,
  keystore: KeystoreAssets,
): Promise<SizeReportEntry[]> {
  const systemTemporaryDirectory = tmpdir();
  const launchAabPath = join(systemTemporaryDirectory, 'launch-aab-');
  const workingDirectory = await mkdtemp(launchAabPath);

  try {
    const apksPath = join(workingDirectory, 'app.apks');
    const storePasswordPath = join(workingDirectory, 'store-password');
    const keyPasswordPath = join(workingDirectory, 'key-password');

    await writeFile(storePasswordPath, keystore.storePassword, { mode: 0o600 });
    await writeFile(keyPasswordPath, keystore.keyPassword, { mode: 0o600 });
    await executeCommand('bundletool', [
      'build-apks',
      `--bundle=${aabPath}`,
      `--output=${apksPath}`,
      '--mode=default',
      `--ks=${keystore.path}`,
      `--ks-pass=file:${storePasswordPath}`,
      `--ks-key-alias=${keystore.alias}`,
      `--key-pass=file:${keyPasswordPath}`,
    ]);

    const sizeTable = await captureCommandOutput('bundletool', [
      'get-size',
      'total',
      `--apks=${apksPath}`,
      '--dimensions=ALL',
    ]);
    const parsedSize = parseBundletoolSize(sizeTable);
    const hasDownloadEstimate = parsedSize.maxBytes > 0;

    if (hasDownloadEstimate == false) {
      return [];
    }

    return [{ device: 'worst-case device', downloadBytes: parsedSize.maxBytes, installBytes: 0 }];
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

async function buildAndroidArtifact(
  buildContext: Parameters<BuildEngine['buildArtifact']>[0],
  buildCredentials: Parameters<BuildEngine['buildArtifact']>[1],
): ReturnType<BuildEngine['buildArtifact']> {
  if (buildContext.dryRun) {
    return {
      artifactPath: '(dry-run, not built)',
      sizeReport: { artifactBytes: 0, entries: [] },
      cleanBuilt: false,
    };
  }

  const isAndroidCredential = buildCredentials.platform == 'android';

  if (isAndroidCredential == false) {
    throw makeProviderInputFailure({
      provider: 'gradle',
      message: 'The gradle build engine builds Android only.',
    });
  }

  const keystore = buildCredentials.keystore;

  const isKeystoreMissing = keystore == null;

  if (isKeystoreMissing) {
    throw makeProviderInputFailure({
      provider: 'gradle',
      message:
        'No upload keystore resolved - run `launch-store creds setup --platform android --app <name>` first.',
    });
  }

  const androidDirectory = join(buildContext.app.dir, 'android');
  const wrapper = await gradleWrapper(androidDirectory);
  const cleanBuilt = buildContext.forceClean;
  const isInternalDistribution = buildContext.distribution == 'internal';
  let assembleTask = ':app:bundleRelease';

  if (isInternalDistribution) {
    assembleTask = ':app:assembleRelease';
  }

  const storedBuild = await readBuildState(buildContext.app.name, 'android');
  const estimate = estimateFor(storedBuild, ANDROID_ESTIMATE_KIND);
  const gradleArguments = gradleBuildArguments(assembleTask, cleanBuilt, keystore);
  const progressOptions: ProgressRunOptions = {
    label: `Building Android - ${buildContext.app.name}`,
    parseStep: gradleProgressStep,
    cwd: androidDirectory,
    env: {
      ...buildContext.env,
      'ORG_GRADLE_PROJECT_android.injected.signing.store.password': keystore.storePassword,
      'ORG_GRADLE_PROJECT_android.injected.signing.key.password': keystore.keyPassword,
    },
  };

  const hasEstimate = estimate != null;

  if (hasEstimate) {
    progressOptions.estimate = estimate;
  }

  const buildRun = await runWithProgress(wrapper, gradleArguments, progressOptions);
  const priorEstimate = storedBuild?.estimates?.[ANDROID_ESTIMATE_KIND];
  let priorStepCount = 0;

  if (priorEstimate?.steps != null) {
    priorStepCount = priorEstimate.steps;
  }

  let recordedStepCount = priorStepCount;

  const parsedSteps = buildRun.steps > 0;

  if (parsedSteps) {
    recordedStepCount = buildRun.steps;
  }

  let priorEstimates = {};

  if (storedBuild?.estimates != null) {
    priorEstimates = storedBuild.estimates;
  }

  await writeBuildState(buildContext.app.name, 'android', {
    fingerprint: '',
    builtAt: new Date().toISOString(),
    cleanBuilt,
    estimates: {
      ...priorEstimates,
      [ANDROID_ESTIMATE_KIND]: updateEstimate(priorEstimate, {
        ms: buildRun.elapsedMs,
        steps: recordedStepCount,
      }),
    },
  });

  if (isInternalDistribution) {
    const apkPath = await findReleaseArtifact(androidDirectory, 'apk');
    const apkStat = await stat(apkPath);
    const apkBytes = Number(apkStat.size);

    return {
      artifactPath: apkPath,
      sizeReport: {
        artifactBytes: apkBytes,
        entries: [{ device: 'apk', downloadBytes: apkBytes, installBytes: 0 }],
      },
      cleanBuilt,
    };
  }

  const artifactPath = await findReleaseArtifact(androidDirectory, 'bundle');
  const artifactStat = await stat(artifactPath);
  const artifactBytes = Number(artifactStat.size);
  const sizeEntries = await estimateDownload(artifactPath, keystore);

  return { artifactPath, sizeReport: { artifactBytes, entries: sizeEntries }, cleanBuilt };
}

const gradleBuildEngine: BuildEngine = {
  name: 'gradle',
  buildArtifact: buildAndroidArtifact,
};

export function makeGradleBuildEngine(): BuildEngine {
  return gradleBuildEngine;
}
