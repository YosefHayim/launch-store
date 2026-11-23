// Picks the build engine, submitter, Play release notes, size budget, and upload transport.

import { readFile } from 'node:fs/promises';
import type {
  AndroidReleaseNote,
  AndroidReleaseOptions,
  AppDescriptor,
  BuildProfile,
  Platform,
} from '../types/app.ts';
import type { LaunchConfig, ResolvedBuildContext } from '../types/config.ts';
import type { BuildCredentials } from '../types/credentials.ts';
import type { SubmitArtifact } from '../types/providers.ts';
import type { RemoteTarget } from '../types/remote.ts';
import { resolveWhatsNew } from '../release/release-inputs.ts';
import { parseReleaseNotesJson } from '@/google/store/play-tracks.js';
import { getSubmitter } from '../services/provider-support/registry.ts';
import { platformLabel } from '../services/stores/platform.ts';
import {
  DEFAULT_SIZE_BUDGET_MB,
  type BuildRunOptions,
  type BuildTransportChoice,
} from './pipeline-types.ts';

const IOS_SUBMITTER = 'app-store-connect';
const ANDROID_SUBMITTER = 'google-play';

type BuildTransportFailure = Readonly<{
  readonly _tag: 'BuildTransportFailure';
  readonly message: string;
}>;

function makeBuildTransportFailure(fields: { message: string }): BuildTransportFailure {
  return { _tag: 'BuildTransportFailure', message: fields.message };
}

/** Engines that only build Apple apps; an Android build swaps any of them for `gradle`. */
const appleOnlyBuildEngines = new Set(['xcode', 'remote-mac', 'eas']);

/** The build engine name for a platform, swapping an Apple-only engine (`xcode`, `remote-mac`, `eas`) for `gradle` on Android. */
export function resolveBuildEngineName(launchConfig: LaunchConfig, platform: Platform): string {
  const isAndroid = platform == 'android';

  if (isAndroid == false) {
    return launchConfig.buildEngine;
  }

  const isAppleOnlyEngine = appleOnlyBuildEngines.has(launchConfig.buildEngine);

  if (isAppleOnlyEngine) {
    return 'gradle';
  }

  return launchConfig.buildEngine;
}

/** The standard store for a platform: Play for Android, App Store Connect for every Apple platform. */
function defaultSubmitter(platform: Platform): string {
  const isAndroid = platform == 'android';

  if (isAndroid) {
    return ANDROID_SUBMITTER;
  }

  return IOS_SUBMITTER;
}

function isSubmitByPlatform(
  submitSetting: LaunchConfig['submit'],
): submitSetting is Exclude<LaunchConfig['submit'], string> {
  return typeof submitSetting != 'string';
}

function configuredSubmitters(
  submitByPlatform: Exclude<LaunchConfig['submit'], string>,
  platform: Platform,
): string[] {
  const configured = submitByPlatform[platform];

  const isMissing = configured == null;

  if (isMissing) {
    return [defaultSubmitter(platform)];
  }

  const isEmpty = configured.length == 0;

  if (isEmpty) {
    return [defaultSubmitter(platform)];
  }

  return configured;
}

/** The store(s) a build for `platform` is submitted to. */
export function resolveSubmitters(launchConfig: LaunchConfig, platform: Platform): string[] {
  const submitSetting = launchConfig.submit;

  const isMap = isSubmitByPlatform(submitSetting);

  if (isMap) {
    return configuredSubmitters(submitSetting, platform);
  }

  const isAndroid = platform == 'android';

  if (isAndroid == false) {
    return [submitSetting];
  }

  const usesIosDefault = submitSetting == IOS_SUBMITTER;

  if (usesIosDefault) {
    return [ANDROID_SUBMITTER];
  }

  return [submitSetting];
}

/** The primary store for a platform - the first of {@link resolveSubmitters}. */
export function resolveSubmitterName(launchConfig: LaunchConfig, platform: Platform): string {
  const primarySubmitter = resolveSubmitters(launchConfig, platform)[0];

  const isMissing = primarySubmitter == null;

  if (isMissing) {
    return defaultSubmitter(platform);
  }

  return primarySubmitter;
}

/** Upload `artifact` to every store configured for `platform`, in order */
export async function submitToStores(
  launchConfig: LaunchConfig,
  platform: Platform,
  artifact: SubmitArtifact,
  credentials: BuildCredentials,
  buildContext: ResolvedBuildContext,
): Promise<string[]> {
  const stores = resolveSubmitters(launchConfig, platform);

  for (const storeName of stores) {
    const submitter = getSubmitter(storeName);
    await submitter.submit(artifact, credentials, buildContext);
  }

  return stores;
}

function readReleaseTrack(
  profileTrack: BuildProfile['track'],
  trackOverride: BuildRunOptions['track'],
): AndroidReleaseOptions['track'] {
  const hasTrackOverride = trackOverride != null;

  if (hasTrackOverride) {
    return trackOverride;
  }

  const trackIsMissing = profileTrack == null;

  if (trackIsMissing) {
    return 'internal';
  }

  return profileTrack;
}

