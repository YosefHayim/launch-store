import type { ReleaseVerdict } from '../release/app-store-release.ts';
import type { PlayRelease } from '../types/google-play.ts';
import type { NativeCarState, TrainPlatform } from '../types/release-train.ts';
import type { OtaCarSpec } from './orchestrator.ts';

/** Map an App Store release verdict to a native car state. */
export function iosCarState(verdict: ReleaseVerdict): NativeCarState | null {
  switch (verdict.state) {
    case 'released':
      return 'released';
    case 'pending-release':
      return 'approved';
    case 'in-review':
      return 'in-review';
    case 'rejected':
      return 'rejected';
    case 'preparing':
      return 'submitted';
    case 'unknown':
      return null;
  }
}

/** Map a Play production track to a native car state. */
export function androidCarState(releases: readonly PlayRelease[]): NativeCarState | null {
  const release = releases[0];

  if (release == null) return null;

  switch (release.status) {
    case 'completed':
    case 'inProgress':
    case 'halted':
      return 'released';
    case 'draft':
      return 'submitted';
    default:
      return null;
  }
}

/** Native legs plus OTA followers a train coordinates. */
type TrainCarPlan = Readonly<{
  platforms: readonly TrainPlatform[];
  ota: readonly OtaCarSpec[];
}>;

/** Config-derived facts and scoping flags for {@link planTrainCars}. */
export type TrainCarPlanInput = Readonly<{
  hasBundleId: boolean;
  hasPackageName: boolean;
  hasCloudStorage: boolean;
  runtimeVersion: string;
  channel: string;
  platformFilter?: TrainPlatform;
  noOta: boolean;
}>;

/** Plan train cars from config + flags */
export function planTrainCars(planInput: TrainCarPlanInput): TrainCarPlan {
  const platforms: TrainPlatform[] = [];

  if (planInput.hasBundleId && planInput.platformFilter != 'android') platforms.push('ios');

  if (planInput.hasPackageName && planInput.platformFilter != 'ios') platforms.push('android');

  let ota: OtaCarSpec[] = [];

  if (!planInput.noOta && planInput.hasCloudStorage) {
    function createPlatformUpdate(platform: 'ios' | 'android') {
      return {
        platform,
        channel: planInput.channel,
        runtimeVersion: planInput.runtimeVersion,
      };
    }

    ota = platforms.map(createPlatformUpdate);
  }

  return { platforms, ota };
}
