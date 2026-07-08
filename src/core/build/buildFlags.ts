/**
 * The single source of the compile-tuning flags Launch adds on top of a stock `gym` build, shared by
 * the local engine (`providers/build/fastlane.ts`) and the remote script (`core/remoteBuild.ts`) so the
 * two never drift. Three independent knobs: a RAM-aware parallelism cap, the ccache wiring env, and the
 * always-on xcargs (kill the index store, plus the cap when set). Ccache is on by default but can be
 * disabled per run when a native target cannot use React Native's ccache shim.
 */

import { Effect } from 'effect';
import type { SigningAssets } from '../types/index.js';
import process from 'node:process';

/**
 * RAM-aware compile-parallelism cap. `xcodebuild` spawns one compile per logical core by default, which
 * over-subscribes RAM on memory-constrained machines. Cap at `floor(totalGB / 2)`, floored at 2 and
 * never above the core count. Returns `undefined` when the cap equals the core count (no benefit to
 * passing `-jobs`).
 *
 * @param availableCores - Logical CPU count available to xcodebuild.
 * @param totalMemoryBytes - Total host memory in bytes.
 * @returns An Effect that succeeds with the `-jobs` cap, or undefined when xcodebuild's default is fine.
 */
export const computeParallelJobLimit = (availableCores: number, totalMemoryBytes: number) =>
  Effect.sync(() => {
    const totalMemoryGB = totalMemoryBytes / 1024 ** 3;
    const ramBasedCap = Math.floor(totalMemoryGB / 2);
    const clampedJobLimit = Math.min(Math.max(ramBasedCap, 2), availableCores);
    return clampedJobLimit < availableCores ? clampedJobLimit : undefined;
  });

/**
 * The environment that wires ccache into a build. ccache's compiler shim is baked into the Pods xcconfig
 * at `pod install` time. Opt-out: if `USE_CCACHE` is already set to `'0'` in the environment, the
 * caller's value wins — this lets builds that break under ccache disable it without patching Podfiles.
 * The `disabled` parameter also disables it (from `--no-ccache` / config).
 *
 * @param disabled - Whether this build explicitly disabled ccache.
 * @returns An Effect that succeeds with ccache env vars, or an empty object when ccache is disabled.
 */
export const resolveCcacheEnvironment = (disabled?: boolean) =>
  Effect.sync((): Record<string, string> => {
    if (disabled || process.env['USE_CCACHE'] === '0') return {};
    return { USE_CCACHE: '1' };
  });

/**
 * The non-signing xcargs Launch always appends: disable the compiler index store (it only powers Xcode
 * autocomplete; a headless build never reads it) and cap parallelism when set.
 *
 * @param parallelJobLimit - Optional `xcodebuild -jobs` cap.
 * @returns An Effect that succeeds with the shared non-signing xcargs string.
 */
export const buildExtraXcargs = (parallelJobLimit: number | undefined) =>
  Effect.sync(() => {
    const parts = ['COMPILER_INDEX_STORE_ENABLE=NO'];
    if (parallelJobLimit !== undefined) parts.push(`-jobs ${parallelJobLimit}`);
    return parts.join(' ');
  });

/**
 * Assemble the full local `gym --xcargs` string: the workspace-wide signing settings that are safe on
 * EVERY target, followed by the shared extra xcargs.
 *
 * Only the team and the manual-signing STYLE go here — never `PROVISIONING_PROFILE_SPECIFIER`. A
 * command-line xcarg applies to the whole workspace, so a global profile specifier lands on every
 * CocoaPods library target too. Xcode 26 rejects a manual profile on a target that can't be provisioned
 * and fails the archive with 39× "… does not support provisioning profiles" (exit 65), even for a plain
 * single-target app — and because command-line settings outrank per-target ones, a Podfile `post_install`
 * can't override it (issue #301). The app's profile is instead written into the app target's own Release
 * build settings in the pbxproj before the archive (see
 * {@link import("./appleTargets.js").writeManualSigningToProject}), so gym reads it from the app target
 * while the Pods keep their default signing.
 *
 * @param signing - Resolved signing values that feed the `gym --xcargs` string.
 * @param parallelJobLimit - Optional `xcodebuild -jobs` cap.
 * @returns An Effect that succeeds with the manual-signing xcargs string.
 */
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
export interface GymArgsInput {
  /** Absolute path to the `.xcworkspace`. */
  workspace: string;
  /** Scheme to archive. */
  scheme: string;
  /** Directory gym writes the export + thinning report into. */
  outputDir: string;
  /** Output filename gym gives the exported archive. */
  outputName: string;
  /** Absolute path to the manual-signing `ExportOptions.plist`. */
  exportOptionsPath: string;
  /**
   * Resolved signing values the gym argv needs: the codesigning identity (`--codesigning_identity`) and
   * the team for the shared xcargs. The per-target provisioning profile is stamped into the app target's
   * pbxproj (see {@link import("./appleTargets.js").writeManualSigningToProject}), never passed here.
   */
  signing: Pick<SigningAssets, 'teamId' | 'certName'>;
  /** RAM-aware parallelism cap, or `undefined` to let xcodebuild decide. */
  parallelJobLimit: number | undefined;
  /** Whether to pass `--clean`. */
  shouldCleanBuild: boolean;
  /** Xcode build destination (`undefined` for iOS — the default). */
  buildDestination: string | undefined;
}

/**
 * Build the full `fastlane gym` argv. The single source of the gym command for the local build engine.
 * Order is fixed (config flags → signing → destination → clean) so iOS output is byte-identical with
 * `buildDestination: undefined`.
 *
 * @param input - Resolved values for one `fastlane gym` invocation.
 * @returns An Effect that succeeds with the complete `fastlane` argv.
 */
export const assembleGymArguments = (input: GymArgsInput) =>
  Effect.gen(function* () {
    const signingXcargs = yield* buildSigningXcargs(input.signing, input.parallelJobLimit);
    return [
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
      ...(input.buildDestination === undefined ? [] : ['--destination', input.buildDestination]),
      ...(input.shouldCleanBuild ? ['--clean'] : []),
    ];
  });
