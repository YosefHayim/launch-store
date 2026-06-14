/**
 * The single source of the compile-tuning flags Launch adds on top of a stock `gym` build, shared by
 * the local engine (`providers/build/fastlane.ts`) and the remote script (`core/remoteBuild.ts`) so the
 * two never drift. Three independent knobs: a RAM-aware parallelism cap, the ccache wiring env, and the
 * always-on xcargs (kill the index store, plus the cap when set). None are user-configurable — caching's
 * best answer is "on", so these ship as defaults, not `launch.config.ts` fields (YAGNI).
 */

import type { SigningAssets } from "./types.js";

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
  return { USE_CCACHE: "1" };
}

/**
 * The non-signing xcargs Launch always appends: disable the compiler index store (it only powers Xcode
 * autocomplete; a headless build never reads it) and cap parallelism when {@link computeBuildJobs} set
 * one. Shared verbatim with the remote build via env, where the bash script appends it to its own xcargs.
 */
export function xcargsExtra(jobs: number | undefined): string {
  const parts = ["COMPILER_INDEX_STORE_ENABLE=NO"];
  if (jobs !== undefined) parts.push(`-jobs ${jobs}`);
  return parts.join(" ");
}

/**
 * Assemble the full local `gym --xcargs` string: the manual-signing settings (so the resolved cert +
 * profile sign the archive, no surprises) followed by the shared {@link xcargsExtra}.
 */
export function buildXcargs(signing: Pick<SigningAssets, "teamId" | "profileName">, jobs: number | undefined): string {
  const signingArgs = `DEVELOPMENT_TEAM=${signing.teamId} CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=${signing.profileName}`;
  return `${signingArgs} ${xcargsExtra(jobs)}`;
}
