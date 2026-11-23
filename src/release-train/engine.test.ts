import { describe, expect, it } from 'vitest';
import type { ReleaseVerdict } from '../release/app-store-release.ts';
import { androidCarState, iosCarState, planTrainCars } from './engine.ts';

function verdict(state: ReleaseVerdict['state']): ReleaseVerdict {
  return {
    label: state,
    state,
    done: true,
    exitCode: 0,
  };
}
function describeIosCarPiece() {
  function mapsEachVerdictToANativeCarPieceKeepingTheCarPutOnUnknown() {
    const iosCar = iosCarState(verdict('released'));
    expect(iosCar).toBe('released');
    expect(iosCarState(verdict('pending-release'))).toBe('approved');
    expect(iosCarState(verdict('in-review'))).toBe('in-review');
    expect(iosCarState(verdict('rejected'))).toBe('rejected');
    expect(iosCarState(verdict('preparing'))).toBe('submitted');
    expect(iosCarState(verdict('unknown'))).toBeNull();
  }

  it(
    'maps each verdict to a native car state, keeping the car put on unknown',
    mapsEachVerdictToANativeCarPieceKeepingTheCarPutOnUnknown,
  );
}

describe('iosCarState', describeIosCarPiece);
function describeAndroidCarPiece() {
  function treatsAProcessedProductionReleaseAsLiveAndADraftAsSubmitted() {
    const androidCar = androidCarState([{ status: 'completed' }]);
    expect(androidCar).toBe('released');
    expect(androidCarState([{ status: 'inProgress', userFraction: 0.1 }])).toBe('released');
    expect(androidCarState([{ status: 'halted' }])).toBe('released');
    expect(androidCarState([{ status: 'draft' }])).toBe('submitted');
  }

  it(
    'treats a processed production release as live and a draft as submitted',
    treatsAProcessedProductionReleaseAsLiveAndADraftAsSubmitted,
  );
  function keepsTheCarPutWhenTheTrackIsEmptyOrInAnUnknownStatus() {
    const androidCar = androidCarState([]);
    expect(androidCar).toBeNull();
    expect(androidCarState([{ status: 'weird' }])).toBeNull();
  }

  it(
    'keeps the car put when the track is empty or in an unknown status',
    keepsTheCarPutWhenTheTrackIsEmptyOrInAnUnknownStatus,
  );
}

describe('androidCarState', describeAndroidCarPiece);
function describePlanTrainCars() {
  const base = { runtimeVersion: '1.0.0', channel: 'production', noOta: false };
  function coordinatesBothNativeLegsAndOneOTAFollowerEachByDefault() {
    const plan = planTrainCars({
      ...base,
      hasBundleId: true,
      hasPackageName: true,
      hasCloudStorage: true,
    });
    expect(plan.platforms).toEqual(['ios', 'android']);
    expect(plan.ota).toEqual([
      { platform: 'ios', channel: 'production', runtimeVersion: '1.0.0' },
      { platform: 'android', channel: 'production', runtimeVersion: '1.0.0' },
    ]);
  }

  it(
    'coordinates both native legs and one OTA follower each by default',
    coordinatesBothNativeLegsAndOneOTAFollowerEachByDefault,
  );
  function dropsOTAFollowersUnderNoOtaOrWithNoCloudStorage() {
    const trainCars = planTrainCars({
      ...base,
      hasBundleId: true,
      hasPackageName: false,
      hasCloudStorage: true,
      noOta: true,
    });
    expect(trainCars.ota).toEqual([]);
    expect(
      planTrainCars({
        ...base,
        hasBundleId: true,
        hasPackageName: false,
        hasCloudStorage: false,
      }).ota,
    ).toEqual([]);
  }

  it(
    'drops OTA followers under --no-ota or with no cloud storage',
    dropsOTAFollowersUnderNoOtaOrWithNoCloudStorage,
  );
  function narrowsToOneNativeLegUnderPlatform() {
    const plan = planTrainCars({
      ...base,
      hasBundleId: true,
      hasPackageName: true,
      hasCloudStorage: true,
      platformFilter: 'ios',
    });
    expect(plan.platforms).toEqual(['ios']);
    expect(plan.ota).toEqual([{ platform: 'ios', channel: 'production', runtimeVersion: '1.0.0' }]);
  }

  it('narrows to one native leg under --platform', narrowsToOneNativeLegUnderPlatform);
  function omitsANativeLegTheAppDoesnTDeclare() {
    const plan = planTrainCars({
      ...base,
      hasBundleId: false,
      hasPackageName: true,
      hasCloudStorage: false,
    });
    expect(plan.platforms).toEqual(['android']);
  }

  it("omits a native leg the app doesn't declare", omitsANativeLegTheAppDoesnTDeclare);
}

describe('planTrainCars', describePlanTrainCars);