function readReleaseRollout(
  profileRollout: BuildProfile['rollout'],
  rolloutOverride: BuildRunOptions['rollout'],
): number {
  const hasRolloutOverride = rolloutOverride != null;

  if (hasRolloutOverride) {
    return rolloutOverride;
  }

  const rolloutIsMissing = profileRollout == null;

  if (rolloutIsMissing) {
    const fullRollout = 1;

    return fullRollout;
  }

  return profileRollout;
}

/** Resolve the Android track + rollout for one invocation */
export function resolveAndroidRelease(
  buildOptions: Pick<BuildRunOptions, 'track' | 'rollout'>,
  profile: BuildProfile,
): AndroidReleaseOptions {
  const track = readReleaseTrack(profile.track, buildOptions.track);
  const rollout = readReleaseRollout(profile.rollout, buildOptions.rollout);

  return { track, rollout };
}

function releaseNoteFromEntry(entry: readonly [string, string]): AndroidReleaseNote {
  return { language: entry[0], text: entry[1] };
}

/** Convert a language-to-copy map into the Play submitter's release-note shape. */
export function androidReleaseNotesFromLocaleMap(
  releaseNotesByLocale: Readonly<Record<string, string>>,
): readonly AndroidReleaseNote[] {
  return Object.entries(releaseNotesByLocale).map(releaseNoteFromEntry);
}

/** Resolve Play release notes for an Android ship */
export async function resolveAndroidSubmitReleaseNotes(
  launchConfig: LaunchConfig,
  app: Pick<AppDescriptor, 'dir' | 'bundleId' | 'packageName'>,
  notesPath: string | undefined,
): Promise<readonly AndroidReleaseNote[]> {
  const hasNotesPath = notesPath != null;

  if (hasNotesPath) {
    const releaseNotesText = await readFile(notesPath, 'utf8');
    const releaseNotes = await parseReleaseNotesJson(releaseNotesText);

    return releaseNotes.map(function copyReleaseNote(releaseNote): AndroidReleaseNote {
      return { language: releaseNote.language, text: releaseNote.text };
    });
  }

  const releaseNotesByLocale = await resolveWhatsNew(launchConfig, app);

  return androidReleaseNotesFromLocaleMap(releaseNotesByLocale);
}

/** The soft size budget (MB) the pre-upload gate enforces */
export function resolveSizeBudgetMB(
  buildOptions: Pick<BuildRunOptions, 'sizeBudgetMB'>,
  profile: Pick<BuildProfile, 'sizeBudgetMB'>,
): number {
  const runBudget = buildOptions.sizeBudgetMB;

  const hasRunBudget = runBudget != null;

  if (hasRunBudget) {
    return runBudget;
  }

  const profileBudget = profile.sizeBudgetMB;

  const hasProfileBudget = profileBudget != null;

  if (hasProfileBudget) {
    return profileBudget;
  }

  return DEFAULT_SIZE_BUDGET_MB;
}

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function iosTransport(remote: RemoteTarget | undefined, buildEngine: string): BuildTransportChoice {
  const hasRemote = remote != null;

  if (hasRemote) {
    return { kind: 'remote', remote };
  }

  const isRemoteMacEngine = buildEngine == 'remote-mac';

  if (isRemoteMacEngine) {
    throw makeBuildTransportFailure({
      message: 'A remote Mac build needs --remote user@host.',
    });
  }

  const isEas = buildEngine == 'eas';

  if (isEas) {
    return { kind: 'eas' };
  }

  return { kind: 'local' };
}

function localAppleTransport(
  platform: Platform,
  remote: RemoteTarget | undefined,
  buildEngine: string,
): BuildTransportChoice {
  const offMacMessage = `Remote builds are iOS-only - build ${platformLabel(platform)} on a local Mac (drop \`--remote\` / \`buildEngine: "remote-mac"\`).`;
  const hasRemote = remote != null;

  if (hasRemote) {
    throw makeBuildTransportFailure({ message: offMacMessage });
  }

  const isRemoteMacEngine = buildEngine == 'remote-mac';

  if (isRemoteMacEngine) {
    throw makeBuildTransportFailure({ message: offMacMessage });
  }

  const isEas = buildEngine == 'eas';

  if (isEas) {
    throw makeBuildTransportFailure({
      message: `EAS does not build ${platformLabel(platform)} - build it on a local Mac (drop \`buildEngine: "eas"\`).`,
    });
  }

  return { kind: 'local' };
}

/** Pick the build fork for one run. */
export function resolveBuildTransport(
  platform: Platform,
  buildEngine: string,
  remoteFlag: RemoteTarget | undefined,
): BuildTransportChoice {
  const isAndroid = platform == 'android';

  if (isAndroid) {
    return { kind: 'local' };
  }

  const isIos = platform == 'ios';

  if (isIos) {
    return iosTransport(remoteFlag, buildEngine);
  }

  return localAppleTransport(platform, remoteFlag, buildEngine);
}
