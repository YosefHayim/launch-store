/**
 * The single source of the compile-tuning flags Launch adds on top of a stock `gym` build, shared by
 * the local engine (`providers/build/fastlane.ts`) and the remote script (`core/remoteBuild.ts`) so the
 * two never drift. Three independent knobs: a RAM-aware parallelism cap, the ccache wiring env, and the
 * always-on xcargs (kill the index store, plus the cap when set). None are user-configurable — caching's
 * best answer is "on", so these ship as defaults, not `launch.config.ts` fields (YAGNI).
 */

import type { SigningAssets } from './types.js';

/**
 * RAM-aware compile-parallelism cap. `xcodebuild` spawns one compile per logical core by default, which
 * over-subscribes RAM on memory-constrained machines and pages to swap. Cap at `floor(totalGB / 2)`,
 * floored at 2 and never above the core count. Returns `undefined` when the cap equals the core count
 * (no benefit to passing `-jobs` — let `xcodebuild` use its default).
 */
export function computeBuildJobs(cores: number, memBytes: number): number | undefined {
  const totalGB = memBytes / 1024 ** 3;
  const cap = Math.min(Math.max(Math.floor(totalGB / 2), 2), cores);
  return cap < cores ? cap : undefined;
}

/**
 * The environment that wires ccache into a build. ccache's compiler shim is baked into the Pods xcconfig
 * at `pod install` time (RN's `react_native_post_install(:ccache_enabled)`, gated on `USE_CCACHE`). The
 * cache itself lives at ccache's own default directory — shared cross-tool and sized/cleared by
 * `launch doctor` — so Launch sets only the wiring flag and never overrides `CCACHE_DIR`.
 */
export function ccacheEnv(): { USE_CCACHE: string } {
  return { USE_CCACHE: '1' };
}

/**
 * The non-signing xcargs Launch always appends: disable the compiler index store (it only powers Xcode
 * autocomplete; a headless build never reads it) and cap parallelism when {@link computeBuildJobs} set
 * one. Shared verbatim with the remote build via env, where the bash script appends it to its own xcargs.
 */
export function xcargsExtra(jobs: number | undefined): string {
  const parts = ['COMPILER_INDEX_STORE_ENABLE=NO'];
  if (jobs !== undefined) parts.push(`-jobs ${jobs}`);
  return parts.join(' ');
}

/**
 * Assemble the full local `gym --xcargs` string: the manual-signing settings (so the resolved cert +
 * profile sign the archive, no surprises) followed by the shared {@link xcargsExtra}.
 *
 * `DEVELOPMENT_TEAM` and `CODE_SIGN_STYLE=Manual` are legitimately global — one team signs the whole
 * archive, manually, for every target. `PROVISIONING_PROFILE_SPECIFIER` is the subtle one: a value
 * passed on the command line applies to **every** target (xcodebuild has no per-target `--xcargs` form),
 * which is exactly right for a single-target app — pin the one resolved profile — but WRONG once the app
 * embeds an extension target. The main app's profile can't sign the widget/extension bundle (its app-id
 * differs), so one global specifier makes the whole archive fail with exit 65 *before* export. For a
 * multi-target app each target's profile is supplied instead by the project's own manual-signing settings
 * and mapped per-bundle at export ({@link import("../providers/build/fastlane.js").exportOptionsPlist}
 * folds {@link SigningAssets.extensionProfiles}), so the global specifier is **dropped** when
 * {@link SigningAssets.extensionProfiles} is present. Whether a real multi-target archive additionally
 * needs each target's profile written into the pbxproj is project-dependent and operator-verified on a
 * live widget-app build (issue #262); removing the clobbering global specifier is the piece that has to be
 * right here, and the single-target string stays byte-identical.
 */
export function buildXcargs(
  signing: Pick<SigningAssets, 'teamId' | 'profileName' | 'extensionProfiles'>,
  jobs: number | undefined,
): string {
  const parts = [`DEVELOPMENT_TEAM=${signing.teamId}`, 'CODE_SIGN_STYLE=Manual'];
  // Pin the one global profile only when there's no extension target for it to clobber (the common case).
  const multiTarget =
    signing.extensionProfiles !== undefined && Object.keys(signing.extensionProfiles).length > 0;
  if (!multiTarget) parts.push(`PROVISIONING_PROFILE_SPECIFIER=${signing.profileName}`);
  return `${parts.join(' ')} ${xcargsExtra(jobs)}`;
}

/**
 * The inputs to one `fastlane gym` invocation, already resolved by the build engine. Kept as a flat record
 * (not the whole {@link import("./types.js").ResolvedBuildContext}) so {@link gymArgs} stays a pure,
 * unit-testable mapping from values to an argv array.
 */
export interface GymArgsInput {
  /** Absolute path to the `.xcworkspace`. */
  workspace: string;
  /** Scheme to archive (derived from the workspace name). */
  scheme: string;
  /** Directory gym writes the export + thinning report into. */
  outputDir: string;
  /** Output filename gym gives the exported archive (e.g. `MyApp.ipa`, `MyApp.pkg`). */
  outputName: string;
  /** Absolute path to the manual-signing `ExportOptions.plist`. */
  exportOptionsPath: string;
  /**
   * Resolved signing assets — the codesigning identity and the manual-signing xcargs come from here.
   * Carrying {@link SigningAssets.extensionProfiles} lets {@link buildXcargs} tell a single-target app
   * (pin the global profile) from a multi-target one (drop it so an extension isn't clobbered at archive).
   */
  signing: Pick<SigningAssets, 'teamId' | 'profileName' | 'certName' | 'extensionProfiles'>;
  /** RAM-aware parallelism cap from {@link computeBuildJobs}, or `undefined` to let xcodebuild decide. */
  jobs: number | undefined;
  /** Whether to pass `--clean` (clean vs incremental, decided by the build fingerprint). */
  clean: boolean;
  /**
   * Xcode build destination from {@link import("./platform.js").gymDestination}. `undefined` for iOS
   * (xcodebuild's default) so the `--destination` flag is omitted and the iOS argv stays byte-identical
   * to before cross-platform builds existed; tvOS/macOS/visionOS pass their `generic/platform=…`.
   */
  destination: string | undefined;
}

/**
 * Build the full `fastlane gym` argv. The single source of the gym command for the local build engine,
 * extracted so the iOS arg vector is pinned by a test and the only cross-platform difference — the
 * `--destination` flag — is appended **only when defined**. Order is fixed (config flags, then signing,
 * then `--destination`, then `--clean` last) so the iOS output is identical with `destination: undefined`.
 */
export function gymArgs(input: GymArgsInput): string[] {
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
    buildXcargs(input.signing, input.jobs),
    ...(input.destination !== undefined ? ['--destination', input.destination] : []),
    ...(input.clean ? ['--clean'] : []),
  ];
}
