// Shows the profile, store id, and track a build would use before any native work starts.

import { isApplePlatform } from '../services/stores/platform.ts';
import type { AppDescriptor, Platform, PlayTrack } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import {
  readAndroidRelease,
  readBuildEngineName,
  readSubmitterName,
} from './pipeline-providers.ts';
import type { BuildRunOptions } from '../types/build-run.ts';

/** One app's resolved build decisions before native work starts. */
type AppBuildPlan = Readonly<{
  readonly app: string;
  readonly identifier?: string;
  readonly buildEngine: string;
  readonly submitter: string;
  readonly track?: string;
  readonly rollout?: number;
}>;

/** Resolved build decisions for every selected app. */
type BuildPreview = Readonly<{
  readonly platform: Platform;
  readonly profile: string;
  readonly distribution: string;
  readonly apps: readonly AppBuildPlan[];
}>;

/** Inputs used to preview a build without invoking a toolchain. */
export type BuildPreviewInput = Readonly<{
  readonly config: LaunchConfig;
  readonly apps: readonly AppDescriptor[];
  readonly platform: Platform;
  readonly profile?: string;
  readonly distribution?: string;
  readonly track?: PlayTrack;
  readonly rollout?: number;
}>;

/** Read the store identifier an app exposes for the selected platform. */
function identifierFor(appDescriptor: AppDescriptor, platform: Platform): string | undefined {
  const isApple = isApplePlatform(platform);

  if (isApple) {
    return appDescriptor.bundleId;
  }

  return appDescriptor.packageName;
}

/** Read the configured profile name or fail for an explicit unknown profile. */
function readProfileName(launchConfig: LaunchConfig, requestedProfile: string | undefined): string {
  const profileNames = Object.keys(launchConfig.profiles);

  const hasRequestedProfile = requestedProfile != null;

  if (hasRequestedProfile) {
    const profileExists = requestedProfile in launchConfig.profiles;

    if (profileExists) {
      return requestedProfile;
    }

    let declaredProfiles = profileNames.join(', ');

    const hasNoDeclaredProfiles = declaredProfiles.length == 0;

    if (hasNoDeclaredProfiles) {
      declaredProfiles = 'none';
    }

    throw new Error(
      `Unknown profile "${requestedProfile}". Declared profiles: ${declaredProfiles}.`,
    );
  }

  const hasProduction = 'production' in launchConfig.profiles;

  if (hasProduction) {
    return 'production';
  }

  const firstProfileName = profileNames[0];

  const hasFirstProfile = firstProfileName != null;

  if (hasFirstProfile) {
    return firstProfileName;
  }

  return 'production';
}

function planApp(
  previewInput: BuildPreviewInput,
  buildProfileName: string,
): (appDescriptor: AppDescriptor) => AppBuildPlan {
  const buildProfile = previewInput.config.profiles[buildProfileName] ?? {
    name: buildProfileName,
    sizeBudgetMB: 200,
  };

  return function planOneApp(appDescriptor: AppDescriptor): AppBuildPlan {
    const identifier = identifierFor(appDescriptor, previewInput.platform);
    let appPlan: AppBuildPlan = {
      app: appDescriptor.name,
      buildEngine: readBuildEngineName(previewInput.config, previewInput.platform),
      submitter: readSubmitterName(previewInput.config, previewInput.platform),
    };

    const hasIdentifier = identifier != null;

    if (hasIdentifier) {
      appPlan = { ...appPlan, identifier };
    }

    const isAndroid = previewInput.platform == 'android';

    if (isAndroid == false) {
      return appPlan;
    }

    let releaseOptions: Pick<BuildRunOptions, 'track' | 'rollout'> = {};

    const hasTrack = previewInput.track != null;

    if (hasTrack) {
      releaseOptions = { ...releaseOptions, track: previewInput.track };
    }

    const hasRollout = previewInput.rollout != null;

    if (hasRollout) {
      releaseOptions = { ...releaseOptions, rollout: previewInput.rollout };
    }

    const androidRelease = readAndroidRelease(releaseOptions, buildProfile);

    return { ...appPlan, ...androidRelease };
  };
}

function readPreviewDistribution(distribution: string | undefined): string {
  const distributionIsMissing = distribution == null;

  if (distributionIsMissing) {
    return 'store';
  }

  return distribution;
}

export function previewBuild(previewInput: BuildPreviewInput): BuildPreview {
  const profileName = readProfileName(previewInput.config, previewInput.profile);
  const distribution = readPreviewDistribution(previewInput.distribution);

  return {
    platform: previewInput.platform,
    profile: profileName,
    distribution,
    apps: previewInput.apps.map(planApp(previewInput, profileName)),
  };
}
