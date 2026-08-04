import { Data, Effect } from 'effect';
import { isApplePlatform } from '../services/platform.js';
import type { AppDescriptor, Platform, PlayTrack } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import {
  resolveAndroidRelease,
  resolveBuildEngineName,
  resolveSubmitterName,
} from './pipelineProviders.js';
import type { BuildRunOptions } from './pipelineTypes.js';

/** One app's resolved build decisions before native work starts. */
export type AppBuildPlan = Readonly<{
  readonly app: string;
  readonly identifier?: string;
  readonly buildEngine: string;
  readonly submitter: string;
  readonly track?: string;
  readonly rollout?: number;
}>;

/** Resolved build decisions for every selected app. */
export type BuildPreview = Readonly<{
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

/** A requested build preview cannot be resolved from configuration. */
export type BuildPreviewFailure = Readonly<{
  readonly _tag: 'BuildPreviewFailure';
  readonly requestedProfile: string;
  readonly message: string;
}>;

export const makeBuildPreviewFailure = Data.tagged<BuildPreviewFailure>('BuildPreviewFailure');

/** Resolve the store identifier an app exposes for the selected platform. */
const identifierFor = (appDescriptor: AppDescriptor, platform: Platform): string | undefined => {
  if (isApplePlatform(platform)) return appDescriptor.bundleId;
  return appDescriptor.packageName;
};

/** Resolve the configured profile name or fail for an explicit unknown profile. */
const resolveProfileName = (
  config: LaunchConfig,
  requestedProfile: string | undefined,
): Effect.Effect<string, BuildPreviewFailure> => {
  const profileNames = Object.keys(config.profiles);
  if (requestedProfile !== undefined) {
    if (requestedProfile in config.profiles) return Effect.succeed(requestedProfile);
    let declaredProfiles = profileNames.join(', ');
    if (declaredProfiles.length === 0) declaredProfiles = 'none';
    return Effect.fail(
      makeBuildPreviewFailure({
        requestedProfile,
        message: `Unknown profile "${requestedProfile}". Declared profiles: ${declaredProfiles}.`,
      }),
    );
  }
  if ('production' in config.profiles) return Effect.succeed('production');
  const firstProfileName = profileNames[0];
  if (firstProfileName !== undefined) return Effect.succeed(firstProfileName);
  return Effect.succeed('production');
};

export const previewBuild = (
  previewInput: BuildPreviewInput,
): Effect.Effect<BuildPreview, BuildPreviewFailure> =>
  Effect.gen(function* () {
    const profileName = yield* resolveProfileName(previewInput.config, previewInput.profile);
    let buildProfile = previewInput.config.profiles[profileName];
    if (buildProfile === undefined) buildProfile = { name: profileName, sizeBudgetMB: 200 };
    let distribution = previewInput.distribution;
    if (distribution === undefined) distribution = 'store';
    const appPlans = previewInput.apps.map((appDescriptor): AppBuildPlan => {
      const identifier = identifierFor(appDescriptor, previewInput.platform);
      let appPlan: AppBuildPlan = {
        app: appDescriptor.name,
        buildEngine: resolveBuildEngineName(previewInput.config, previewInput.platform),
        submitter: resolveSubmitterName(previewInput.config, previewInput.platform),
      };
      if (identifier !== undefined) appPlan = { ...appPlan, identifier };
      if (previewInput.platform !== 'android') return appPlan;
      let target: 'testing' | 'production' = 'production';
      if (distribution === 'internal') target = 'testing';
      let releaseOptions: Pick<BuildRunOptions, 'target' | 'track' | 'rollout'> = { target };
      if (previewInput.track !== undefined) {
        releaseOptions = { ...releaseOptions, track: previewInput.track };
      }
      if (previewInput.rollout !== undefined) {
        releaseOptions = { ...releaseOptions, rollout: previewInput.rollout };
      }
      const androidRelease = resolveAndroidRelease(releaseOptions, buildProfile);
      return { ...appPlan, ...androidRelease };
    });
    return {
      platform: previewInput.platform,
      profile: profileName,
      distribution,
      apps: appPlans,
    };
  });
