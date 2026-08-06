import type { ReleaseVerdict } from '../release/appStoreRelease.js';
import type { PlayRelease } from '../types/googlePlay.js';
import type { NativeCarState, TrainPlatform } from '../types/releaseTrain.js';
import type { OtaCarSpec } from './orchestrator.js';

/**
 * Map an App Store release verdict to a native car state.
 * `null` keeps the car put on transient/unknown reads.
 */
export const iosCarState = (verdict: ReleaseVerdict): NativeCarState | null => {
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
};

/**
 * Map a Play production track to a native car state.
 * Processed track releases count as live; empty/unknown holds the car put.
 */
export const androidCarState = (releases: readonly PlayRelease[]): NativeCarState | null => {
  const release = releases[0];
  if (release === undefined) return null;
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
};

/** Native legs plus OTA followers a train coordinates. */
export type TrainCarPlan = Readonly<{
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

/**
 * Plan train cars from config + flags (ADR D2): native legs for declared
 * platforms, OTA followers when cloud storage is configured.
 */
export const planTrainCars = (planInput: TrainCarPlanInput): TrainCarPlan => {
  const platforms: TrainPlatform[] = [];
  if (planInput.hasBundleId && planInput.platformFilter !== 'android') platforms.push('ios');
  if (planInput.hasPackageName && planInput.platformFilter !== 'ios') platforms.push('android');
  let ota: OtaCarSpec[] = [];
  if (!planInput.noOta && planInput.hasCloudStorage) {
    ota = platforms.map((platform) => ({
      platform,
      channel: planInput.channel,
      runtimeVersion: planInput.runtimeVersion,
    }));
  }
  return { platforms, ota };
};
