import type { SigningAssets } from '../types/credentials.ts';
import { readLaunchEnvironment } from '../services/platform/environment.ts';

export function computeParallelJobLimit(
  availableCores: number,
  totalMemoryBytes: number,
): number | undefined {
  const bytesPerGigabyte = 1024 ** 3;
  const totalMemoryGB = totalMemoryBytes / bytesPerGigabyte;
  const ramBasedCap = Math.floor(totalMemoryGB / 2);
  const minimumJobLimit = 2;
  const clampedJobLimit = Math.min(Math.max(ramBasedCap, minimumJobLimit), availableCores);
  const isBelowCoreCount = clampedJobLimit < availableCores;

  if (isBelowCoreCount) {
    return clampedJobLimit;
  }

  return undefined;
}

export function resolveCcacheEnvironment(disabled?: boolean): Record<string, string> {
  const launchEnvironment = readLaunchEnvironment();
  const isDisabled = disabled == true;

  if (isDisabled) {
    return {};
  }

  const isCcacheOff = launchEnvironment.values.ccacheSetting == '0';

  if (isCcacheOff) {
    return {};
  }

  return { USE_CCACHE: '1' };
}

/** Inputs to the `xcodebuild archive` invocation, already resolved by the build engine. */
export type ArchiveArgsInput = {
  workspace: string;
  scheme: string;
  archivePath: string;
  signing: Pick<SigningAssets, 'teamId' | 'certName'>;
  parallelJobLimit: number | undefined;
  shouldCleanBuild: boolean;
  buildDestination: string;
};

/** Inputs to the `xcodebuild -exportArchive` invocation. */
type ExportArgsInput = {
  archivePath: string;
  exportOptionsPath: string;
  exportPath: string;
};

/**
 * The `xcodebuild archive` argv. Signing is manual and never carries a global
 * `PROVISIONING_PROFILE_SPECIFIER`: each signed target holds its own profile in the pbxproj (issue #301).
 */
export function assembleArchiveArguments(archiveInput: ArchiveArgsInput): string[] {
  const archiveArguments = [
    '-workspace',
    archiveInput.workspace,
    '-scheme',
    archiveInput.scheme,
    '-configuration',
    'Release',
    '-archivePath',
    archiveInput.archivePath,
    '-destination',
    archiveInput.buildDestination,
    `DEVELOPMENT_TEAM=${archiveInput.signing.teamId}`,
    'CODE_SIGN_STYLE=Manual',
    `CODE_SIGN_IDENTITY=${archiveInput.signing.certName}`,
    'COMPILER_INDEX_STORE_ENABLE=NO',
  ];
  const hasParallelJobLimit = archiveInput.parallelJobLimit != null;

  if (hasParallelJobLimit) {
    archiveArguments.push('-jobs', String(archiveInput.parallelJobLimit));
  }

  const shouldCleanBuild = archiveInput.shouldCleanBuild == true;

  if (shouldCleanBuild) {
    archiveArguments.push('clean');
  }

  archiveArguments.push('archive');

  return archiveArguments;
}

export function assembleExportArguments(exportInput: ExportArgsInput): string[] {
  return [
    '-exportArchive',
    '-archivePath',
    exportInput.archivePath,
    '-exportOptionsPlist',
    exportInput.exportOptionsPath,
    '-exportPath',
    exportInput.exportPath,
  ];
}
