import { FileSystem, type Path } from '@effect/platform';
import { Data, Effect } from 'effect';
import type {
  AndroidReleaseNote,
  AndroidReleaseOptions,
  BuildProfile,
  Platform,
  PlayTrack,
  SubmitTarget,
} from '../types/app.js';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.js';
import type { BuildCredentials } from '../types/credentials.js';
import type { RemoteTarget } from '../types/remote.js';
import { resolveWhatsNew } from '../release/releaseInputs.js';
import { parseReleaseNotesJson } from '../store/playTracks.js';
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

export type BuildTransportFailure = Readonly<{
  readonly _tag: 'BuildTransportFailure';
  readonly message: string;
}>;

export const makeBuildTransportFailure =
  Data.tagged<BuildTransportFailure>('BuildTransportFailure');
/** The build engine name for a platform, swapping the iOS baseline default (`fastlane`) for `gradle` on Android. */
export const resolveBuildEngineName = (config: LaunchConfig, platform: Platform): string => {
  if (platform === 'android' && config.buildEngine === IOS_BUILD_ENGINE)
    return ANDROID_BUILD_ENGINE;
  return config.buildEngine;
};
/** The standard store for a platform: Play for Android, App Store Connect for every Apple platform. */
const defaultSubmitter = (platform: Platform): string => {
  if (platform === 'android') return ANDROID_SUBMITTER;
  return IOS_SUBMITTER;
};
/**
 * The store(s) a build for `platform` is submitted to - the seam that decouples the build target from the
 * store, so one build can reach several. Two `config.submit` shapes resolve here:
 *
 * - a **string** (the original shape) yields exactly one store: the configured submitter, mapped to
 *   `google-play` for an Android build under the iOS default - so every existing config is unchanged; or
 * - a **per-platform map** (`SubmitByPlatform`) yields its configured list for the platform, defaulting to
 *   the platform's standard store when that platform is omitted.
 *
 * See `docs/adr/0006-platform-store-split.md`.
 */
export const resolveSubmitters = (config: LaunchConfig, platform: Platform): string[] => {
  if (typeof config.submit === 'string') {
    if (platform === 'android' && config.submit === IOS_SUBMITTER) return [ANDROID_SUBMITTER];
    return [config.submit];
  }
  const configured = config.submit[platform];
  if (configured !== undefined && configured.length > 0) return configured;
  return [defaultSubmitter(platform)];
};
/** The primary store for a platform - the first of {@link resolveSubmitters}; used where one name is wanted (e.g. the build preview). */
export const resolveSubmitterName = (config: LaunchConfig, platform: Platform): string => {
  const primarySubmitter = resolveSubmitters(config, platform)[0];
  if (primarySubmitter === undefined) return defaultSubmitter(platform);
  return primarySubmitter;
};
/**
 * Upload `artifactPath` to every store {@link resolveSubmitters configured} for `platform`, in order, and
 * return the store names. A single-store config submits to exactly one (so an iOS / Play-only setup
 * behaves as before); a per-platform `submit` map fans an Android build out to Play plus alternative
 * stores. Each store is a registered `Submitter` resolved by name, so adding a store never changes this loop.
 */
export const submitToStores = (
  config: LaunchConfig,
  platform: Platform,
  artifactPath: string,
  target: SubmitTarget,
  credentials: BuildCredentials,
  buildContext: ResolvedBuildContext,
): Effect.Effect<string[], unknown> => {
  const stores = resolveSubmitters(config, platform);
  return Effect.forEach(
    stores,
    (storeName) =>
      getSubmitter(storeName).pipe(
        Effect.flatMap((submitter) =>
          submitter.submit(artifactPath, target, credentials, buildContext),
        ),
      ),
    { concurrency: 1 },
  ).pipe(Effect.as(stores));
};
/**
 * Resolve the Android track + rollout for one invocation: an explicit `--track`/`--rollout` wins,
 * then the profile default, then the safe fallback (`internal` for a testing target, `production`
 * only when the target itself is production). The result rides on {@link ResolvedBuildContext.android}
 * so the Google Play submitter reads one source of truth.
 */
export const resolveAndroidRelease = (
  options: Pick<BuildRunOptions, 'target' | 'track' | 'rollout'>,
  profile: BuildProfile,
): AndroidReleaseOptions => {
  let fallbackTrack: PlayTrack = 'internal';
  if (options.target === 'production') fallbackTrack = 'production';
  let track = profile.track;
  if (options.track !== undefined) track = options.track;
  if (track === undefined) track = fallbackTrack;
  let rollout = profile.rollout;
  if (options.rollout !== undefined) rollout = options.rollout;
  if (rollout === undefined) rollout = 1.0;
  return {
    track,
    rollout,
  };
};

