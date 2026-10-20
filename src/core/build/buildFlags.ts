import { Effect } from 'effect';
import type { SigningAssets } from '../types/credentials.js';
import { LaunchEnvironment } from '../services/environment.js';
export const computeParallelJobLimit = (availableCores: number, totalMemoryBytes: number) =>
  Effect.sync(() => {
    const totalMemoryGB = totalMemoryBytes / 1024 ** 3;
    const ramBasedCap = Math.floor(totalMemoryGB / 2);
    const clampedJobLimit = Math.min(Math.max(ramBasedCap, 2), availableCores);
    if (clampedJobLimit < availableCores) return clampedJobLimit;
    return undefined;
  });
export const resolveCcacheEnvironment = (disabled?: boolean) =>
  Effect.gen(function* () {
    const environment = yield* LaunchEnvironment;
    if (disabled === true) return {};
    if (environment.values.ccacheSetting === '0') return {};
    return { USE_CCACHE: '1' };
  });
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
export type ExportArgsInput = {
  archivePath: string;
  exportOptionsPath: string;
  exportPath: string;
};
/**
 * The `xcodebuild archive` argv. Signing is manual and never carries a global
 * `PROVISIONING_PROFILE_SPECIFIER`: each signed target holds its own profile in the pbxproj (issue #301).
 */
export const assembleArchiveArguments = (input: ArchiveArgsInput) =>
  Effect.sync(() => {
    const archiveArguments = [
      '-workspace',
      input.workspace,
      '-scheme',
      input.scheme,
      '-configuration',
      'Release',
      '-archivePath',
      input.archivePath,
      '-destination',
      input.buildDestination,
      `DEVELOPMENT_TEAM=${input.signing.teamId}`,
      'CODE_SIGN_STYLE=Manual',
      `CODE_SIGN_IDENTITY=${input.signing.certName}`,
      'COMPILER_INDEX_STORE_ENABLE=NO',
    ];
    if (input.parallelJobLimit !== undefined)
      archiveArguments.push('-jobs', String(input.parallelJobLimit));
    if (input.shouldCleanBuild) archiveArguments.push('clean');
    archiveArguments.push('archive');
    return archiveArguments;
  });
export const assembleExportArguments = (input: ExportArgsInput) =>
  Effect.sync(() => [
    '-exportArchive',
    '-archivePath',
    input.archivePath,
    '-exportOptionsPlist',
    input.exportOptionsPath,
    '-exportPath',
    input.exportPath,
  ]);
