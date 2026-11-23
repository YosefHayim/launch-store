import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Platform } from '@/types/app.js';
import type { SizeReportEntry } from '@/types/artifacts.js';
import type { ResolvedBuildContext } from '@/types/config.js';
import type { BuildCredentials, SigningAssets } from '@/types/credentials.js';
import { makeProviderInputFailure, type BuildEngine } from '@/types/providers.js';
import {
  assertDeviceArtifact,
  exportOptionsPlist,
  parseThinningReport,
} from '@/services/provider-support/apple-artifact.js';
import {
  runWithProgress,
  xcodeProgressStep,
  type ProgressRunOptions,
} from '@/services/platform/progress.js';
import { checkCommandExists } from '@/services/platform/exec.js';
import { readHostResources } from '@/services/platform/os.js';
import { pathExists } from '@/path-exists.js';
import {
  assembleArchiveArguments,
  assembleExportArguments,
  computeParallelJobLimit,
  estimateFor,
  gatherIosFingerprint,
  readBuildState,
  resolveCcacheEnvironment,
  resolveClean,
  updateEstimate,
  writeBuildState,
  writeManualSigningToProject,
} from '@/services/provider-support/build-engine-support.js';
import {
  appleArtifactExtension,
  archiveDestination,
  isApplePlatform,
  nativeProjectDirName,
  platformLabel,
} from '@/services/stores/platform.js';

/** Resolve an app's native Xcode project directory to an absolute path. */
export function resolveNativeDir(appDirectory: string, platform: Platform): string {
  const nativeDirectoryName = nativeProjectDirName(platform);

  return resolve(appDirectory, nativeDirectoryName);
}

function isXcworkspaceName(fileName: string): boolean {
  return fileName.endsWith('.xcworkspace');
}

async function findWorkspace(
  nativeDirectory: string,
): Promise<{ workspace: string; scheme: string }> {
  const nativeDirectoryExists = await pathExists(nativeDirectory);

  if (nativeDirectoryExists == false) {
    throw makeProviderInputFailure({
      provider: 'xcode',
      message: `No native project directory at ${nativeDirectory} - did prebuild run?`,
    });
  }

  const directoryNames = await readdir(nativeDirectory);
  const workspaceName = directoryNames.find(isXcworkspaceName);

  if (workspaceName == null) {
    throw makeProviderInputFailure({
      provider: 'xcode',
      message: `No .xcworkspace found in ${nativeDirectory}.`,
    });
  }

  return {
    workspace: join(nativeDirectory, workspaceName),
    scheme: workspaceName.replace(/\.xcworkspace$/, ''),
  };
}

async function stampManualSigning(nativeDirectory: string, signing: SigningAssets): Promise<void> {
  try {
    await writeManualSigningToProject(nativeDirectory, {
      teamId: signing.teamId,
      profileByBundleId: {
        [signing.bundleId]: signing.profileName,
        ...signing.extensionProfiles,
      },
    });
  } catch (cause) {
    const asString = String(cause);

    throw makeProviderInputFailure({
      provider: 'xcode',
      message: `Could not configure manual signing in ${nativeDirectory}: ${asString}`,
    });
  }
}

export function xcodebuildEnv(
  buildEnvironment: Record<string, string>,
  ccacheVariables: Record<string, string>,
): Record<string, string> {
  return {
    ...buildEnvironment,
    ...ccacheVariables,
  };
}

function endsWithArchiveExtension(archiveExtension: string): (fileName: string) => boolean {
  function hasArchiveExtension(fileName: string): boolean {
    return fileName.endsWith(`.${archiveExtension}`);
  }

  return hasArchiveExtension;
}

async function installPods(
  nativeDirectory: string,
  buildEnvironment: Record<string, string>,
  ccacheVariables: Record<string, string>,
): Promise<void> {
  await runWithProgress('pod', ['install'], {
    label: 'Pods',
    cwd: nativeDirectory,
    env: { ...buildEnvironment, ...ccacheVariables, RCT_IGNORE_PODS_DEPRECATION: '1' },
  });
}

