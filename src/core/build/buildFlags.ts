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
export const buildExtraXcargs = (parallelJobLimit: number | undefined) =>
  Effect.sync(() => {
    const parts = ['COMPILER_INDEX_STORE_ENABLE=NO'];
    if (parallelJobLimit !== undefined) parts.push(`-jobs ${parallelJobLimit}`);
    return parts.join(' ');
  });
export const buildSigningXcargs = (
  signing: Pick<SigningAssets, 'teamId'>,
  parallelJobLimit: number | undefined,
) =>
  Effect.gen(function* () {
    const parts = [`DEVELOPMENT_TEAM=${signing.teamId}`, 'CODE_SIGN_STYLE=Manual'];
    const extraXcargs = yield* buildExtraXcargs(parallelJobLimit);
    return `${parts.join(' ')} ${extraXcargs}`;
  });
/** Inputs to one `fastlane gym` invocation, already resolved by the build engine. */
export type GymArgsInput = {
  workspace: string;
  scheme: string;
  outputDir: string;
  outputName: string;
  exportOptionsPath: string;
  signing: Pick<SigningAssets, 'teamId' | 'certName'>;
  parallelJobLimit: number | undefined;
  shouldCleanBuild: boolean;
  buildDestination: string | undefined;
};
export const assembleGymArguments = (input: GymArgsInput) =>
  Effect.gen(function* () {
    const signingXcargs = yield* buildSigningXcargs(input.signing, input.parallelJobLimit);
    const gymArguments = [
      'gym',
      '--workspace',
      input.workspace,
      '--scheme',
      input.scheme,
      '--output_directory',
      input.outputDir,
      '--output_name',
      input.outputName,
      '--export_options',
      input.exportOptionsPath,
      '--codesigning_identity',
      input.signing.certName,
      '--xcargs',
      signingXcargs,
    ];
    if (input.buildDestination !== undefined)
      gymArguments.push('--destination', input.buildDestination);
    if (input.shouldCleanBuild) gymArguments.push('--clean');
    return gymArguments;
  });
