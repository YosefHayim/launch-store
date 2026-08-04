import type { ReleaseVerdict } from '../release/appStoreRelease.js';
import type { PlayRelease } from '../types/googlePlay.js';
import type { NativeCarState, TrainPlatform } from '../types/releaseTrain.js';
import type { OtaCarSpec } from './orchestrator.js';
/**
 * Map an App Store release verdict to a native car state. Returns `null` when the verdict carries no
 * usable version state (`unknown` / no version yet) so the caller keeps the car where it is rather than
 * regressing it on a transient read.
 */
export const iosCarState = (verdict: ReleaseVerdict): NativeCarState | null => {
  switch (verdict.state) {
    case 'released':
      return 'released';
    case 'pending-release':
      return 'approved'; // approved, held at PENDING_DEVELOPER_RELEASE - the gate fires the release
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
 * Map a Play production track's releases to a native car state. Play exposes no readable review phase, so
 * a processed release on the track is treated as live (a staged `inProgress` rollout is still live to a
 * fraction - steer it with `launch rollout`). Returns `null` while nothing is on the track yet (still
 * processing / in Google's opaque review) so the car holds its current state.
 */
export const androidCarState = (releases: readonly PlayRelease[]): NativeCarState | null => {
  const release = releases[0];
  if (!release) return null;
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
/** Which cars a train coordinates: the native platform legs plus their OTA followers. */
export type TrainCarPlan = {
  platforms: TrainPlatform[];
  ota: OtaCarSpec[];
};
/** The config-derived facts {@link resolveTrainCars} needs, plus the run's scoping flags. */
export type ResolveCarsInput = {
  hasBundleId: boolean;
  hasPackageName: boolean;
  hasCloudStorage: boolean;
  runtimeVersion: string;
  channel: string;
  platformFilter?: TrainPlatform;
  noOta: boolean;
};
/**
 * Resolve the train's cars from config + flags (ADR D2): an iOS car when a bundle id is declared, an
 * Android car when a package is declared, and one OTA follower per native platform when cloud storage is
 * configured. `--platform` narrows to a single native leg; `--no-ota` drops the followers.
 */
export const resolveTrainCars = (input: ResolveCarsInput): TrainCarPlan => {
  const platforms: TrainPlatform[] = [];
  if (input.hasBundleId && input.platformFilter !== 'android') platforms.push('ios');
  if (input.hasPackageName && input.platformFilter !== 'ios') platforms.push('android');
  let ota: OtaCarSpec[] = [];
  if (!input.noOta && input.hasCloudStorage) {
    ota = platforms.map((platform) => ({
      platform,
      channel: input.channel,
      runtimeVersion: input.runtimeVersion,
    }));
  }
  return { platforms, ota };
};