/** Convert a language-to-copy map into the Play submitter's release-note shape. */
export const androidReleaseNotesFromLocaleMap = (
  releaseNotesByLocale: Readonly<Record<string, string>>,
): readonly AndroidReleaseNote[] =>
  Object.entries(releaseNotesByLocale).map(([language, text]) => ({ language, text }));

/**
 * Resolve Play release notes for an Android ship: `--notes` JSON wins when set, otherwise the same
 * `release.releaseNotes` + store.config sources iOS uses via {@link resolveWhatsNew}. Empty means the
 * submitter skips changelogs (binary-only upload).
 */
export const resolveAndroidSubmitReleaseNotes = (
  launchConfig: LaunchConfig,
  appDirectory: string,
  notesPath: string | undefined,
): Effect.Effect<readonly AndroidReleaseNote[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (notesPath !== undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      const releaseNotesText = yield* fileSystem.readFileString(notesPath);
      const releaseNotes = yield* parseReleaseNotesJson(releaseNotesText);
      return releaseNotes.map((releaseNote) => ({
        language: releaseNote.language,
        text: releaseNote.text,
      }));
    }
    const releaseNotesByLocale = yield* resolveWhatsNew(launchConfig.release, appDirectory);
    return androidReleaseNotesFromLocaleMap(releaseNotesByLocale);
  });
/**
 * The soft size budget (MB) the pre-upload gate enforces for one run: a per-run override
 * (`--size-budget` / the wizard's custom-budget prompt) wins, then the profile's `sizeBudgetMB`, then
 * {@link DEFAULT_SIZE_BUDGET_MB}. One source of truth for the three `confirmUpload` call sites (local
 * iOS, local Android, and the EAS handoff) so the precedence can't drift between them.
 */
export const resolveSizeBudgetMB = (
  options: Pick<BuildRunOptions, 'sizeBudgetMB'>,
  profile: Pick<BuildProfile, 'sizeBudgetMB'>,
): number => {
  if (options.sizeBudgetMB !== undefined) return options.sizeBudgetMB;
  if (profile.sizeBudgetMB !== undefined) return profile.sizeBudgetMB;
  return DEFAULT_SIZE_BUDGET_MB;
};
export const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
/**
 * Pick the build fork for one run, by the same precedence the dispatch has always used - extracted as a
 * pure function so the decision is unit-testable without driving a real (or even dry) build:
 * - Android always builds locally; it has no off-Mac problem, so `--remote` / `eas` never apply.
 * - For iOS, `--remote` wins (a config `buildEngine: "remote-mac"` defaults the target to AWS),
 * - then `buildEngine: "eas"` hands off to Expo,
 * - otherwise the local Mac spine.
 * - tvOS / macOS / visionOS build locally only: the off-Mac forks are iOS-only in v1 (the remote host
 *   bootstrap is iOS-shaped and EAS has no profile for them), so an explicit off-Mac request fails fast.
 */
export const resolveBuildTransport = (
  platform: Platform,
  buildEngine: string,
  remoteFlag: RemoteTarget | undefined,
): Effect.Effect<BuildTransportChoice, BuildTransportFailure> => {
  if (platform === 'android') return Effect.succeed({ kind: 'local' });
  let remote = remoteFlag;
  if (remote === undefined && buildEngine === 'remote-mac') remote = { kind: 'aws' };
  if (platform !== 'ios') {
    if (remote) {
      return Effect.fail(
        makeBuildTransportFailure({
          message: `Remote builds are iOS-only - build ${platformLabel(platform)} on a local Mac (drop \`--remote\` / \`buildEngine: "remote-mac"\`).`,
        }),
      );
    }
    if (buildEngine === 'eas') {
      return Effect.fail(
        makeBuildTransportFailure({
          message: `EAS does not build ${platformLabel(platform)} - build it on a local Mac (drop \`buildEngine: "eas"\`).`,
        }),
      );
    }
    return Effect.succeed({ kind: 'local' });
  }
  if (remote) return Effect.succeed({ kind: 'remote', remote });
  if (buildEngine === 'eas') return Effect.succeed({ kind: 'eas' });
  return Effect.succeed({ kind: 'local' });
};