async function buildAppleArtifact(
  buildContext: ResolvedBuildContext,
  buildCredentials: BuildCredentials,
): Promise<{
  artifactPath: string;
  sizeReport: { artifactBytes: number; entries: SizeReportEntry[] };
  cleanBuilt: boolean;
}> {
  if (buildContext.dryRun) {
    return {
      artifactPath: '(dry-run, not built)',
      sizeReport: { artifactBytes: 0, entries: [] },
      cleanBuilt: false,
    };
  }

  const isAppleCredential = buildCredentials.platform == 'ios';

  if (isAppleCredential == false) {
    throw makeProviderInputFailure({
      provider: 'xcode',
      message: 'The xcode build engine builds Apple platforms only.',
    });
  }

  const isAppleBuild = isApplePlatform(buildContext.platform);

  if (isAppleBuild == false) {
    throw makeProviderInputFailure({
      provider: 'xcode',
      message: `The xcode build engine cannot build ${buildContext.platform}.`,
    });
  }

  const signing = buildCredentials.signing;

  const isSigningMissing = signing == null;

  if (isSigningMissing) {
    throw makeProviderInputFailure({
      provider: 'xcode',
      message: 'No signing assets resolved - run `launch-store creds setup` first.',
    });
  }

  const nativeDirectory = resolveNativeDir(buildContext.app.dir, buildContext.platform);
  const workspaceAndScheme = await findWorkspace(nativeDirectory);
  const fingerprint = await gatherIosFingerprint(nativeDirectory, buildContext.app.configPath);
  const storedBuild = await readBuildState(buildContext.app.name, buildContext.platform);
  const cleanDecision = resolveClean(buildContext.forceClean, storedBuild, fingerprint);
  let buildKind: 'clean' | 'incremental' = 'incremental';

  if (cleanDecision.clean) {
    buildKind = 'clean';
  }

  const estimate = estimateFor(storedBuild, buildKind);
  const hasCcache = await checkCommandExists('ccache');
  let ccacheVariables: Record<string, string> = {};

  if (hasCcache) {
    const ccacheDisabled = buildContext.ccache == false;
    ccacheVariables = await resolveCcacheEnvironment(ccacheDisabled);
  }

  const nativeDependenciesChanged = cleanDecision.nativeChanged;

  if (nativeDependenciesChanged) {
    await installPods(nativeDirectory, buildContext.env, ccacheVariables);
  }

  const podsDirectory = join(nativeDirectory, 'Pods');
  const podsInstalled = await pathExists(podsDirectory);

  const shouldInstallMissingPods = nativeDependenciesChanged == false;

  if (shouldInstallMissingPods) {
    const podsAreMissing = podsInstalled == false;

    if (podsAreMissing) {
      await installPods(nativeDirectory, buildContext.env, ccacheVariables);
    }
  }

  await stampManualSigning(nativeDirectory, signing);

  const hostResources = readHostResources();
  const parallelJobLimit = await computeParallelJobLimit(
    hostResources.cores,
    hostResources.memoryBytes,
  );
  const systemTemporaryDirectory = tmpdir();
  const launchBuildPath = join(systemTemporaryDirectory, 'launch-build-');
  const outputDirectory = await mkdtemp(launchBuildPath);
  const plistPath = join(outputDirectory, 'ExportOptions.plist');
  let exportMethod: 'app-store' | 'ad-hoc' = 'app-store';

  const isInternalDistribution = buildContext.distribution == 'internal';

  if (isInternalDistribution) {
    exportMethod = 'ad-hoc';
  }

  const exportPlist = exportOptionsPlist(signing, exportMethod);

  await writeFile(plistPath, exportPlist);

  const archiveExtension = appleArtifactExtension(buildContext.platform);
  const buildDestination = archiveDestination(buildContext.platform);
  const archivePath = join(outputDirectory, `${buildContext.app.name}.xcarchive`);
  const archiveArguments = await assembleArchiveArguments({
    workspace: workspaceAndScheme.workspace,
    scheme: workspaceAndScheme.scheme,
    archivePath,
    signing,
    parallelJobLimit,
    shouldCleanBuild: cleanDecision.clean,
    buildDestination,
  });
  const exportArguments = await assembleExportArguments({
    archivePath,
    exportOptionsPath: plistPath,
    exportPath: outputDirectory,
  });
  const buildEnvironment = xcodebuildEnv(buildContext.env, ccacheVariables);
  const progressOptions: ProgressRunOptions = {
    label: `Building ${platformLabel(buildContext.platform)} - ${buildContext.app.name}`,
    parseStep: xcodeProgressStep,
    cwd: buildContext.app.dir,
    env: buildEnvironment,
  };

  const hasEstimate = estimate != null;

  if (hasEstimate) {
    progressOptions.estimate = estimate;
  }

  const buildRun = await runWithProgress('xcodebuild', archiveArguments, progressOptions);

  await runWithProgress('xcodebuild', exportArguments, {
    label: `Exporting ${platformLabel(buildContext.platform)} - ${buildContext.app.name}`,
    parseStep: xcodeProgressStep,
    cwd: buildContext.app.dir,
    env: buildEnvironment,
  });

  const outputNames = await readdir(outputDirectory);
  const archiveName = outputNames.find(endsWithArchiveExtension(archiveExtension));

  if (archiveName == null) {
    throw makeProviderInputFailure({
      provider: 'xcode',
      message: `xcodebuild export finished but produced no .${archiveExtension} in ${outputDirectory}.`,
    });
  }

  const artifactPath = join(outputDirectory, archiveName);
  const artifactStat = await stat(artifactPath);
  const archiveBytes = Number(artifactStat.size);

  assertDeviceArtifact(artifactPath, archiveBytes, buildContext.platform);

  const priorEstimate = storedBuild?.estimates?.[buildKind];
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

  await writeBuildState(buildContext.app.name, buildContext.platform, {
    fingerprint,
    builtAt: new Date().toISOString(),
    cleanBuilt: cleanDecision.clean,
    estimates: {
      ...priorEstimates,
      [buildKind]: updateEstimate(priorEstimate, {
        ms: buildRun.elapsedMs,
        steps: recordedStepCount,
      }),
    },
  });

  const reportPath = join(outputDirectory, 'App Thinning Size Report.txt');
  let sizeEntries: SizeReportEntry[] = [];

  const reportExists = await pathExists(reportPath);

  if (reportExists) {
    const reportText = await readFile(reportPath, 'utf8');
    sizeEntries = parseThinningReport(reportText);
  }

  return {
    artifactPath,
    sizeReport: { artifactBytes: archiveBytes, entries: sizeEntries },
    cleanBuilt: cleanDecision.clean,
  };
}

const xcodeBuildEngine: BuildEngine = {
  name: 'xcode',
  buildArtifact: buildAppleArtifact,
};

export function makeXcodeBuildEngine(): BuildEngine {
  return xcodeBuildEngine;
}
