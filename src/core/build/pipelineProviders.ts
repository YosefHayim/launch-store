/**
 * Provider-name resolution and multi-store submit helpers for the build pipeline.
 *
 * Pure-ish selection of build engines and submitters from config, plus the submit fan-out loop.
 * Kept separate from the platform spines so config-driven provider swaps never touch build steps.
 */

import type {
  AndroidReleaseOptions,
  BuildCredentials,
  BuildProfile,
  LaunchConfig,
  Platform,
  PlayTrack,
  RemoteTarget,
  ResolvedBuildContext,
  SubmitTarget,
} from '../types/index.js';
import { getSubmitter } from '../services/registry.js';
import { platformLabel } from '../services/platform.js';
import {
  DEFAULT_SIZE_BUDGET_MB,
  type BuildRunOptions,
  type BuildTransportChoice,
} from './pipelineTypes.js';

/** The built-in iOS provider defaults that `config` carries by default, and their Android twins. */
const IOS_BUILD_ENGINE = 'fastlane';
const IOS_SUBMITTER = 'app-store-connect';
const ANDROID_BUILD_ENGINE = 'gradle';
const ANDROID_SUBMITTER = 'google-play';

/** The build engine name for a platform, swapping the iOS baseline default (`fastlane`) for `gradle` on Android. */
export function resolveBuildEngineName(config: LaunchConfig, platform: Platform): string {
  if (platform === 'android' && config.buildEngine === IOS_BUILD_ENGINE)
    return ANDROID_BUILD_ENGINE;
  return config.buildEngine;
}

/** The standard store for a platform: Play for Android, App Store Connect for every Apple platform. */
function defaultSubmitter(platform: Platform): string {
  return platform === 'android' ? ANDROID_SUBMITTER : IOS_SUBMITTER;
}

/**
 * The store(s) a build for `platform` is submitted to — the seam that decouples the build target from the
 * store, so one build can reach several. Two `config.submit` shapes resolve here:
 *
 * - a **string** (the original shape) yields exactly one store: the configured submitter, mapped to
 *   `google-play` for an Android build under the iOS default — so every existing config is unchanged; or
 * - a **per-platform map** (`SubmitByPlatform`) yields its configured list for the platform, defaulting to
 *   the platform's standard store when that platform is omitted.
 *
 * See `docs/adr/0006-platform-store-split.md`.
 */
export function resolveSubmitters(config: LaunchConfig, platform: Platform): string[] {
  if (typeof config.submit === 'string') {
    if (platform === 'android' && config.submit === IOS_SUBMITTER) return [ANDROID_SUBMITTER];
    return [config.submit];
  }
  const configured = config.submit[platform];
  return configured && configured.length > 0 ? configured : [defaultSubmitter(platform)];
}

/** The primary store for a platform — the first of {@link resolveSubmitters}; used where one name is wanted (e.g. the build preview). */
export function resolveSubmitterName(config: LaunchConfig, platform: Platform): string {
  return resolveSubmitters(config, platform)[0] ?? defaultSubmitter(platform);
}

/**
 * Upload `artifactPath` to every store {@link resolveSubmitters configured} for `platform`, in order, and
 * return the store names. A single-store config submits to exactly one (so an iOS / Play-only setup
 * behaves as before); a per-platform `submit` map fans an Android build out to Play plus alternative
 * stores. Each store is a registered `Submitter` resolved by name, so adding a store never changes this loop.
 */
export async function submitToStores(
  config: LaunchConfig,
  platform: Platform,
  artifactPath: string,
  target: SubmitTarget,
  credentials: BuildCredentials,
  ctx: ResolvedBuildContext,
): Promise<string[]> {
  const stores = resolveSubmitters(config, platform);
  for (const store of stores) {
    // biome-ignore lint/performance/noAwaitInLoops: sequential per-store submit — one upload per store, in the configured order
    await getSubmitter(store).submit(artifactPath, target, credentials, ctx);
  }
  return stores;
}

/**
 * Resolve the Android track + rollout for one invocation: an explicit `--track`/`--rollout` wins,
 * then the profile default, then the safe fallback (`internal` for a testing target, `production`
 * only when the target itself is production). The result rides on {@link ResolvedBuildContext.android}
 * so the Google Play submitter reads one source of truth.
 */
export function resolveAndroidRelease(
  options: Pick<BuildRunOptions, 'target' | 'track' | 'rollout'>,
  profile: BuildProfile,
): AndroidReleaseOptions {
  const fallback: PlayTrack = options.target === 'production' ? 'production' : 'internal';
  return {
    track: options.track ?? profile.track ?? fallback,
    rollout: options.rollout ?? profile.rollout ?? 1.0,
  };
}

/**
 * The soft size budget (MB) the pre-upload gate enforces for one run: a per-run override
 * (`--size-budget` / the wizard's custom-budget prompt) wins, then the profile's `sizeBudgetMB`, then
 * {@link DEFAULT_SIZE_BUDGET_MB}. One source of truth for the three `confirmUpload` call sites (local
 * iOS, local Android, and the EAS handoff) so the precedence can't drift between them.
 */
export function resolveSizeBudgetMB(
  options: Pick<BuildRunOptions, 'sizeBudgetMB'>,
  profile: Pick<BuildProfile, 'sizeBudgetMB'>,
): number {
  return options.sizeBudgetMB ?? profile.sizeBudgetMB ?? DEFAULT_SIZE_BUDGET_MB;
}

export const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Pick the build fork for one run, by the same precedence the dispatch has always used — extracted as a
 * pure function so the decision is unit-testable without driving a real (or even dry) build:
 * - Android always builds locally; it has no off-Mac problem, so `--remote` / `eas` never apply.
 * - For iOS, `--remote` wins (a config `buildEngine: "remote-mac"` defaults the target to AWS),
 * - then `buildEngine: "eas"` hands off to Expo,
 * - otherwise the local Mac spine.
 * - tvOS / macOS / visionOS build locally only: the off-Mac forks are iOS-only in v1 (the remote host
 *   bootstrap is iOS-shaped and EAS has no profile for them), so an explicit off-Mac request fails fast.
 */
export function resolveBuildTransport(
  platform: Platform,
  buildEngine: string,
  remoteFlag: RemoteTarget | undefined,
): BuildTransportChoice {
  if (platform === 'android') return { kind: 'local' };
  const remote: RemoteTarget | undefined =
    remoteFlag ?? (buildEngine === 'remote-mac' ? { kind: 'aws' } : undefined);
  if (platform !== 'ios') {
    if (remote) {
      throw new Error(
        `Remote builds are iOS-only — build ${platformLabel(platform)} on a local Mac (drop \`--remote\` / \`buildEngine: "remote-mac"\`).`,
      );
    }
    if (buildEngine === 'eas') {
      throw new Error(
        `EAS does not build ${platformLabel(platform)} — build it on a local Mac (drop \`buildEngine: "eas"\`).`,
      );
    }
    return { kind: 'local' };
  }
  if (remote) return { kind: 'remote', remote };
  if (buildEngine === 'eas') return { kind: 'eas' };
  return { kind: 'local' };
}
