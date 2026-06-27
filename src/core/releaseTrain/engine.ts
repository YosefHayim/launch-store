/**
 * The pure decision helpers behind the live {@link import("./orchestrator.js").TrainEngine} — kept here,
 * separate from the command's network wiring, so they unit-test with no network:
 * - {@link iosCarState} / {@link androidCarState} map a store's live read to a {@link NativeCarState}.
 * - {@link resolveTrainCars} resolves which cars a train coordinates from config + flags (ADR 0004 D2).
 *
 * The command (`cli/commands/releaseTrain.ts`) builds the real engine by wrapping the existing release
 * primitives (`appStoreRelease`, the Play submitter, the OTA publish core) and delegates every state
 * decision to these functions.
 */

import type { ReleaseVerdict } from '../appStoreRelease.js';
import type { PlayRelease } from '../../google/playClient.js';
import type { NativeCarState, TrainPlatform } from './types.js';
import type { OtaCarSpec } from './orchestrator.js';

/**
 * Map an App Store release verdict to a native car state. Returns `null` when the verdict carries no
 * usable version state (`unknown` / no version yet) so the caller keeps the car where it is rather than
 * regressing it on a transient read.
 */
export function iosCarState(verdict: ReleaseVerdict): NativeCarState | null {
  switch (verdict.state) {
    case 'released':
      return 'released';
    case 'pending-release':
      return 'approved'; // approved, held at PENDING_DEVELOPER_RELEASE — the gate fires the release
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

/**
 * Map a Play production track's releases to a native car state. Play exposes no readable review phase, so
 * a processed release on the track is treated as live (a staged `inProgress` rollout is still live to a
 * fraction — steer it with `launch rollout`). Returns `null` while nothing is on the track yet (still
 * processing / in Google's opaque review) so the car holds its current state.
 */
export function androidCarState(releases: PlayRelease[]): NativeCarState | null {
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
}

/** Which cars a train coordinates: the native platform legs plus their OTA followers. */
export interface TrainCarPlan {
  platforms: TrainPlatform[];
  ota: OtaCarSpec[];
}

/** The config-derived facts {@link resolveTrainCars} needs, plus the run's scoping flags. */
export interface ResolveCarsInput {
  /** Set when the app declares an iOS bundle id. */
  hasBundleId: boolean;
  /** Set when the app declares an Android package. */
  hasPackageName: boolean;
  /** Set when a cloud storage provider is configured (OTA needs one). */
  hasCloudStorage: boolean;
  /** The runtime version every OTA follower targets. */
  runtimeVersion: string;
  /** The channel every OTA follower publishes to. */
  channel: string;
  /** `--platform ios|android` — restrict the train to one native platform. */
  platformFilter?: TrainPlatform;
  /** `--no-ota` — coordinate the native legs only. */
  noOta: boolean;
}

/**
 * Resolve the train's cars from config + flags (ADR D2): an iOS car when a bundle id is declared, an
 * Android car when a package is declared, and one OTA follower per native platform when cloud storage is
 * configured. `--platform` narrows to a single native leg; `--no-ota` drops the followers.
 */
export function resolveTrainCars(input: ResolveCarsInput): TrainCarPlan {
  const platforms: TrainPlatform[] = [];
  if (input.hasBundleId && input.platformFilter !== 'android') platforms.push('ios');
  if (input.hasPackageName && input.platformFilter !== 'ios') platforms.push('android');

  const ota: OtaCarSpec[] =
    input.noOta || !input.hasCloudStorage
      ? []
      : platforms.map((platform) => ({
          platform,
          channel: input.channel,
          runtimeVersion: input.runtimeVersion,
        }));

  return { platforms, ota };
}
